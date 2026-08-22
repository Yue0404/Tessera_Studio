import { defineConfig, devices } from "@playwright/test";

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
  webServer: {
    // 相对 base 的生产制品必须从仓库子路径运行，不能只在域名根路径冒烟。
    command:
      "pnpm --filter @tessera/web build && pnpm --filter @tessera/web exec vite preview --host 127.0.0.1 --port 4175 --base /Tessera_Studio/",
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
