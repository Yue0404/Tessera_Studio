import { spawn } from "node:child_process";
import { rm, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { classifyDiagnosticRun } from "./edge-version-diagnostic-result.mjs";

const CASES = [
  "baseline",
  "data-workflow",
  "zoom-hit",
  "vertical-slice",
  "visual-export",
  "context-loss",
];
const SENTINEL_CASES = ["baseline", "visual-export", "context-loss"];
const require = createRequire(import.meta.url);
const playwrightCli = require.resolve("@playwright/test/cli");

function option(name) {
  const prefix = `--${name}=`;
  return process.argv
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
}

function requiredOption(name) {
  const value = option(name)?.trim();
  if (value === undefined || value.length === 0)
    throw new Error(`missing-option:${name}`);
  return value;
}

function runPlaywright(args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [playwrightCli, "test", ...args], {
      cwd: process.cwd(),
      env: { ...process.env, ...environment },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stderr.write(text);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ exitCode: code ?? 1, output }));
  });
}

async function executeCase({
  id,
  grep,
  label,
  expectedBrowserVersion,
  outputDirectory,
  trace,
  expectedProbeIds,
  debug,
}) {
  const startedAt = performance.now();
  const result = await runPlaywright(
    [
      "--config=playwright.edge-diagnostic.config.ts",
      "--project=edge-system",
      "--workers=1",
      "--retries=0",
      `--grep=${grep}`,
      `--output=${outputDirectory}`,
    ],
    {
      TESSERA_EDGE_DIAGNOSTIC_CASE: id,
      TESSERA_EDGE_DIAGNOSTIC_LABEL: label,
      TESSERA_EDGE_DIAGNOSTIC_TRACE: trace,
      DEBUG: debug,
    },
  );
  return classifyDiagnosticRun({
    id,
    exitCode: result.exitCode,
    durationMs: performance.now() - startedAt,
    output: result.output,
    expectedBrowserVersion,
    expectedLabel: label,
    expectedProbeIds,
  });
}

const label = requiredOption("label");
if (!["current", "previous"].includes(label))
  throw new Error(`unknown-label:${label}`);
const expectedBrowserVersion = requiredOption("expected-version");
const outputPath = requiredOption("output");
const debug = option("debug") ?? "";
const temporaryRoot = path.join(
  os.tmpdir(),
  `tessera-edge-diagnostic-${process.pid}`,
);

const cases = [];
let sentinel;
try {
  for (const id of CASES) {
    console.log(`[edge-diagnostic] ${label} 独立运行 ${id}`);
    cases.push(
      await executeCase({
        id,
        grep: `\\[edge-diag:${id}\\]`,
        label,
        expectedBrowserVersion,
        outputDirectory: path.join(temporaryRoot, id),
        trace: "off",
        expectedProbeIds: [id],
        debug,
      }),
    );
  }

  console.log(
    `[edge-diagnostic] ${label} 长生命周期哨兵：${SENTINEL_CASES.join(",")}`,
  );
  sentinel = await executeCase({
    id: "long-lived-trace-sentinel",
    grep: SENTINEL_CASES.map((id) => `\\[edge-diag:${id}\\]`).join("|"),
    label,
    expectedBrowserVersion,
    outputDirectory: path.join(temporaryRoot, "sentinel"),
    trace: "retain-on-failure",
    expectedProbeIds: SENTINEL_CASES,
    debug,
  });
} finally {
  // runner 临时 trace 仅用于验证生命周期因素；本工作流不上传或保留制品。
  await rm(temporaryRoot, { recursive: true, force: true });
}

const result = {
  profile: "edge-diagnostic-v1",
  label,
  expectedBrowserVersion,
  generatedAt: new Date().toISOString(),
  environment: {
    os: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    nodeVersion: process.version,
  },
  cases,
  sentinel,
  status:
    cases.every((entry) => entry.status === "passed") &&
    sentinel.status === "passed"
      ? "passed"
      : "failed",
};

const schema = JSON.parse(
  await readFile(
    new URL(
      "../tests/browser-support/edge-diagnostic-v1.schema.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);
if (!validate(result)) {
  throw new Error(
    `edge-diagnostic-schema-invalid:${ajv.errorsText(validate.errors)}`,
  );
}

await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
if (result.status === "failed") process.exitCode = 1;
