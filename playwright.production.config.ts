import { defineConfig, devices } from "@playwright/test";

// 生产预览必须独立构建并启动，不能复用开发服务器，否则无法发现拆包后的循环依赖。
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
  webServer: {
    command:
      "pnpm --filter @tessera/web build && pnpm --filter @tessera/web exec vite preview --host 127.0.0.1 --port 4174",
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
