import { readdir, readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "apps/web/dist");

async function listFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

const issues = [];
let files;
try {
  files = await listFiles(dist);
} catch (error) {
  console.error("- Pages 制品目录不存在，请先运行 pnpm build");
  throw error;
}

const names = files.map((path) => relative(dist, path).replaceAll("\\", "/"));
for (const required of ["index.html", ".nojekyll", "extractor-releases.json"]) {
  if (!names.includes(required)) issues.push(`Pages 制品缺少：${required}`);
}
for (const name of names) {
  // Source map 是现有生产诊断契约；这里只拒绝可直接执行或导入的源码文件。
  if (/\.(?:ts|tsx)$/u.test(name)) issues.push(`Pages 制品含开发文件：${name}`);
  if (/\.tessera-module\.zip$/u.test(name)) {
    issues.push(`Pages 制品不得捆绑本地模块包：${name}`);
  }
  if (/visual-export-browser-smoke-harness/u.test(name)) {
    issues.push(`Pages 制品含测试 harness：${name}`);
  }
}

const html = await readFile(resolve(dist, "index.html"), "utf8");
for (const forbidden of ["/@fs/", 'src="/src/', "file://", "C:\\"]) {
  if (html.includes(forbidden))
    issues.push(`index.html 含本地或源码引用：${forbidden}`);
}
const assetReferences = [...html.matchAll(/(?:src|href)="([^"]+)"/gu)].map(
  (match) => match[1],
);
for (const reference of assetReferences) {
  if (
    !reference.startsWith("./") &&
    !reference.startsWith("data:") &&
    !reference.startsWith("#")
  ) {
    issues.push(`Pages 入口引用不是相对子路径：${reference}`);
  }
}

const totalBytes = (
  await Promise.all(files.map(async (path) => (await stat(path)).size))
).reduce((total, bytes) => total + bytes, 0);

if (issues.length > 0) {
  for (const issue of issues) console.error(`- ${issue}`);
  process.exitCode = 1;
} else {
  console.log(
    `Pages 制品审计通过：${files.length} 个文件，${totalBytes} 字节。`,
  );
}
