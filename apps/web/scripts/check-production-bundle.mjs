import { log } from "node:console";
import { readdir, readFile, stat } from "node:fs/promises";
import { URL } from "node:url";

const assetsDirectory = new URL("../dist/assets/", import.meta.url);
const maxChunkBytes = 500 * 1024;
const forbiddenHarnessNames = [
  "visual-export-browser-smoke-harness",
  "storage-browser-smoke-harness",
  "opfs-browser-smoke-harness",
];

const files = await readdir(assetsDirectory);
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

log(`生产 bundle 检查通过：${files.length} 个资源，所有 JS <= 500 KiB。`);
