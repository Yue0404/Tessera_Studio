import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";
import { resolvePnpmInvocation } from "./release-runner.mjs";

const outputIndex = process.argv.indexOf("--output");
const output =
  outputIndex >= 0 && process.argv[outputIndex + 1] !== undefined
    ? resolve(process.argv[outputIndex + 1])
    : "";
const pnpmCli = process.env.npm_execpath;
if (pnpmCli === undefined) throw new Error("benchmark-pnpm-cli-unavailable");
const invocation = resolvePnpmInvocation(pnpmCli);
const runPnpm = (arguments_, environment = process.env) =>
  spawnSync(
    invocation.command,
    [...invocation.prefixArguments, ...arguments_],
    {
      stdio: "inherit",
      env: environment,
    },
  );

const build = runPnpm(["--filter", "@tessera/web", "build"]);
if (build.status !== 0) {
  process.exitCode = build.status ?? 1;
} else {
  const result = runPnpm(
    [
      "exec",
      "playwright",
      "test",
      "--config",
      "playwright.benchmark.config.ts",
    ],
    {
      ...process.env,
      TESSERA_BROWSER_BENCHMARK: "1",
      ...(output === "" ? {} : { TESSERA_BENCHMARK_OUTPUT: output }),
    },
  );
  if (result.error !== undefined) console.error(result.error);
  process.exitCode = result.status ?? 1;
}
