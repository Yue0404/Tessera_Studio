import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";

const outputIndex = process.argv.indexOf("--output");
const output =
  outputIndex >= 0 && process.argv[outputIndex + 1] !== undefined
    ? resolve(process.argv[outputIndex + 1])
    : "";
const result = spawnSync(
  process.execPath,
  [
    "node_modules/vitest/vitest.mjs",
    "run",
    "--config",
    "vitest.benchmark.config.ts",
    "tests/benchmarks/runtime-performance.test.ts",
    "--reporter=verbose",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      TESSERA_RUNTIME_BENCHMARK: "1",
      ...(output === "" ? {} : { TESSERA_BENCHMARK_OUTPUT: output }),
    },
  },
);
if (result.error !== undefined) console.error(result.error);
process.exitCode = result.status ?? 1;
