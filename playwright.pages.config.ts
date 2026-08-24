import { defineConfig, devices } from "@playwright/test";

// 顶层 e2e:pages 命令先构建；Playwright 只负责单一 preview 进程的启动与回收。
const managedPreview = process.env.TESSERA_MANAGED_PREVIEW === "1";
const chromiumChannel =
  process.platform === "win32" ? ("msedge" as const) : ("chromium" as const);

export default defineConfig({
  testDir: "./tests/pages-e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4175/Tessera_Studio/",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // 正式命令由同进程 Vite runner 管理 preview；直接调用 Playwright 时仍保留单进程回退。
  webServer: managedPreview
    ? undefined
    : {
        // 相对 base 的生产制品必须从仓库子路径运行，不能只在域名根路径冒烟。
        command:
          "node apps/web/node_modules/vite/bin/vite.js preview apps/web --host 127.0.0.1 --port 4175 --base /Tessera_Studio/",
        url: "http://127.0.0.1:4175/Tessera_Studio/",
        reuseExistingServer: false,
        timeout: 120_000,
      },
  projects: [
    {
      name: "pages-chromium",
      use: { ...devices["Desktop Chrome"], channel: chromiumChannel },
    },
  ],
});
