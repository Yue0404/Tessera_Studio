import assert from "node:assert/strict";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFile } from "node:fs/promises";
import {
  collectBenchmarkRepositoryEvidence,
  collectGitProvenance,
  collectWindowsMachineFacts,
  referenceEnvironmentIssues,
  validateBenchmarkSourceProvenance,
  validateOfficialBenchmarkProfile,
} from "./benchmark-profile.mjs";

const samples = (count, value) => Array.from({ length: count }, () => value);
const scenario = (id, unit, values, extra = {}) => ({
  id,
  scope: "受控正式场景",
  unit,
  samples: values,
  p50: values[0],
  p95: values[0],
  passed: true,
  ...extra,
});

function validProfile() {
  const motion = (id, zoom) =>
    scenario(id, "fps", samples(4, 60), {
      p05: 60,
      longestPauseMs: 1000 / 60,
      renderDurationP95Ms: 1,
      zoom,
    });
  return {
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
      scenario("project-import-100x100-2000-content", "ms", samples(20, 1000), {
        thresholdP95Ms: 3000,
      }),
      scenario(
        "project-recovery-100x100-2000-content",
        "ms",
        samples(20, 800),
        {
          thresholdP95Ms: 3000,
        },
      ),
      motion("pan-raf-25pct", 0.25),
      motion("zoom-raf-25pct", 0.25),
      motion("pan-raf-100pct", 1),
      motion("zoom-raf-100pct", 1),
      motion("pan-raf-400pct", 4),
      motion("zoom-raf-400pct", 4),
      scenario("continuous-drawing-pointer-to-present", "ms", samples(4, 20), {
        thresholdP95Ms: 50,
      }),
      scenario("view-008-40000-long-pan", "ms", samples(4, 20), {
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
      scenario("fill-worker-250000-cancel", "ms", [20], {
        thresholdMs: 250,
        workerCreated: true,
        observedProgressPercent: 1,
        stateUnchanged: true,
      }),
    ],
  };
}

test("Windows CIM 失败时稳定生成不可比较事实", () => {
  const facts = collectWindowsMachineFacts({
    platform: "win32",
    runProcess: () => ({ status: 1, stdout: "", error: undefined }),
  });
  assert.equal(facts.hardwareProbe.succeeded, false);
  assert.match(referenceEnvironmentIssues(facts).join("\n"), /采集未成功/u);
});

test("Windows CIM 采集物理核心、桌面机型与可用内存", () => {
  const facts = collectWindowsMachineFacts({
    platform: "win32",
    runProcess: () => ({
      status: 0,
      error: undefined,
      stdout: JSON.stringify({
        caption: "Microsoft Windows 11",
        version: "10.0.26100",
        buildNumber: 26100,
        osArchitecture: "64-bit",
        cpu: "Reference CPU",
        physicalCoreCount: 4,
        logicalCpuCount: 8,
        freePhysicalMemoryKb: 8 * 1024 ** 2,
        pcSystemType: 1,
        chassisTypes: [3],
      }),
    }),
  });
  assert.equal(facts.hardwareProbe.succeeded, true);
  assert.equal(facts.machineType, "desktop");
  assert.equal(facts.physicalCoreCount, 4);
  assert.equal(facts.availableMemoryBytes, 8 * 1024 ** 3);
});

test("Git provenance 使用无 shell 只读探针并保留脏树事实", () => {
  const calls = [];
  const provenance = collectGitProvenance({
    cwd: "C:\\repo",
    runProcess: (command, arguments_, options) => {
      calls.push({ command, arguments_, options });
      return arguments_[0] === "rev-parse"
        ? { status: 0, stdout: `${"a".repeat(40)}\n` }
        : { status: 0, stdout: " M apps/web/src/App.tsx\n" };
    },
  });
  assert.equal(provenance.testedCommit, "a".repeat(40));
  assert.equal(provenance.worktreeClean, false);
  assert.equal(
    calls.every((call) => call.options.shell === false),
    true,
  );
  assert.throws(
    () =>
      collectGitProvenance({
        runProcess: () => ({ status: 2, stdout: "", error: undefined }),
      }),
    /benchmark-git-head-probe-failed/u,
  );
  assert.throws(
    () =>
      collectGitProvenance({
        runProcess: (_command, arguments_) =>
          arguments_[0] === "rev-parse"
            ? { status: 0, stdout: `${"a".repeat(40)}\n` }
            : { status: 2, stdout: "", error: undefined },
      }),
    /benchmark-git-status-probe-failed/u,
  );
});

test("仓库证据探针冻结敏感路径并把 Git 失败显式降为失败", () => {
  const calls = [];
  const evidence = collectBenchmarkRepositoryEvidence("a".repeat(40), {
    runProcess: (_command, arguments_) => {
      calls.push(arguments_);
      if (arguments_[0] === "rev-parse")
        return { status: 0, stdout: `${"b".repeat(40)}\n` };
      if (arguments_[0] === "merge-base") return { status: 0, stdout: "" };
      return { status: 0, stdout: "apps/web/src/App.tsx\n" };
    },
  });
  assert.equal(evidence.testedCommitIsAncestor, true);
  assert.deepEqual(evidence.performanceSensitiveChangedPaths, [
    "apps/web/src/App.tsx",
  ]);
  const diffCall = calls.find((arguments_) => arguments_[0] === "diff");
  assert.ok(diffCall.includes("apps/web"));
  assert.ok(diffCall.includes("packages/renderer"));
  assert.ok(diffCall.includes("scripts/release-runner.mjs"));
  assert.ok(diffCall.includes("pnpm-lock.yaml"));

  const failed = collectBenchmarkRepositoryEvidence("a".repeat(40), {
    runProcess: () => ({ status: 2, stdout: "", error: undefined }),
  });
  assert.equal(failed.probeSucceeded, false);
});

test("正式 profile 同时通过严格 Schema 与语义门禁", async () => {
  const schema = JSON.parse(
    await readFile(
      new URL(
        "../tests/benchmarks/benchmark-profile-v1.schema.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const profile = validProfile();
  assert.equal(validate(profile), true, JSON.stringify(validate.errors));
  assert.deepEqual(validateOfficialBenchmarkProfile(profile), []);
});

test("正式 profile 拒绝非参考机器、缺场景、伪造统计与不足样本", () => {
  const nonReference = validProfile();
  nonReference.environment.logicalCpuCount = 20;
  nonReference.environment.comparable = false;
  assert.match(
    validateOfficialBenchmarkProfile(nonReference).join("\n"),
    /逻辑处理器数不是 8|comparable=true/u,
  );

  const missing = validProfile();
  missing.scenarios.pop();
  assert.match(
    validateOfficialBenchmarkProfile(missing).join("\n"),
    /必须包含 11 个固定场景/u,
  );

  const forged = validProfile();
  forged.scenarios[0].samples = [1000];
  forged.scenarios[0].p95 = 1;
  assert.match(
    validateOfficialBenchmarkProfile(forged).join("\n"),
    /样本数|p95 与样本不一致/u,
  );
});

test("正式 profile 拒绝脏树、无效提交和非系统 Edge 身份", () => {
  const dirty = validProfile();
  dirty.provenance.worktreeClean = false;
  assert.match(
    validateOfficialBenchmarkProfile(dirty).join("\n"),
    /干净工作树/u,
  );

  const invalidCommit = validProfile();
  invalidCommit.provenance.testedCommit = "not-a-commit";
  assert.match(
    validateOfficialBenchmarkProfile(invalidCommit).join("\n"),
    /40 位小写 Git SHA|Schema/u,
  );

  const otherBrowser = validProfile();
  otherBrowser.environment.browserChannel = "chromium";
  otherBrowser.environment.browserName = "Chromium";
  assert.match(
    validateOfficialBenchmarkProfile(otherBrowser).join("\n"),
    /msedge|Microsoft Edge/u,
  );

  const invalidVersion = validProfile();
  invalidVersion.environment.browserVersion = "Edge Stable";
  assert.match(
    validateOfficialBenchmarkProfile(invalidVersion).join("\n"),
    /四段数字版本|Schema/u,
  );
});

test("源码 provenance 允许仅非敏感提交，拒绝过期源码与非祖先", () => {
  const profile = validProfile();
  assert.deepEqual(
    validateBenchmarkSourceProvenance(profile, {
      probeSucceeded: true,
      testedCommitIsAncestor: true,
      performanceSensitiveChangedPaths: [],
    }),
    [],
  );
  assert.match(
    validateBenchmarkSourceProvenance(profile, {
      probeSucceeded: true,
      testedCommitIsAncestor: true,
      performanceSensitiveChangedPaths: ["packages/core/src/project.ts"],
    }).join("\n"),
    /性能敏感源码已变化/u,
  );
  assert.match(
    validateBenchmarkSourceProvenance(profile, {
      probeSucceeded: true,
      testedCommitIsAncestor: false,
      performanceSensitiveChangedPaths: [],
    }).join("\n"),
    /不是当前 HEAD 的祖先/u,
  );
});
