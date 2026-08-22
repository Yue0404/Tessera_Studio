import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { format as formatWithPrettier } from "prettier";
import ts from "typescript";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import standaloneCode from "ajv/dist/standalone/index.js";

const sourceRoot = new URL("../packages/formats/src/", import.meta.url);
const moduleRuntimeSourceRoot = new URL(
  "../packages/module-runtime/src/",
  import.meta.url,
);
const webSourceRoot = new URL("../apps/web/src/", import.meta.url);

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
const moduleSchemasSource = transpile(
  await readFile(new URL("schemas.ts", moduleRuntimeSourceRoot), "utf8"),
);
const moduleSchemas = await import(dataUrl(moduleSchemasSource));
const extractorReleaseSchemaSource = transpile(
  await readFile(new URL("extractor-release-schema.ts", webSourceRoot), "utf8"),
);
const extractorReleaseSchema = await import(
  dataUrl(extractorReleaseSchemaSource)
);

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
  const equalBindings = [];
  standalone = standalone.replaceAll(
    /const\s+([A-Za-z_$][\w$]*)\s*=\s*require\("ajv\/dist\/runtime\/equal"\)\.default;/g,
    (_declaration, binding) => {
      equalBindings.push(binding);
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
  const equalPrelude =
    equalBindings.length === 0
      ? ""
      : `import equalModule from 'ajv/dist/runtime/equal.js';
const deepEqual = typeof equalModule === 'function' ? equalModule : equalModule.default;
${[...new Set(equalBindings)].map((binding) => `const ${binding} = deepEqual;`).join("\n")}
`;
  let dateTimePrelude = "";
  if (dateTimeBindings.length > 0) {
    dateTimePrelude = `import formatDefinitions from 'ajv-formats/dist/formats.js';
const fullFormats = formatDefinitions.fullFormats ?? formatDefinitions.default?.fullFormats;
${[...new Set(dateTimeBindings)].map((binding) => `const ${binding} = fullFormats['date-time'];`).join("\n")}
`;
  }
  // 没有 deep-equal 依赖时维持既有 Project/Fragment 产物的逐字节布局。
  const runtimePreludes =
    equalPrelude === ""
      ? `${ucs2Prelude}\n${dateTimePrelude}`
      : `${ucs2Prelude}\n${equalPrelude}\n${dateTimePrelude}`;
  const generated = `// @ts-nocheck
// 本文件由 scripts/generate-project-validator.mjs 从 ${sourceName} 生成，禁止手改。
${runtimePreludes}
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
  ...[
    ["module-validator.generated.ts", "moduleManifestSchema", "Module"],
    ["preset-validator.generated.ts", "presetManifestSchema", "Preset"],
    ["catalog-validator.generated.ts", "catalogManifestSchema", "Catalog"],
    [
      "migration-validator.generated.ts",
      "migrationManifestSchema",
      "Migration",
    ],
    ["element-validator.generated.ts", "elementFileSchema", "Element"],
    ["constraint-validator.generated.ts", "constraintFileSchema", "Constraint"],
    ["locale-validator.generated.ts", "localeFileSchema", "Locale"],
    [
      "civ6-source-validator.generated.ts",
      "civ6SourceManifestSchema",
      "Civ6 source",
    ],
  ].map(([path, schemaName, label]) => ({
    path: new URL(path, moduleRuntimeSourceRoot),
    generated: generate(moduleSchemas[schemaName], "schemas.ts"),
    label,
  })),
  {
    path: new URL("extractor-release-validator.generated.ts", webSourceRoot),
    // 此生成文件不在 prettierignore 中；在生成阶段固定 LF 并格式化，保证 Windows/Linux 幂等。
    generated: await formatWithPrettier(
      generate(
        extractorReleaseSchema.extractorReleaseCatalogV1Schema,
        "extractor-release-schema.ts",
      ),
      { parser: "typescript", endOfLine: "lf" },
    ),
    label: "Extractor release catalog",
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
