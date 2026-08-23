import { access, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { spawn } from "node:child_process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  browserMetadataFrom,
  classifyCompletedBrowserRun,
} from "./browser-support-matrix-result.mjs";

const TARGETS = {
  "edge-system": { channel: "msedge", installedBrowser: null },
  "chrome-system": { channel: "chrome", installedBrowser: null },
  "chromium-playwright": { channel: "chromium", installedBrowser: "chromium" },
  "firefox-playwright": { channel: "firefox", installedBrowser: "firefox" },
};
const require = createRequire(import.meta.url);
const playwrightCli = require.resolve("@playwright/test/cli");

const CORE_COVERAGE = [
  { flow: "new-project-and-edit", specs: ["vertical-slice.spec.ts"] },
  {
    flow: "undo-save-reload",
    specs: ["vertical-slice.spec.ts", "storage-smoke.spec.ts"],
  },
  { flow: "project-and-fragment", specs: ["data-workflows.spec.ts"] },
  { flow: "package-install", specs: ["package-install-smoke.spec.ts"] },
  { flow: "worker-fill", specs: ["vertical-slice.spec.ts"] },
  { flow: "csp-and-a11y", specs: ["browser-safety-a11y.spec.ts"] },
];

function option(name) {
  const prefix = `--${name}=`;
  return process.argv
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
}

function versionScope() {
  const value = option("version-scope") ?? "current";
  if (!["current", "previous", "supplemental"].includes(value)) {
    throw new Error(`unknown-version-scope:${value}`);
  }
  return value;
}

function selectedTargets() {
  const requested = option("targets");
  if (requested === undefined) return Object.keys(TARGETS);
  // PowerShell 会把未加引号的逗号参数经 pnpm 合并为空格，二者都作为显式分隔符。
  const targets = requested.split(/[,\s]+/u).filter(Boolean);
  for (const target of targets) {
    if (!(target in TARGETS))
      throw new Error(`unknown-browser-target:${target}`);
  }
  return targets;
}

function run(command, args, live = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      if (live) process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      if (live) process.stderr.write(text);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function fileExists(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function detectSystemChannel(channel) {
  const candidates =
    process.platform === "win32"
      ? channel === "msedge"
        ? [
            "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
            "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
          ]
        : [
            "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
            "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
          ]
      : channel === "msedge"
        ? ["/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable"]
        : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"];
  for (const candidate of candidates) {
    if (await pathExists(candidate))
      return { available: true, reason: candidate };
  }
  return { available: false, reason: `${channel}-executable-not-found` };
}

async function detectPlaywrightBrowser(browserName) {
  const result = await run(process.execPath, [
    playwrightCli,
    "install",
    "--dry-run",
    browserName,
  ]);
  if (result.code !== 0)
    return { available: false, reason: result.output.trim() };
  const match = /Install location:\s+([^\r\n]+)/u.exec(result.output);
  if (match?.[1] === undefined)
    return { available: false, reason: "install-location-unreported" };
  const installLocation = match[1].trim();
  return (await pathExists(installLocation))
    ? { available: true, reason: installLocation }
    : { available: false, reason: `not-installed:${installLocation}` };
}

async function detect(target) {
  const definition = TARGETS[target];
  if (target === "chrome-system") {
    const configured = process.env.TESSERA_CHROME_EXECUTABLE_PATH?.trim();
    if (configured !== undefined && configured.length > 0) {
      return (await fileExists(configured))
        ? { available: true, reason: configured }
        : {
            available: false,
            reason: `configured-path-not-found:${configured}`,
          };
    }
  }
  if (target === "firefox-playwright") {
    const configured = process.env.TESSERA_FIREFOX_EXECUTABLE_PATH?.trim();
    if (configured !== undefined && configured.length > 0) {
      return (await fileExists(configured))
        ? { available: true, reason: configured }
        : {
            available: false,
            reason: `configured-path-not-found:${configured}`,
          };
    }
  }
  return definition.installedBrowser === null
    ? detectSystemChannel(definition.channel)
    : detectPlaywrightBrowser(definition.installedBrowser);
}

const runs = [];
const selectedVersionScope = versionScope();
for (const target of selectedTargets()) {
  const definition = TARGETS[target];
  const capability = await detect(target);
  if (!capability.available) {
    console.warn(`[support-matrix] 跳过 ${target}: ${capability.reason}`);
    runs.push({
      target,
      status: "unavailable",
      channel: definition.channel,
      browserName: null,
      browserVersion: null,
      exitCode: null,
      durationMs: 0,
      reason: capability.reason,
    });
    continue;
  }
  console.log(`[support-matrix] 开始 ${target}`);
  const startedAt = performance.now();
  const result = await run(
    process.execPath,
    [
      playwrightCli,
      "test",
      "--config=playwright.cross-browser.config.ts",
      `--project=${target}`,
      "--workers=1",
    ],
    true,
  );
  const metadata = browserMetadataFrom(result.output);
  const classification = classifyCompletedBrowserRun(result.code, metadata);
  runs.push({
    target,
    ...classification,
    channel: definition.channel,
    ...metadata,
    exitCode: result.code,
    durationMs: performance.now() - startedAt,
  });
}

const matrix = {
  profile: "support-matrix-v1",
  versionScope: selectedVersionScope,
  generatedAt: new Date().toISOString(),
  environment: {
    os: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    nodeVersion: process.version,
  },
  coverage: CORE_COVERAGE,
  runs,
  previousMajor:
    selectedVersionScope === "previous"
      ? {
          status: "tested",
          reason:
            "本次输出由调用方显式固定前一主版本浏览器，并记录真实 browser.version。",
          automation: "使用同一完整流程和 --version-scope=previous 复跑。",
        }
      : {
          status: "not-tested",
          reason: "本次输出不属于前一主版本证据，不能据当前版本外推。",
          automation:
            "固定前一主版本浏览器后以 --version-scope=previous 复跑。",
        },
};

const schema = JSON.parse(
  await readFile(
    new URL(
      "../tests/browser-support/support-matrix-v1.schema.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);
if (!validate(matrix)) {
  throw new Error(
    `support-matrix-schema-invalid:${ajv.errorsText(validate.errors)}`,
  );
}

const serialized = `${JSON.stringify(matrix, null, 2)}\n`;
const outputPath = option("output");
if (outputPath === undefined) process.stdout.write(serialized);
else await writeFile(outputPath, serialized, "utf8");

if (runs.some((run) => run.status === "failed")) process.exitCode = 1;
