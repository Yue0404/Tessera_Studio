import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { validateTraceabilityDocument } from "./release-evidence.mjs";
import {
  validateReleaseReadiness,
  verifyExtractorReleaseAssets,
} from "./release-readiness.mjs";

const evidence = (requirementId, status = "covered") => ({
  area: "测试",
  requirementIds: [requirementId],
  status,
  ...(status === "blocked" ? { blocker: "等待外部证据" } : {}),
  implementation: ["README.md"],
  automatedTests: ["scripts/release-readiness.test.mjs"],
  humanEvidence: ["manual/USER_GUIDE.zh-CN.md"],
});

const trace = (p0Status = "covered", p1Status = "covered") => ({
  schemaVersion: "1",
  p0RequirementIds: ["APP-001"],
  entries: [evidence("APP-001", p0Status)],
  p1RequirementIds: ["APP-004"],
  trackedP1Evidence: [evidence("APP-004", p1Status)],
});

const acceptance = (acceptedBlockers = []) => ({
  schemaVersion: "1",
  acceptedBlockers,
});

const release = (bytes = 3, sha256 = "a".repeat(64)) => ({
  assetUrl:
    "https://github.com/Yue0404/Tessera_Studio/releases/download/v1.0.0/tessera-civ6-extractor-v1.0.0-windows-x64.zip",
  bytes,
  sha256,
});

const benchmarkScenario = (id, unit, count, value, extra = {}) => ({
  id,
  scope: "受控正式场景",
  unit,
  samples: Array.from({ length: count }, () => value),
  p50: value,
  p95: value,
  passed: true,
  ...extra,
});
const benchmarkMotionScenario = (id, zoom) =>
  benchmarkScenario(id, "fps", 4, 60, {
    p05: 60,
    longestPauseMs: 1000 / 60,
    renderDurationP95Ms: 1,
    zoom,
  });

const officialBenchmarkProfile = () => ({
  profile: "benchmark-profile-v1",
  generatedAt: "2026-08-24T12:00:00.000Z",
  provenance: {
    gitProbe: { succeeded: true, reason: "git-read-only" },
    testedCommit: "a".repeat(40),
    worktreeClean: true,
  },
  configuration: {
    coldIterations: 20,
    projectDimension: 100,
    projectContentCount: 2000,
    fillCount: 250000,
  },
  environment: {
    hardwareProbe: { succeeded: true, reason: "cim-powershell" },
    os: "Microsoft Windows 11 10.0.26100 x64",
    osBuildNumber: 26100,
    osArchitecture: "x64",
    cpu: "Reference Desktop CPU",
    physicalCoreCount: 4,
    logicalCpuCount: 8,
    pcSystemType: 1,
    chassisTypes: [3],
    machineType: "desktop",
    availableMemoryBytes: 8 * 1024 ** 3,
    browserChannel: "msedge",
    browserName: "Microsoft Edge",
    browserVersion: "151.0.0.0",
    viewport: { width: 1440, height: 900 },
    dpr: 1,
    gpuRenderer: "Reference GPU",
    hardwareAccelerated: true,
    comparable: true,
    comparisonReason: "精确满足 benchmark-profile-v1 参考环境。",
  },
  scenarios: [
    benchmarkScenario("project-import-100x100-2000-content", "ms", 20, 1000, {
      thresholdP95Ms: 3000,
    }),
    benchmarkScenario("project-recovery-100x100-2000-content", "ms", 20, 800, {
      thresholdP95Ms: 3000,
    }),
    benchmarkMotionScenario("pan-raf-25pct", 0.25),
    benchmarkMotionScenario("zoom-raf-25pct", 0.25),
    benchmarkMotionScenario("pan-raf-100pct", 1),
    benchmarkMotionScenario("zoom-raf-100pct", 1),
    benchmarkMotionScenario("pan-raf-400pct", 4),
    benchmarkMotionScenario("zoom-raf-400pct", 4),
    benchmarkScenario("continuous-drawing-pointer-to-present", "ms", 4, 20, {
      thresholdP95Ms: 50,
    }),
    benchmarkScenario("view-008-40000-long-pan", "ms", 4, 20, {
      thresholdP95Ms: 100,
      missedFrames: 0,
      loadedChunkCount: 256,
      gpuBatchCount: 100,
      saturatedAtDrag: 190,
      stableAfterSaturationDrags: 64,
      batchCountAtSaturation: 100,
      maximumBatchCountAfterSaturation: 100,
      heapGrowthRatioAfterSaturation: 0,
    }),
    benchmarkScenario("fill-worker-250000-cancel", "ms", 1, 20, {
      thresholdMs: 250,
      workerCreated: true,
      observedProgressPercent: 1,
      stateUnchanged: true,
    }),
  ],
});

const currentBenchmarkSourceEvidence = (changedPaths = []) => ({
  probeSucceeded: true,
  reason: "git-read-only",
  currentHead: "b".repeat(40),
  testedCommitIsAncestor: true,
  performanceSensitiveChangedPaths: changedPaths,
});

const performanceTrace = (status) => ({
  entries: [
    {
      requirementIds: ["PERF-001", "PERF-010"],
      status,
    },
  ],
  trackedP1Evidence: [
    {
      requirementIds: ["PERF-002"],
      status,
    },
  ],
});

test("候选证据检查允许有明确原因的 blocker", () => {
  assert.deepEqual(validateTraceabilityDocument(trace("blocked")), []);
});

test("正式就绪同时拒绝未接受 blocker、缺许可证和空 catalog", () => {
  const issues = validateReleaseReadiness({
    trace: trace("blocked", "blocked"),
    acceptance: acceptance(),
    hasRootLicense: false,
    releaseCatalog: { schemaVersion: "1", releases: [] },
  }).join("\n");
  assert.match(issues, /APP-001/u);
  assert.match(issues, /APP-004/u);
  assert.match(issues, /根级项目许可证/u);
  assert.match(issues, /catalog 为空/u);
});

test("全部需求覆盖、许可证和正式 catalog 齐全时就绪", () => {
  assert.deepEqual(
    validateReleaseReadiness({
      trace: trace(),
      acceptance: acceptance(),
      hasRootLicense: true,
      releaseCatalog: { schemaVersion: "1", releases: [release()] },
    }),
    [],
  );
});

test("性能需求标为 covered 时必须有受跟踪且严格通过的正式 profile", () => {
  const common = {
    trace: performanceTrace("covered"),
    acceptance: acceptance(),
    hasRootLicense: true,
    releaseCatalog: { schemaVersion: "1", releases: [release()] },
  };
  assert.match(
    validateReleaseReadiness(common).join("\n"),
    /受跟踪的正式 benchmark profile|缺少 benchmark-profile-v1/u,
  );
  const nonReference = officialBenchmarkProfile();
  nonReference.environment.logicalCpuCount = 20;
  nonReference.environment.comparable = false;
  assert.match(
    validateReleaseReadiness({
      ...common,
      benchmarkProfile: nonReference,
      benchmarkProfileTracked: true,
      benchmarkRepositoryEvidence: currentBenchmarkSourceEvidence(),
    }).join("\n"),
    /逻辑处理器数不是 8|comparable=true/u,
  );
  assert.deepEqual(
    validateReleaseReadiness({
      ...common,
      benchmarkProfile: officialBenchmarkProfile(),
      benchmarkProfileTracked: true,
      benchmarkRepositoryEvidence: currentBenchmarkSourceEvidence(),
    }),
    [],
  );
});

test("正式就绪拒绝 benchmark 后变化的性能源码与 Git 探针失败", () => {
  const common = {
    trace: performanceTrace("covered"),
    acceptance: acceptance(),
    hasRootLicense: true,
    releaseCatalog: { schemaVersion: "1", releases: [release()] },
    benchmarkProfile: officialBenchmarkProfile(),
    benchmarkProfileTracked: true,
  };
  assert.match(
    validateReleaseReadiness({
      ...common,
      benchmarkRepositoryEvidence: currentBenchmarkSourceEvidence([
        "apps/web/src/App.tsx",
      ]),
    }).join("\n"),
    /性能敏感源码已变化/u,
  );
  assert.match(
    validateReleaseReadiness({
      ...common,
      benchmarkRepositoryEvidence: {
        probeSucceeded: false,
        reason: "git-ancestry-probe-failed",
        currentHead: null,
        testedCommitIsAncestor: false,
        performanceSensitiveChangedPaths: [],
      },
    }).join("\n"),
    /无法验证 benchmark 的 Git/u,
  );
});

test("性能需求保持 blocked 且所有者接受延期时允许没有正式 profile", () => {
  const acceptedBlockers = ["PERF-001", "PERF-002", "PERF-010"].map(
    (requirementId) => ({
      requirementId,
      reason: "等待冻结参考硬件与浏览器范围决策",
      acceptedBy: "repository-owner",
      acceptedAt: "2026-08-24T12:00:00Z",
    }),
  );
  assert.deepEqual(
    validateReleaseReadiness({
      trace: performanceTrace("blocked"),
      acceptance: acceptance(acceptedBlockers),
      hasRootLicense: true,
      releaseCatalog: { schemaVersion: "1", releases: [release()] },
    }),
    [],
  );
});

test("显式接受的 blocker 必须带身份时间理由且只引用 blocked 需求", () => {
  const accepted = {
    requirementId: "APP-001",
    reason: "产品所有者接受延期",
    acceptedBy: "repository-owner",
    acceptedAt: "2026-08-24T12:00:00Z",
  };
  assert.deepEqual(
    validateReleaseReadiness({
      trace: trace("blocked"),
      acceptance: acceptance([accepted]),
      hasRootLicense: true,
      releaseCatalog: { schemaVersion: "1", releases: [release()] },
    }),
    [],
  );
  assert.match(
    validateReleaseReadiness({
      trace: trace(),
      acceptance: acceptance([accepted]),
      hasRootLicense: true,
      releaseCatalog: { schemaVersion: "1", releases: [release()] },
    }).join("\n"),
    /非 blocked/u,
  );
});

test("正式 Release 下载只读核对体积和 SHA-256", async () => {
  const bytes = new globalThis.TextEncoder().encode("zip");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const catalog = {
    releases: [release(bytes.byteLength, sha256)],
  };
  assert.deepEqual(
    await verifyExtractorReleaseAssets(
      catalog,
      async () => new globalThis.Response(bytes, { status: 200 }),
    ),
    [],
  );
  assert.match(
    (
      await verifyExtractorReleaseAssets(
        catalog,
        async () => new globalThis.Response("bad", { status: 200 }),
      )
    ).join("\n"),
    /体积不匹配|SHA-256 不匹配/u,
  );
  assert.match(
    (
      await verifyExtractorReleaseAssets(catalog, async () => {
        const body = new globalThis.ReadableStream({
          start(controller) {
            controller.error(new Error("stream-failed"));
          },
        });
        return new globalThis.Response(body, { status: 200 });
      })
    ).join("\n"),
    /读取正式提取器 Release 失败/u,
  );
});
