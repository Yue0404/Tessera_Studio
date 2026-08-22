import { defineConfig, devices } from "@playwright/test";

const configuredChromePath =
  process.env.TESSERA_CHROME_EXECUTABLE_PATH?.trim() || undefined;

/** 跨浏览器验证独立于默认 e2e，避免改变本地与 CI 的既有入口。 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
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
      name: "edge-system",
      use: { ...devices["Desktop Edge"], channel: "msedge" },
    },
    {
      name: "chrome-system",
      use: configuredChromePath
        ? {
            ...devices["Desktop Chrome"],
            launchOptions: { executablePath: configuredChromePath },
          }
        : { ...devices["Desktop Chrome"], channel: "chrome" },
    },
    {
      name: "chromium-playwright",
      use: { ...devices["Desktop Chrome"], channel: "chromium" },
    },
    {
      name: "firefox-playwright",
      use: { ...devices["Desktop Firefox"] },
    },
  ],
});
