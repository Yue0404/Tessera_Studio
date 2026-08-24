import { spawn } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";
import { preview } from "vite";

const profiles = Object.freeze({
  production: Object.freeze({
    config: "playwright.production.config.ts",
    port: 4174,
    base: "./",
  }),
  pages: Object.freeze({
    config: "playwright.pages.config.ts",
    port: 4175,
    base: "/Tessera_Studio/",
  }),
});

const profileName = process.argv[2];
const profile = profiles[profileName];
if (profile === undefined || process.argv.length !== 3) {
  throw new Error("preview-e2e-profile-invalid");
}

const root = resolve(import.meta.dirname, "..");
const webRoot = resolve(root, "apps/web");
const playwrightCli = resolve(root, "node_modules/@playwright/test/cli.js");
let playwrightProcess;
let previewServer;

function waitForProcess(child) {
  return new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
}

try {
  // Vite 与 runner 同进程运行，finally 可直接 close，不依赖 Windows 外部进程终止权限。
  previewServer = await preview({
    root: webRoot,
    base: profile.base,
    preview: {
      host: "127.0.0.1",
      port: profile.port,
      strictPort: true,
    },
  });

  playwrightProcess = spawn(
    process.execPath,
    [playwrightCli, "test", `--config=${profile.config}`],
    {
      cwd: root,
      stdio: "inherit",
      shell: false,
      env: { ...process.env, TESSERA_MANAGED_PREVIEW: "1" },
    },
  );
  const result = await waitForProcess(playwrightProcess);
  if (result.code !== 0) {
    console.error(
      `Playwright ${profileName} E2E 失败：exit=${result.code ?? "null"} signal=${result.signal ?? "none"}`,
    );
    process.exitCode = result.code ?? 1;
  }
} finally {
  if (
    playwrightProcess?.exitCode === null &&
    playwrightProcess.signalCode === null
  ) {
    playwrightProcess.kill();
  }
  await previewServer?.close();
}
