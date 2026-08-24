import { spawnSync as runProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

export const OFFICIAL_BENCHMARK_PROFILE_PATH =
  "manual/benchmark-profile-v1.json";
export const PERFORMANCE_REFERENCE_REQUIREMENTS = [
  "PERF-001",
  "PERF-002",
  "PERF-010",
];

const GIB = 1024 ** 3;
const COMMIT_SHA = /^[0-9a-f]{40}$/u;
const EDGE_VERSION = /^\d+\.\d+\.\d+\.\d+$/u;
const DESKTOP_SYSTEM_TYPES = new Set([1, 3]);
const DESKTOP_CHASSIS_TYPES = new Set([3, 4, 5, 6, 7, 13, 15, 16, 35, 36]);
export const PERFORMANCE_SENSITIVE_PATHS = [
  "apps/web",
  "packages/core",
  "packages/renderer",
  "packages/storage",
  "packages/formats",
  "packages/module-runtime",
  "tests/benchmarks",
  "playwright.benchmark.config.ts",
  "scripts/run-browser-benchmark.mjs",
  "scripts/release-runner.mjs",
  "scripts/benchmark-profile.mjs",
  "package.json",
  "pnpm-lock.yaml",
];
const SCENARIOS = [
  ["project-import-100x100-2000-content", "ms", 20],
  ["project-recovery-100x100-2000-content", "ms", 20],
  ["pan-raf-25pct", "fps", 1],
  ["zoom-raf-25pct", "fps", 1],
  ["pan-raf-100pct", "fps", 1],
  ["zoom-raf-100pct", "fps", 1],
  ["pan-raf-400pct", "fps", 1],
  ["zoom-raf-400pct", "fps", 1],
  ["continuous-drawing-pointer-to-present", "ms", 1],
  ["view-008-40000-long-pan", "ms", 1],
  ["fill-worker-250000-cancel", "ms", 1],
];
const benchmarkSchema = JSON.parse(
  readFileSync(
    new URL(
      "../tests/benchmarks/benchmark-profile-v1.schema.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
const validateBenchmarkSchema = ajv.compile(benchmarkSchema);

function failedProbe(reason) {
  return {
    hardwareProbe: { succeeded: false, reason },
    os: "unknown",
    osBuildNumber: 0,
    osArchitecture: "unknown",
    cpu: "unknown",
    physicalCoreCount: 0,
    logicalCpuCount: 0,
    pcSystemType: 0,
    chassisTypes: [],
    machineType: "unknown",
    availableMemoryBytes: 0,
  };
}

function normalizeArchitecture(value) {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("arm") && text.includes("64")) return "arm64";
  if (text.includes("64")) return "x64";
  return "unknown";
}

function runGit(arguments_, options = {}) {
  return (options.runProcess ?? runProcess)("git", arguments_, {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    windowsHide: true,
    shell: false,
  });
}

/** 只读记录实际被测源码；正式 profile 不接受脏树或 Git 探针失败。 */
export function collectGitProvenance(options = {}) {
  const head = runGit(["rev-parse", "--verify", "HEAD"], options);
  const testedCommit = String(head.stdout ?? "")
    .trim()
    .toLowerCase();
  if (
    head.error !== undefined ||
    head.status !== 0 ||
    !COMMIT_SHA.test(testedCommit)
  ) {
    throw new Error("benchmark-git-head-probe-failed");
  }
  const status = runGit(
    ["status", "--porcelain", "--untracked-files=all"],
    options,
  );
  if (status.error !== undefined || status.status !== 0) {
    throw new Error("benchmark-git-status-probe-failed");
  }
  return {
    gitProbe: { succeeded: true, reason: "git-read-only" },
    testedCommit,
    worktreeClean: String(status.stdout ?? "").trim().length === 0,
  };
}

/** release:ready 的 Git 事实采集与纯校验分离，测试无需依赖测试仓库历史。 */
export function collectBenchmarkRepositoryEvidence(testedCommit, options = {}) {
  if (!COMMIT_SHA.test(testedCommit ?? "")) {
    return {
      probeSucceeded: false,
      reason: "tested-commit-invalid",
      currentHead: null,
      testedCommitIsAncestor: false,
      performanceSensitiveChangedPaths: [],
    };
  }
  const head = runGit(["rev-parse", "--verify", "HEAD"], options);
  const currentHead = String(head.stdout ?? "")
    .trim()
    .toLowerCase();
  if (
    head.error !== undefined ||
    head.status !== 0 ||
    !COMMIT_SHA.test(currentHead)
  ) {
    return {
      probeSucceeded: false,
      reason: "current-head-probe-failed",
      currentHead: null,
      testedCommitIsAncestor: false,
      performanceSensitiveChangedPaths: [],
    };
  }
  const ancestor = runGit(
    ["merge-base", "--is-ancestor", testedCommit, currentHead],
    options,
  );
  if (ancestor.error !== undefined || ![0, 1].includes(ancestor.status)) {
    return {
      probeSucceeded: false,
      reason: "git-ancestry-probe-failed",
      currentHead,
      testedCommitIsAncestor: false,
      performanceSensitiveChangedPaths: [],
    };
  }
  const changed = runGit(
    [
      "diff",
      "--name-only",
      `${testedCommit}..${currentHead}`,
      "--",
      ...PERFORMANCE_SENSITIVE_PATHS,
    ],
    options,
  );
  if (changed.error !== undefined || changed.status !== 0) {
    return {
      probeSucceeded: false,
      reason: "git-sensitive-diff-probe-failed",
      currentHead,
      testedCommitIsAncestor: ancestor.status === 0,
      performanceSensitiveChangedPaths: [],
    };
  }
  return {
    probeSucceeded: true,
    reason: "git-read-only",
    currentHead,
    testedCommitIsAncestor: ancestor.status === 0,
    performanceSensitiveChangedPaths: String(changed.stdout ?? "")
      .split(/\r?\n/u)
      .map((path) => path.trim())
      .filter(Boolean),
  };
}

/** 纯函数：旧 profile 只允许跨越不影响性能的文档、目录或许可证提交。 */
export function validateBenchmarkSourceProvenance(profile, repositoryEvidence) {
  const issues = [];
  const provenance = profile?.provenance;
  if (provenance?.gitProbe?.succeeded !== true)
    issues.push("正式 benchmark 的 Git 探针未成功");
  if (!COMMIT_SHA.test(provenance?.testedCommit ?? ""))
    issues.push("正式 benchmark testedCommit 必须是 40 位小写 Git SHA");
  if (provenance?.worktreeClean !== true)
    issues.push("正式 benchmark 必须在干净工作树运行");
  if (repositoryEvidence?.probeSucceeded !== true) {
    issues.push("正式发布无法验证 benchmark 的 Git 祖先与源码差异");
    return issues;
  }
  if (repositoryEvidence.testedCommitIsAncestor !== true)
    issues.push("正式 benchmark testedCommit 不是当前 HEAD 的祖先");
  const changed = repositoryEvidence.performanceSensitiveChangedPaths;
  if (!Array.isArray(changed)) {
    issues.push("正式发布缺少性能敏感路径差异结果");
  } else if (changed.length > 0) {
    issues.push(`benchmark 后性能敏感源码已变化：${changed.join("、")}`);
  }
  return issues;
}

/** 只读采集 Windows CIM 事实；任意失败都返回不可比较事实，不猜测硬件。 */
export function collectWindowsMachineFacts(options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") return failedProbe("platform-not-windows");
  const executable =
    options.powershellPath ??
    join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
  const script = [
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
    "$os = Get-CimInstance Win32_OperatingSystem",
    "$computer = Get-CimInstance Win32_ComputerSystem",
    "$processors = @(Get-CimInstance Win32_Processor)",
    "$enclosures = @(Get-CimInstance Win32_SystemEnclosure)",
    "[pscustomobject]@{",
    "caption = [string]$os.Caption",
    "version = [string]$os.Version",
    "buildNumber = [int]$os.BuildNumber",
    "osArchitecture = [string]$os.OSArchitecture",
    "cpu = [string]($processors.Name -join '; ')",
    "physicalCoreCount = [int](($processors | Measure-Object NumberOfCores -Sum).Sum)",
    "logicalCpuCount = [int](($processors | Measure-Object NumberOfLogicalProcessors -Sum).Sum)",
    "freePhysicalMemoryKb = [long]$os.FreePhysicalMemory",
    "pcSystemType = [int]$computer.PCSystemType",
    "chassisTypes = @($enclosures.ChassisTypes | ForEach-Object { [int]$_ })",
    "} | ConvertTo-Json -Compress",
  ].join("\n");
  const result = (options.runProcess ?? runProcess)(
    executable,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.error !== undefined || result.status !== 0) {
    return failedProbe("cim-powershell-failed");
  }
  try {
    const value = JSON.parse(result.stdout);
    const chassisTypes = (
      Array.isArray(value.chassisTypes)
        ? value.chassisTypes
        : [value.chassisTypes]
    ).filter(Number.isInteger);
    const osBuildNumber = Number(value.buildNumber);
    const physicalCoreCount = Number(value.physicalCoreCount);
    const logicalCpuCount = Number(value.logicalCpuCount);
    const availableMemoryBytes = Number(value.freePhysicalMemoryKb) * 1024;
    const pcSystemType = Number(value.pcSystemType);
    const complete =
      Number.isInteger(osBuildNumber) &&
      Number.isInteger(physicalCoreCount) &&
      physicalCoreCount > 0 &&
      Number.isInteger(logicalCpuCount) &&
      logicalCpuCount > 0 &&
      Number.isSafeInteger(availableMemoryBytes) &&
      availableMemoryBytes >= 0 &&
      Number.isInteger(pcSystemType);
    if (!complete) return failedProbe("cim-output-incomplete");
    const desktop =
      DESKTOP_SYSTEM_TYPES.has(pcSystemType) &&
      chassisTypes.some((type) => DESKTOP_CHASSIS_TYPES.has(type));
    const osArchitecture = normalizeArchitecture(value.osArchitecture);
    return {
      hardwareProbe: { succeeded: true, reason: "cim-powershell" },
      os: `${String(value.caption)} ${String(value.version)} ${osArchitecture}`,
      osBuildNumber,
      osArchitecture,
      cpu: String(value.cpu),
      physicalCoreCount,
      logicalCpuCount,
      pcSystemType,
      chassisTypes,
      machineType: desktop ? "desktop" : "non-desktop",
      availableMemoryBytes,
    };
  } catch {
    return failedProbe("cim-json-invalid");
  }
}

/** 返回参考环境不匹配原因；空数组才允许 comparable=true。 */
export function referenceEnvironmentIssues(environment) {
  const issues = [];
  if (environment?.hardwareProbe?.succeeded !== true)
    issues.push("Windows CIM 硬件采集未成功");
  if (
    !Number.isInteger(environment?.osBuildNumber) ||
    environment.osBuildNumber < 26100
  )
    issues.push("操作系统不是 Windows 11 24H2+ build 26100+");
  if (environment?.osArchitecture !== "x64")
    issues.push("操作系统架构不是 x64");
  if (environment?.physicalCoreCount !== 4) issues.push("物理核心数不是 4");
  if (environment?.logicalCpuCount !== 8) issues.push("逻辑处理器数不是 8");
  if (environment?.machineType !== "desktop")
    issues.push("机器类型不是已识别的桌面机");
  if (
    !Number.isSafeInteger(environment?.availableMemoryBytes) ||
    environment.availableMemoryBytes < 8 * GIB ||
    environment.availableMemoryBytes >= 9 * GIB
  ) {
    issues.push("可用内存不在 8 GiB 至 9 GiB 开区间上限内");
  }
  if (environment?.hardwareAccelerated !== true)
    issues.push("浏览器未确认硬件加速");
  if (
    environment?.viewport?.width !== 1440 ||
    environment?.viewport?.height !== 900
  ) {
    issues.push("视口不是 1440×900");
  }
  if (environment?.dpr !== 1) issues.push("DPR 不是 1");
  return issues;
}

function percentile(samples, quantile) {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? 0;
}

function sameNumber(left, right) {
  return (
    Number.isFinite(left) &&
    Number.isFinite(right) &&
    Math.abs(left - right) <= 1e-9
  );
}

/** 正式发布 profile 的语义门禁；结构门禁仍由 benchmark-profile-v1 Schema 执行。 */
export function validateOfficialBenchmarkProfile(profile) {
  const issues = [];
  if (!validateBenchmarkSchema(profile)) {
    issues.push(
      `正式 benchmark profile 不满足 Schema：${ajv.errorsText(
        validateBenchmarkSchema.errors,
      )}`,
    );
  }
  if (profile?.profile !== "benchmark-profile-v1")
    issues.push("正式 benchmark profile 标识无效");
  if (profile?.provenance?.gitProbe?.succeeded !== true)
    issues.push("正式 benchmark 的 Git 探针未成功");
  if (!COMMIT_SHA.test(profile?.provenance?.testedCommit ?? ""))
    issues.push("正式 benchmark testedCommit 必须是 40 位小写 Git SHA");
  if (profile?.provenance?.worktreeClean !== true)
    issues.push("正式 benchmark 必须在干净工作树运行");
  const configuration = profile?.configuration;
  for (const [key, expected] of [
    ["coldIterations", 20],
    ["projectDimension", 100],
    ["projectContentCount", 2000],
    ["fillCount", 250000],
  ]) {
    if (configuration?.[key] !== expected)
      issues.push(`正式 benchmark configuration.${key} 必须为 ${expected}`);
  }

  const environmentIssues = referenceEnvironmentIssues(profile?.environment);
  if (profile?.environment?.comparable !== true)
    issues.push("正式 benchmark profile 必须声明 comparable=true");
  if (profile?.environment?.browserChannel !== "msedge")
    issues.push("正式 benchmark browserChannel 必须为 msedge");
  if (profile?.environment?.browserName !== "Microsoft Edge")
    issues.push("正式 benchmark browserName 必须为 Microsoft Edge");
  if (!EDGE_VERSION.test(profile?.environment?.browserVersion ?? ""))
    issues.push("正式 benchmark browserVersion 必须是四段数字版本");
  issues.push(
    ...environmentIssues.map((issue) => `正式 benchmark 环境不匹配：${issue}`),
  );

  const scenarios = Array.isArray(profile?.scenarios) ? profile.scenarios : [];
  if (scenarios.length !== SCENARIOS.length) {
    issues.push(`正式 benchmark 必须包含 ${SCENARIOS.length} 个固定场景`);
  }
  for (const [index, [id, unit, minimumSamples]] of SCENARIOS.entries()) {
    const scenario = scenarios[index];
    if (scenario?.id !== id) {
      issues.push(`正式 benchmark 场景[${index}] 必须为 ${id}`);
      continue;
    }
    if (scenario.unit !== unit)
      issues.push(`正式 benchmark 场景 ${id} 单位必须为 ${unit}`);
    const samples = Array.isArray(scenario.samples) ? scenario.samples : [];
    const expectedSamples = index < 2 ? 20 : minimumSamples;
    if (
      (index < 2 && samples.length !== expectedSamples) ||
      (index >= 2 && samples.length < expectedSamples)
    ) {
      issues.push(`正式 benchmark 场景 ${id} 样本数不满足冻结要求`);
    }
    if (
      samples.some(
        (sample) =>
          !Number.isFinite(sample) ||
          sample < 0 ||
          (unit === "fps" && sample <= 0),
      )
    ) {
      issues.push(`正式 benchmark 场景 ${id} 含无效样本`);
      continue;
    }
    if (!sameNumber(scenario.p50, percentile(samples, 0.5)))
      issues.push(`正式 benchmark 场景 ${id} 的 p50 与样本不一致`);
    if (!sameNumber(scenario.p95, percentile(samples, 0.95)))
      issues.push(`正式 benchmark 场景 ${id} 的 p95 与样本不一致`);
    if (scenario.passed !== true)
      issues.push(`正式 benchmark 场景 ${id} 未通过`);

    if ((index === 0 || index === 1) && percentile(samples, 0.95) > 3000)
      issues.push(`正式 benchmark 场景 ${id} 超过 3000 ms P95`);
    if ((index === 0 || index === 1) && scenario.thresholdP95Ms !== 3000) {
      issues.push(`正式 benchmark 场景 ${id} 缺少冻结的 3000 ms 门槛`);
    }
    if (unit === "fps") {
      const p05 = percentile(samples, 0.05);
      const longestPauseMs = Math.max(
        ...samples.map((sample) => 1000 / sample),
      );
      if (p05 < 45) issues.push(`正式 benchmark 场景 ${id} 的 P05 FPS 低于 45`);
      if (longestPauseMs > 100)
        issues.push(`正式 benchmark 场景 ${id} 含超过 100 ms 的停顿`);
      const expectedZoom = id.endsWith("25pct")
        ? 0.25
        : id.endsWith("100pct")
          ? 1
          : 4;
      if (
        !sameNumber(scenario.p05, p05) ||
        !sameNumber(scenario.longestPauseMs, longestPauseMs) ||
        !Number.isFinite(scenario.renderDurationP95Ms) ||
        scenario.renderDurationP95Ms < 0 ||
        scenario.zoom !== expectedZoom
      ) {
        issues.push(`正式 benchmark 场景 ${id} 的运动统计或缩放参数不完整`);
      }
    }
    if (id === "continuous-drawing-pointer-to-present") {
      if (percentile(samples, 0.95) > 50)
        issues.push("正式 benchmark 连续绘制 P95 超过 50 ms");
      if (scenario.thresholdP95Ms !== 50)
        issues.push("正式 benchmark 连续绘制缺少冻结的 50 ms 门槛");
    }
    if (id === "view-008-40000-long-pan") {
      const missedFrames = samples.filter((sample) => sample > 34).length;
      if (
        percentile(samples, 0.95) > 100 ||
        scenario.thresholdP95Ms !== 100 ||
        scenario.missedFrames !== missedFrames ||
        missedFrames > 1 ||
        scenario.loadedChunkCount !== 256 ||
        !Number.isInteger(scenario.gpuBatchCount) ||
        scenario.gpuBatchCount > scenario.loadedChunkCount ||
        !Number.isInteger(scenario.saturatedAtDrag) ||
        scenario.stableAfterSaturationDrags < 64 ||
        !Number.isInteger(scenario.batchCountAtSaturation) ||
        scenario.maximumBatchCountAfterSaturation >
          scenario.batchCountAtSaturation + 8 ||
        (scenario.heapGrowthRatioAfterSaturation !== null &&
          (!Number.isFinite(scenario.heapGrowthRatioAfterSaturation) ||
            scenario.heapGrowthRatioAfterSaturation > 0.25))
      ) {
        issues.push("正式 benchmark 长距离平移场景不满足冻结门禁");
      }
    }
    if (
      id === "fill-worker-250000-cancel" &&
      (samples[0] > 250 ||
        scenario.thresholdMs !== 250 ||
        scenario.workerCreated !== true ||
        !(scenario.observedProgressPercent > 0) ||
        scenario.stateUnchanged !== true)
    ) {
      issues.push("正式 benchmark 后台填充取消场景不满足冻结门禁");
    }
  }
  return issues;
}
