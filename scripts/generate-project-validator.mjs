import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import ts from "typescript";
import Ajv2020 from "ajv/dist/2020.js";
import standaloneCode from "ajv/dist/standalone/index.js";

const schemaPath = new URL(
  "../packages/formats/src/project-schema.ts",
  import.meta.url,
);
const outputPath = new URL(
  "../packages/formats/src/project-validator.generated.ts",
  import.meta.url,
);
const source = await readFile(schemaPath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2024,
  },
}).outputText;
const schemaModule = await import(
  `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`
);
const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  code: { source: true, esm: true },
  formats: {
    uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    "date-time": /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/,
  },
});
const standalone = standaloneCode(
  ajv,
  ajv.compile(schemaModule.projectV1Schema),
).replace('const func2 = require("ajv/dist/runtime/ucs2length").default;', "");
const generated = `// @ts-nocheck\n// 本文件由 scripts/generate-project-validator.mjs 从 project-schema.ts 生成，禁止手改。\nimport ucs2length from 'ajv/dist/runtime/ucs2length.js';\nconst func2 = typeof ucs2length === 'function' ? ucs2length : ucs2length.default;\n${standalone}\n`;
if (process.argv.includes("--check")) {
  const current = await readFile(outputPath, "utf8").catch(() => "");
  if (current !== generated) {
    console.error(
      "Project validator 与 project-schema.ts 不一致，请运行 pnpm schema:generate。",
    );
    process.exitCode = 1;
  }
} else {
  await writeFile(outputPath, generated, "utf8");
}
