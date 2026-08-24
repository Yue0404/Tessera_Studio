import { defineConfig, devices } from "@playwright/test";

// 顶层 e2e:production 命令先构建；此处只托管单一 preview 进程，确保 Windows 能完整回收进程树。
const managedPreview = process.env.TESSERA_MANAGED_PREVIEW === "1";
const chromiumChannel =
  process.platform === "win32" ? ("msedge" as const) : ("chromium" as const);

export default defineConfig({
  testDir: "./tests/production-e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4174",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // 正式命令由同进程 Vite runner 管理 preview；直接调用 Playwright 时仍保留单进程回退。
  webServer: managedPreview
    ? undefined
    : {
        command:
          "node apps/web/node_modules/vite/bin/vite.js preview apps/web --host 127.0.0.1 --port 4174",
        url: "http://127.0.0.1:4174",
        reuseExistingServer: false,
        timeout: 120_000,
      },
  projects: [
    {
      name: "production-chromium",
      use: { ...devices["Desktop Chrome"], channel: chromiumChannel },
    },
  ],
});
