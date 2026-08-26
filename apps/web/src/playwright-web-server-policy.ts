interface PlaywrightWebServerEnvironment {
  readonly CI?: string;
  readonly GITHUB_RUN_ID?: string;
  readonly GITHUB_RUN_ATTEMPT?: string;
  readonly GITHUB_JOB?: string;
  readonly RUNNER_NAME?: string;
  readonly TESSERA_E2E_PORT?: string;
}

export interface PlaywrightWebServerPolicy {
  readonly port: number;
  readonly baseURL: string;
  readonly reuseExistingServer: boolean;
}

const LOCAL_PORT = 4173;
const CI_PORT_START = 42_000;
const CI_PORT_COUNT = 2_000;

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function explicitPort(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1_024 || port > 65_535)
    throw new RangeError("TESSERA_E2E_PORT 必须是 1024..65535 的整数");
  return port;
}

/** CI 使用任务身份派生专用端口且禁止复用，避免自托管 runner 残留服务污染测试。 */
export function resolvePlaywrightWebServerPolicy(
  environment: PlaywrightWebServerEnvironment = process.env,
): PlaywrightWebServerPolicy {
  const ci = environment.CI?.toLowerCase() === "true";
  const identity = [
    environment.GITHUB_RUN_ID ?? "ci",
    environment.GITHUB_RUN_ATTEMPT ?? "1",
    environment.GITHUB_JOB ?? "job",
    environment.RUNNER_NAME ?? "runner",
  ].join(":");
  const port =
    explicitPort(environment.TESSERA_E2E_PORT) ??
    (ci ? CI_PORT_START + (stableHash(identity) % CI_PORT_COUNT) : LOCAL_PORT);
  return {
    port,
    baseURL: `http://127.0.0.1:${port}`,
    reuseExistingServer: !ci,
  };
}
