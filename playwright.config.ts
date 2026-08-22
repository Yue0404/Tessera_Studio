import { defineConfig, devices } from "@playwright/test";

// Linux CI 显式使用 regular Chromium 新无头模式，避免默认 headless shell 与真实浏览器存储实现漂移。
const chromiumChannel =
  process.platform === "win32" ? ("msedge" as const) : ("chromium" as const);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "pnpm --filter @tessera/web dev --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: chromiumChannel },
    },
  ],
});
