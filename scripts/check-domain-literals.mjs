import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const packageRoots = [
  "packages/core/src",
  "packages/renderer/src",
  "packages/formats/src",
  "packages/storage/src",
  "packages/module-runtime/src",
];
const hanPattern = /\p{Script=Han}/u;
const templateFragmentKinds = new Set([
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
]);

async function collectTypeScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory())
      files.push(...(await collectTypeScriptFiles(target)));
    else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".d.ts") &&
      !/\.(?:test|spec)\.tsx?$/.test(entry.name)
    ) {
      files.push(target);
    }
  }
  return files;
}

const diagnostics = [];
for (const root of packageRoots) {
  for (const file of await collectTypeScriptFiles(root)) {
    const sourceText = await readFile(file, "utf8");
    const sourceFile = ts.createSourceFile(
      file,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const inspect = (node) => {
      const isLiteral =
        ts.isStringLiteralLike(node) || templateFragmentKinds.has(node.kind);
      const text = isLiteral && "text" in node ? node.text : "";
      if (typeof text === "string" && hanPattern.test(text)) {
        const position = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(),
        );
        diagnostics.push(
          `${path.relative(process.cwd(), file)}:${position.line + 1}:${position.character + 1}`,
        );
      }
      ts.forEachChild(node, inspect);
    };
    inspect(sourceFile);
  }
}

if (diagnostics.length > 0) {
  console.error("domain-han-literal-forbidden");
  for (const diagnostic of diagnostics) console.error(diagnostic);
  process.exitCode = 1;
}
