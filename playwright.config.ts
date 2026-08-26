import { defineConfig, devices } from "@playwright/test";
import { resolvePlaywrightWebServerPolicy } from "./apps/web/src/playwright-web-server-policy.js";

// Linux CI 显式使用 regular Chromium 新无头模式，避免默认 headless shell 与真实浏览器存储实现漂移。
const chromiumChannel =
  process.platform === "win32" ? ("msedge" as const) : ("chromium" as const);
const webServerPolicy = resolvePlaywrightWebServerPolicy();

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: webServerPolicy.baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `pnpm --filter @tessera/web dev --host 127.0.0.1 --port ${webServerPolicy.port} --strictPort`,
    url: webServerPolicy.baseURL,
    reuseExistingServer: webServerPolicy.reuseExistingServer,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: chromiumChannel },
    },
  ],
});
