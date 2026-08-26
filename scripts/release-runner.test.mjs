import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { resolvePnpmInvocation } from "./release-runner.mjs";

const rootPackage = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const [defaultConfig, productionConfig, pagesConfig, previewRunner] =
  await Promise.all([
    readFile(new URL("../playwright.config.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../playwright.production.config.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../playwright.pages.config.ts", import.meta.url), "utf8"),
    readFile(new URL("./run-preview-e2e.mjs", import.meta.url), "utf8"),
  ]);

test("开发 E2E 在 CI 使用专用端口且不复用残留服务", () => {
  assert.match(defaultConfig, /resolvePlaywrightWebServerPolicy/u);
  assert.match(defaultConfig, /--strictPort/u);
  assert.match(
    defaultConfig,
    /reuseExistingServer: webServerPolicy\.reuseExistingServer/u,
  );
  assert.doesNotMatch(defaultConfig, /reuseExistingServer:\s*true/u);
});

test("Windows pnpm.exe 作为可执行文件直接启动", () => {
  assert.deepEqual(
    resolvePnpmInvocation("C:\\tools\\pnpm.exe", "C:\\node.exe"),
    { command: "C:\\tools\\pnpm.exe", prefixArguments: [] },
  );
});

test("JS 形式 pnpm CLI 仍由当前 Node 启动", () => {
  assert.deepEqual(resolvePnpmInvocation("/tools/pnpm.cjs", "/bin/node"), {
    command: "/bin/node",
    prefixArguments: ["/tools/pnpm.cjs"],
  });
});

test("生产与 Pages E2E 在 Playwright 启动前独立完成构建", () => {
  assert.match(
    rootPackage.scripts["e2e:production"],
    /^pnpm --filter @tessera\/web build && node scripts\/run-preview-e2e\.mjs production$/u,
  );
  assert.match(
    rootPackage.scripts["e2e:pages"],
    /^pnpm --filter @tessera\/web build && node scripts\/run-preview-e2e\.mjs pages$/u,
  );
});

test("正式命令不启用 Playwright webServer，直接调用仍只托管单一 preview", () => {
  for (const [name, config] of [
    ["production", productionConfig],
    ["pages", pagesConfig],
  ]) {
    const webServerCommand = config.match(
      /webServer:[\s\S]*?command:\s*\n?\s*"([^"]+)"/u,
    )?.[1];
    assert.ok(webServerCommand, `${name} 缺少 webServer.command`);
    assert.match(config, /TESSERA_MANAGED_PREVIEW/u);
    assert.match(config, /webServer: managedPreview\s*\? undefined/u);
    assert.match(
      webServerCommand,
      /^node apps\/web\/node_modules\/vite\/bin\/vite\.js preview apps\/web\b/u,
    );
    assert.doesNotMatch(
      webServerCommand,
      /\b(?:build|pnpm|npm|npx|yarn)\b|&&|\|\||[;&|]/u,
    );
  }
});

test("同进程 Vite runner 在 finally 关闭服务且不用 shell 或 taskkill", () => {
  assert.match(previewRunner, /await preview\(\{/u);
  assert.match(previewRunner, /shell: false/u);
  assert.match(previewRunner, /TESSERA_MANAGED_PREVIEW: "1"/u);
  assert.match(
    previewRunner,
    /finally \{[\s\S]*?await previewServer\?\.close\(\)/u,
  );
  assert.doesNotMatch(previewRunner, /taskkill|shell: true/u);
});
