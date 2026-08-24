import { defineConfig, devices } from "@playwright/test";

const traceMode =
  process.env.TESSERA_EDGE_DIAGNOSTIC_TRACE === "retain-on-failure"
    ? "retain-on-failure"
    : "off";

/** Edge 版本 A/B 诊断使用独立端口与关闭截图的最小配置，不影响正式支持矩阵。 */
export default defineConfig({
  testDir: "./tests/edge-diagnostic",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4175",
    trace: traceMode,
    screenshot: "off",
  },
  webServer: {
    command:
      "pnpm --filter @tessera/web dev --host 127.0.0.1 --port 4175 --strictPort",
    url: "http://127.0.0.1:4175",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "edge-system",
      use: { ...devices["Desktop Edge"], channel: "msedge" },
    },
  ],
});
