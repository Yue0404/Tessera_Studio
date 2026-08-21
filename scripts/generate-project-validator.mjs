import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import ts from "typescript";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import standaloneCode from "ajv/dist/standalone/index.js";

const sourceRoot = new URL("../packages/formats/src/", import.meta.url);

function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2024,
    },
  }).outputText;
}

function dataUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

const projectSource = transpile(
  await readFile(new URL("project-schema.ts", sourceRoot), "utf8"),
);
const projectModuleUrl = dataUrl(projectSource);
const projectModule = await import(projectModuleUrl);
const fragmentSource = transpile(
  await readFile(new URL("fragment-schema.ts", sourceRoot), "utf8"),
).replaceAll("./project-schema.js", projectModuleUrl);
const fragmentModule = await import(dataUrl(fragmentSource));

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  code: { source: true, esm: true },
});
addFormats(ajv, { mode: "full", formats: ["date-time"] });
ajv.addFormat(
  "uuid",
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
);

function generate(schema, sourceName) {
  let standalone = standaloneCode(ajv, ajv.compile(schema));
  const ucs2Bindings = [];
  standalone = standalone.replaceAll(
    /const\s+([A-Za-z_$][\w$]*)\s*=\s*require\("ajv\/dist\/runtime\/ucs2length"\)\.default;/g,
    (_declaration, binding) => {
      ucs2Bindings.push(binding);
      return "";
    },
  );
  const dateTimeBindings = [];
  standalone = standalone.replaceAll(
    /const\s+([A-Za-z_$][\w$]*)\s*=\s*require\("ajv-formats\/dist\/formats"\)\.fullFormats\["date-time"\];/g,
    (_declaration, binding) => {
      dateTimeBindings.push(binding);
      return "";
    },
  );
  const ucs2Prelude =
    ucs2Bindings.length === 0
      ? ""
      : `import ucs2lengthModule from 'ajv/dist/runtime/ucs2length.js';
const ucs2length = typeof ucs2lengthModule === 'function' ? ucs2lengthModule : ucs2lengthModule.default;
${[...new Set(ucs2Bindings)].map((binding) => `const ${binding} = ucs2length;`).join("\n")}
`;
  let dateTimePrelude = "";
  if (dateTimeBindings.length > 0) {
    dateTimePrelude = `import formatDefinitions from 'ajv-formats/dist/formats.js';
const fullFormats = formatDefinitions.fullFormats ?? formatDefinitions.default?.fullFormats;
${[...new Set(dateTimeBindings)].map((binding) => `const ${binding} = fullFormats['date-time'];`).join("\n")}
`;
  }
  const generated = `// @ts-nocheck
// 本文件由 scripts/generate-project-validator.mjs 从 ${sourceName} 生成，禁止手改。
${ucs2Prelude}
${dateTimePrelude}
${standalone}
`;
  assertBrowserEsm(generated, sourceName);
  return generated;
}

function assertBrowserEsm(generated, sourceName) {
  if (/\brequire\s*\(/u.test(generated)) {
    throw new Error(`${sourceName}:standalone-require-forbidden`);
  }
  if (/\bfrom\s+["']node:/u.test(generated)) {
    throw new Error(`${sourceName}:standalone-node-import-forbidden`);
  }
}

const outputs = [
  {
    path: new URL("project-validator.generated.ts", sourceRoot),
    generated: generate(projectModule.projectV1Schema, "project-schema.ts"),
    label: "Project",
  },
  {
    path: new URL("fragment-validator.generated.ts", sourceRoot),
    generated: generate(fragmentModule.fragmentV1Schema, "fragment-schema.ts"),
    label: "Fragment",
  },
];

if (process.argv.includes("--check")) {
  for (const output of outputs) {
    const current = await readFile(output.path, "utf8").catch(() => "");
    if (current !== output.generated) {
      console.error(
        `${output.label} validator 与源 Schema 不一致，请运行 pnpm schema:generate。`,
      );
      process.exitCode = 1;
    }
  }
} else {
  for (const output of outputs) {
    await writeFile(output.path, output.generated, "utf8");
  }
}
