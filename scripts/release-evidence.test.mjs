import assert from "node:assert/strict";
import test from "node:test";
import {
  validateTraceabilityDocument,
  validateVisualEvidenceDocument,
} from "./release-evidence.mjs";

const validEntry = {
  area: "测试",
  requirementIds: ["APP-001"],
  status: "covered",
  implementation: ["README.md"],
  automatedTests: ["scripts/release-evidence.test.mjs"],
  humanEvidence: ["manual/USER_GUIDE.zh-CN.md"],
};

test("追踪矩阵要求每个 P0 恰好映射一次", () => {
  assert.deepEqual(
    validateTraceabilityDocument({
      schemaVersion: "1",
      p0RequirementIds: ["APP-001"],
      entries: [validEntry],
    }),
    [],
  );
  assert.match(
    validateTraceabilityDocument({
      schemaVersion: "1",
      p0RequirementIds: ["APP-001", "DATA-001"],
      entries: [validEntry],
    }).join("\n"),
    /DATA-001/u,
  );
  assert.match(
    validateTraceabilityDocument({
      schemaVersion: "1",
      p0RequirementIds: ["APP-001"],
      entries: [validEntry, validEntry],
    }).join("\n"),
    /重复映射/u,
  );
});

test("条件或阻塞项必须给出原因", () => {
  const issues = validateTraceabilityDocument({
    schemaVersion: "1",
    p0RequirementIds: ["APP-001"],
    entries: [{ ...validEntry, status: "blocked" }],
  });
  assert.match(issues.join("\n"), /必须说明/u);
});

test("浏览器视觉证据必须记录视口和DPR", () => {
  assert.deepEqual(
    validateVisualEvidenceDocument({
      schemaVersion: "1",
      entries: [
        {
          id: "new-project",
          kind: "browser",
          path: "manual/assets/new-project.png",
          viewport: { width: 1440, height: 900, dpr: 1 },
          checks: ["可见"],
        },
      ],
    }),
    [],
  );
  assert.match(
    validateVisualEvidenceDocument({
      schemaVersion: "1",
      entries: [
        {
          id: "new-project",
          kind: "browser",
          path: "manual/assets/new-project.png",
          viewport: null,
          checks: ["可见"],
        },
      ],
    }).join("\n"),
    /viewport/u,
  );
});
