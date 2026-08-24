import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import {
  missingRepositoryPaths,
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
const validP1 = {
  requirementIds: ["APP-004"],
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
      p1RequirementIds: ["APP-004"],
      trackedP1Evidence: [validP1],
    }),
    [],
  );
  assert.match(
    validateTraceabilityDocument({
      schemaVersion: "1",
      p0RequirementIds: ["APP-001", "DATA-001"],
      entries: [validEntry],
      p1RequirementIds: ["APP-004"],
      trackedP1Evidence: [validP1],
    }).join("\n"),
    /DATA-001/u,
  );
  assert.match(
    validateTraceabilityDocument({
      schemaVersion: "1",
      p0RequirementIds: ["APP-001"],
      entries: [validEntry, validEntry],
      p1RequirementIds: ["APP-004"],
      trackedP1Evidence: [validP1],
    }).join("\n"),
    /重复映射/u,
  );
});

test("每个 P1 也必须恰好映射一次，遗漏、重复和未知均失败", () => {
  const base = {
    schemaVersion: "1",
    p0RequirementIds: ["APP-001"],
    entries: [validEntry],
    p1RequirementIds: ["APP-004"],
  };
  assert.match(
    validateTraceabilityDocument({ ...base, trackedP1Evidence: [] }).join("\n"),
    /APP-004/u,
  );
  assert.match(
    validateTraceabilityDocument({
      ...base,
      trackedP1Evidence: [validP1, validP1],
    }).join("\n"),
    /重复映射/u,
  );
  assert.match(
    validateTraceabilityDocument({
      ...base,
      trackedP1Evidence: [{ ...validP1, requirementIds: ["UNKNOWN-999"] }],
    }).join("\n"),
    /非基线 P1/u,
  );
});

test("仓库路径校验覆盖 trackedP1Evidence 的独有文件", async () => {
  const root = await mkdtemp(join(tmpdir(), "tessera-release-evidence-"));
  const relativePath = "p1-only/evidence.txt";
  const document = {
    entries: [],
    trackedP1Evidence: [
      {
        implementation: [relativePath],
        automatedTests: ["https://example.com/automated"],
        humanEvidence: ["https://example.com/human"],
      },
    ],
  };
  try {
    assert.deepEqual(await missingRepositoryPaths(root, [document]), [
      relativePath,
    ]);

    await mkdir(join(root, "p1-only"));
    await writeFile(join(root, relativePath), "存在的 P1 证据\n", "utf8");
    assert.deepEqual(await missingRepositoryPaths(root, [document]), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("P0 与 P1 证据路径只接受仓库内的相对普通文件", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "tessera-evidence-boundary-"));
  const root = join(fixture, "repository");
  const validPath = "evidence/valid.txt";
  const directoryPath = "evidence/directory";
  const outsidePath = join(fixture, "outside.txt");
  try {
    await mkdir(join(root, "evidence", "directory"), { recursive: true });
    await writeFile(join(root, validPath), "有效证据\n", "utf8");
    await writeFile(outsidePath, "仓库外证据\n", "utf8");
    const escapedPath = relative(root, outsidePath);
    const invalidPaths = [outsidePath, escapedPath, directoryPath].sort();

    for (const collection of ["entries", "trackedP1Evidence"]) {
      const document = {
        entries: [],
        trackedP1Evidence: [],
        [collection]: [
          {
            implementation: [
              validPath,
              outsidePath,
              escapedPath,
              directoryPath,
            ],
            automatedTests: ["https://example.com/automated"],
            humanEvidence: ["https://example.com/human"],
          },
        ],
      };
      assert.deepEqual(
        await missingRepositoryPaths(root, [document]),
        invalidPaths,
      );
    }
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("条件或阻塞项必须给出原因", () => {
  const issues = validateTraceabilityDocument({
    schemaVersion: "1",
    p0RequirementIds: ["APP-001"],
    entries: [{ ...validEntry, status: "blocked" }],
    p1RequirementIds: ["APP-004"],
    trackedP1Evidence: [validP1],
  });
  assert.match(issues.join("\n"), /必须说明/u);
});

test("已裁定的 P1 与无障碍状态不得整体回退", () => {
  const makeDocument = (id, status) => ({
    schemaVersion: "1",
    p0RequirementIds: ["APP-001"],
    entries: [validEntry],
    p1RequirementIds: [id],
    trackedP1Evidence: [
      {
        ...validP1,
        requirementIds: [id],
        status,
        ...(status === "covered" ? {} : { blocker: "受控测试阻塞" }),
      },
    ],
  });
  assert.deepEqual(
    validateTraceabilityDocument(makeDocument("UX-007", "covered")),
    [],
  );
  assert.match(
    validateTraceabilityDocument(makeDocument("UX-007", "conditional")).join(
      "\n",
    ),
    /UX-007 必须保持 covered/u,
  );
  assert.deepEqual(
    validateTraceabilityDocument(makeDocument("PERF-002", "covered")),
    [],
  );
});

test("浏览器视觉证据必须记录视口和DPR", () => {
  assert.deepEqual(
    validateVisualEvidenceDocument({
      schemaVersion: "1",
      entries: [
        {
          id: "new-project",
          kind: "browser",
          reviewedAt: "2026-08-24",
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
          reviewedAt: "2026-08-24",
          path: "manual/assets/new-project.png",
          viewport: null,
          checks: ["可见"],
        },
      ],
    }).join("\n"),
    /viewport/u,
  );
});
