import { defineConfig, devices } from "@playwright/test";

const chromiumChannel =
  process.platform === "win32" ? ("msedge" as const) : ("chromium" as const);

export default defineConfig({
  testDir: "./tests/benchmarks",
  testMatch: "browser-runtime-performance.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 10 * 60_000,
  use: {
    baseURL: "http://127.0.0.1:4174",
    trace: "retain-on-failure",
    viewport: { width: 1_440, height: 900 },
    deviceScaleFactor: 1,
  },
  webServer: {
    command:
      "pnpm --filter @tessera/web exec vite preview --host 127.0.0.1 --port 4174",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: false,
  },
  projects: [
    {
      name: "chromium-benchmark",
      use: { ...devices["Desktop Chrome"], channel: chromiumChannel },
    },
  ],
});
