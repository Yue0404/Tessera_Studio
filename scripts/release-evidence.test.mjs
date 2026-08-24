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
import { validateReleaseLicenseStatements } from "./release-license-evidence.mjs";

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

const validReadmeLicenseText = `
除另有说明外，Tessera Studio 自有代码和自有资产依据根目录的 [PolyForm Noncommercial License 1.0.0](LICENSE) 提供，并附带 \`Required Notice: Copyright 2026 Yue0404\`。
该许可证不覆盖第三方依赖或第三方资产，也不对用户在本地生成或导入的 \`tessera.civ6\` 游戏资产重新授权；相关权利仍由各自权利人和适用条款决定。
`;
const validReleaseNotesLicenseText = `
根目录 \`LICENSE\` 采用官方未修改的 PolyForm Noncommercial License 1.0.0，并包含 \`Required Notice: Copyright 2026 Yue0404\`。
该许可证仅覆盖 Tessera Studio 自有代码和自有资产；第三方依赖、第三方资产、Civilization VI 游戏资产和用户在本地生成或导入的 \`tessera.civ6\` 模块不因此获得重新授权。
`;
const validExtractorLicenseText = `
The repository root LICENSE applies to the extractor's Tessera Studio-owned source code under the official, unmodified PolyForm Noncommercial License 1.0.0.
Required Notice: Copyright 2026 Yue0404
The repository license covers only Tessera Studio-owned code and assets.
The bundled .NET runtime and its third-party components remain under the license terms included separately as DOTNET-LICENSE.txt and DOTNET-THIRD-PARTY-NOTICES.txt.
Civilization VI game assets and locally generated or imported tessera.civ6 modules are not covered or relicensed by the repository license.
`;

test("发布文档必须完整陈述新的项目授权边界", () => {
  assert.deepEqual(
    validateReleaseLicenseStatements({
      readme: validReadmeLicenseText,
      releaseNotes: validReleaseNotesLicenseText,
      extractorNotice: validExtractorLicenseText,
    }),
    [],
  );

  const issues = validateReleaseLicenseStatements({
    readme:
      "PolyForm Noncommercial License 1.0.0 Required Notice: Copyright 2026 Yue0404",
    releaseNotes:
      "PolyForm Noncommercial License 1.0.0 Required Notice: Copyright 2026 Yue0404",
    extractorNotice:
      "PolyForm Noncommercial License 1.0.0 Required Notice: Copyright 2026 Yue0404",
  }).join("\n");
  assert.match(issues, /缺少准确的授权边界/u);
});

test("发布文档再次声称仓库没有许可证时必须失败", () => {
  for (const obsolete of [
    "仓库当前没有根级项目许可证",
    "仓库尚无根级项目许可证",
    "did not contain a repository-level LICENSE",
  ]) {
    const issues = validateReleaseLicenseStatements({
      readme: `${validReadmeLicenseText}\n${obsolete}`,
      releaseNotes: validReleaseNotesLicenseText,
      extractorNotice: validExtractorLicenseText,
    }).join("\n");
    assert.match(issues, /仍含过时的无许可证声明/u);
    assert.match(issues, new RegExp(obsolete.replaceAll(".", "\\."), "u"));
  }
});

test("提取器许可说明恢复旧英文无许可证声明时必须失败", () => {
  const issues = validateReleaseLicenseStatements({
    readme: validReadmeLicenseText,
    releaseNotes: validReleaseNotesLicenseText,
    extractorNotice: `${validExtractorLicenseText}\ndid not contain a repository-level LICENSE`,
  }).join("\n");
  assert.match(issues, /提取器许可说明 仍含过时的无许可证声明/u);
});
