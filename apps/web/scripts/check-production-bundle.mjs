import { log } from "node:console";
import { readdir, readFile, stat } from "node:fs/promises";
import { URL } from "node:url";

const assetsDirectory = new URL("../dist/assets/", import.meta.url);
const indexPath = new URL("../dist/index.html", import.meta.url);
const maxChunkBytes = 500 * 1024;
const expectedCsp =
  "default-src 'self'; script-src 'self'; worker-src 'self' blob:; " +
  "img-src 'self' blob: data:; font-src 'self' blob: data:; " +
  "style-src 'self' 'unsafe-inline'; connect-src 'self' " +
  "ws://localhost:* ws://127.0.0.1:*; object-src 'none'; " +
  "base-uri 'none'; form-action 'self'";
const forbiddenHarnessNames = [
  "visual-export-browser-smoke-harness",
  "storage-browser-smoke-harness",
  "opfs-browser-smoke-harness",
];

const files = await readdir(assetsDirectory);
const indexHtml = await readFile(indexPath, "utf8");
const initialScriptNames = [
  ...indexHtml.matchAll(/<script[^>]+src="\.\/assets\/([^"]+\.js)"/gu),
].map((match) => match[1]);
const actualCsp = indexHtml.match(
  /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
)?.[1];
if (actualCsp !== expectedCsp) {
  throw new Error(
    "生产 index.html 的 Content Security Policy 与安全基线不一致",
  );
}
if (
  actualCsp.includes("'unsafe-eval'") ||
  actualCsp.match(/'unsafe-inline'/g)?.length !== 1
) {
  throw new Error("生产 CSP 的 eval/inline 例外超出允许范围");
}
for (const filename of files.filter((value) => value.endsWith(".js"))) {
  const path = new URL(filename, assetsDirectory);
  const size = (await stat(path)).size;
  if (size > maxChunkBytes) {
    throw new Error(`生产 chunk 超过 500 KiB：${filename} (${size} bytes)`);
  }
  const source = await readFile(path, "utf8");
  const forbidden = forbiddenHarnessNames.find((name) => source.includes(name));
  if (forbidden !== undefined) {
    throw new Error(`生产 chunk 意外包含测试 harness：${forbidden}`);
  }
}
for (const filename of initialScriptNames) {
  const source = await readFile(new URL(filename, assetsDirectory), "utf8");
  if (source.includes("extractor-releases.json")) {
    throw new Error("提取器 release catalog 意外进入生产初始入口");
  }
}

log(`生产 bundle 检查通过：${files.length} 个资源，所有 JS <= 500 KiB。`);
