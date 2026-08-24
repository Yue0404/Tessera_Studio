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
