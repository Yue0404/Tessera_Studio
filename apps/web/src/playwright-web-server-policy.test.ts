import { describe, expect, it } from "vitest";
import { resolvePlaywrightWebServerPolicy } from "./playwright-web-server-policy.js";

describe("Playwright webServer 策略", () => {
  it("本地保留 4173 与已有开发服务复用", () => {
    expect(resolvePlaywrightWebServerPolicy({})).toEqual({
      port: 4173,
      baseURL: "http://127.0.0.1:4173",
      reuseExistingServer: true,
    });
  });

  it("CI 禁止复用服务，并按任务身份派生稳定专用端口", () => {
    const environment = {
      CI: "true",
      GITHUB_RUN_ID: "32927703002",
      GITHUB_RUN_ATTEMPT: "1",
      GITHUB_JOB: "verify",
      RUNNER_NAME: "Tessera-WSL-D24",
    };
    const first = resolvePlaywrightWebServerPolicy(environment);
    const second = resolvePlaywrightWebServerPolicy(environment);
    expect(first).toEqual(second);
    expect(first.reuseExistingServer).toBe(false);
    expect(first.port).toBeGreaterThanOrEqual(42_000);
    expect(first.port).toBeLessThan(44_000);
  });

  it("不同 CI 尝试使用不同端口，显式端口仍可覆盖", () => {
    const common = {
      CI: "true",
      GITHUB_RUN_ID: "32927703002",
      GITHUB_JOB: "verify",
    };
    expect(
      resolvePlaywrightWebServerPolicy({
        ...common,
        GITHUB_RUN_ATTEMPT: "1",
      }).port,
    ).not.toBe(
      resolvePlaywrightWebServerPolicy({
        ...common,
        GITHUB_RUN_ATTEMPT: "2",
      }).port,
    );
    expect(
      resolvePlaywrightWebServerPolicy({
        ...common,
        TESSERA_E2E_PORT: "45123",
      }),
    ).toMatchObject({
      port: 45_123,
      baseURL: "http://127.0.0.1:45123",
      reuseExistingServer: false,
    });
  });

  it("拒绝无效显式端口，避免 Vite 静默换端口后访问错误服务", () => {
    expect(() =>
      resolvePlaywrightWebServerPolicy({ TESSERA_E2E_PORT: "70000" }),
    ).toThrow(RangeError);
  });
});
