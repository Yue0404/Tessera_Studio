import { lstat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

const REQUIREMENT_ID = /^[A-Z][A-Z0-9]*-[0-9]{3}$/u;
const VALID_STATUSES = new Set(["covered", "conditional", "blocked"]);
const REQUIRED_P1_STATUSES = new Map([
  ["EDIT-002", "covered"],
  ["LINK-007", "covered"],
  ["MOD-008", "covered"],
  ["LAYER-004", "covered"],
  ["DATA-006", "covered"],
  ["EXPORT-006", "covered"],
  ["UX-006", "covered"],
  ["UX-007", "covered"],
  ["A11Y-001", "covered"],
  ["A11Y-002", "covered"],
  ["A11Y-003", "covered"],
  ["A11Y-004", "covered"],
  ["PERF-002", "blocked"],
]);
const RELEASE_SHA256 = /^[a-f0-9]{64}$/u;

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function pushArrayIssues(issues, value, path) {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push(`${path} 必须是非空数组`);
    return [];
  }
  if (value.some((item) => typeof item !== "string" || item.length === 0)) {
    issues.push(`${path} 只能包含非空字符串`);
  }
  return value.filter((item) => typeof item === "string" && item.length > 0);
}

export function validateTraceabilityDocument(document) {
  const issues = [];
  if (document?.schemaVersion !== "1") {
    issues.push("requirements-traceability/schemaVersion 必须为 1");
  }
  const baseline = pushArrayIssues(
    issues,
    document?.p0RequirementIds,
    "p0RequirementIds",
  );
  for (const id of baseline) {
    if (!REQUIREMENT_ID.test(id)) issues.push(`P0 ID 不规范：${id}`);
  }
  for (const id of duplicateValues(baseline)) {
    issues.push(`P0 基线存在重复 ID：${id}`);
  }

  if (!Array.isArray(document?.entries) || document.entries.length === 0) {
    issues.push("entries 必须是非空数组");
    return issues;
  }
  const coveredIds = [];
  for (const [index, entry] of document.entries.entries()) {
    const path = `entries[${index}]`;
    if (typeof entry?.area !== "string" || entry.area.length === 0) {
      issues.push(`${path}.area 必须是非空字符串`);
    }
    const requirementIds = pushArrayIssues(
      issues,
      entry?.requirementIds,
      `${path}.requirementIds`,
    );
    coveredIds.push(...requirementIds);
    if (!VALID_STATUSES.has(entry?.status)) {
      issues.push(`${path}.status 无效`);
    }
    for (const key of ["implementation", "automatedTests", "humanEvidence"]) {
      pushArrayIssues(issues, entry?.[key], `${path}.${key}`);
    }
    if (
      (entry?.status === "conditional" || entry?.status === "blocked") &&
      (typeof entry?.blocker !== "string" || entry.blocker.length === 0)
    ) {
      issues.push(`${path} 必须说明 conditional/blocked 原因`);
    }
  }

  for (const id of duplicateValues(coveredIds)) {
    issues.push(`P0 ID 被重复映射：${id}`);
  }
  const baselineSet = new Set(baseline);
  const coveredSet = new Set(coveredIds);
  for (const id of baseline) {
    if (!coveredSet.has(id)) issues.push(`P0 ID 未映射：${id}`);
  }
  for (const id of coveredIds) {
    if (!baselineSet.has(id)) issues.push(`映射了非基线 P0 ID：${id}`);
  }
  const p1Baseline = pushArrayIssues(
    issues,
    document?.p1RequirementIds,
    "p1RequirementIds",
  );
  const p1Entries = Array.isArray(document?.trackedP1Evidence)
    ? document.trackedP1Evidence
    : [];
  if (p1Entries.length === 0) issues.push("trackedP1Evidence 必须是非空数组");
  const p1Mapped = [];
  const p1StatusById = new Map();
  for (const [index, entry] of p1Entries.entries()) {
    const path = `trackedP1Evidence[${index}]`;
    const ids = pushArrayIssues(
      issues,
      entry?.requirementIds,
      `${path}.requirementIds`,
    );
    p1Mapped.push(...ids);
    for (const id of ids) p1StatusById.set(id, entry?.status);
    if (!VALID_STATUSES.has(entry?.status)) issues.push(`${path}.status 无效`);
    for (const key of ["implementation", "automatedTests", "humanEvidence"]) {
      pushArrayIssues(issues, entry?.[key], `${path}.${key}`);
    }
    if (
      (entry?.status === "conditional" || entry?.status === "blocked") &&
      (typeof entry?.blocker !== "string" || entry.blocker.length === 0)
    ) {
      issues.push(`${path} 必须说明 conditional/blocked 原因`);
    }
  }
  for (const id of duplicateValues(p1Baseline))
    issues.push(`P1 基线存在重复 ID：${id}`);
  for (const id of duplicateValues(p1Mapped))
    issues.push(`P1 ID 被重复映射：${id}`);
  const p1Set = new Set(p1Baseline);
  const p1MappedSet = new Set(p1Mapped);
  for (const id of p1Baseline)
    if (!p1MappedSet.has(id)) issues.push(`P1 ID 未映射：${id}`);
  for (const id of p1Mapped)
    if (!p1Set.has(id)) issues.push(`映射了非基线 P1 ID：${id}`);
  // 这些发布候选状态已经由直接实现、自动化及人工证据共同裁定，防止整组回退。
  for (const [id, requiredStatus] of REQUIRED_P1_STATUSES) {
    const actualStatus = p1StatusById.get(id);
    if (actualStatus !== undefined && actualStatus !== requiredStatus) {
      issues.push(
        `P1 ${id} 必须保持 ${requiredStatus}，当前为 ${actualStatus}`,
      );
    }
  }
  return issues;
}

/** 候选检查只验证目录是可信的正式 GitHub Release 元数据，不要求已经发布。 */
export function validateExtractorReleaseCatalogDocument(document) {
  const issues = [];
  if (document?.schemaVersion !== "1") {
    issues.push("提取器 release catalog/schemaVersion 必须为 1");
  }
  if (!Array.isArray(document?.releases)) {
    issues.push("提取器 release catalog 缺少 releases 数组");
    return issues;
  }
  for (const [index, release] of document.releases.entries()) {
    const prefix = `提取器 release catalog/releases[${index}]`;
    if (
      typeof release?.assetUrl !== "string" ||
      !release.assetUrl.startsWith(
        "https://github.com/Yue0404/Tessera_Studio/releases/download/",
      )
    ) {
      issues.push(`${prefix} 含非正式 GitHub Release URL`);
    }
    if (
      typeof release?.sha256 !== "string" ||
      !RELEASE_SHA256.test(release.sha256) ||
      /^0{64}$/u.test(release.sha256)
    ) {
      issues.push(`${prefix} 含占位或无效 SHA-256`);
    }
    if (!Number.isSafeInteger(release?.bytes) || release.bytes <= 0) {
      issues.push(`${prefix} 的 bytes 必须是正安全整数`);
    }
  }
  return issues;
}

export function validateVisualEvidenceDocument(document) {
  const issues = [];
  if (document?.schemaVersion !== "1") {
    issues.push("visual-evidence/schemaVersion 必须为 1");
  }
  if (!Array.isArray(document?.entries) || document.entries.length === 0) {
    return [...issues, "visual-evidence/entries 必须是非空数组"];
  }
  const ids = [];
  for (const [index, entry] of document.entries.entries()) {
    const path = `visual entries[${index}]`;
    if (typeof entry?.id !== "string" || entry.id.length === 0) {
      issues.push(`${path}.id 必须是非空字符串`);
    } else {
      ids.push(entry.id);
    }
    if (entry?.kind !== "concept" && entry?.kind !== "browser") {
      issues.push(`${path}.kind 必须为 concept 或 browser`);
    }
    if (
      typeof entry?.path !== "string" ||
      !entry.path.startsWith("manual/assets/") ||
      !entry.path.endsWith(".png")
    ) {
      issues.push(`${path}.path 必须指向 manual/assets 下的 PNG`);
    }
    if (!Array.isArray(entry?.checks) || entry.checks.length === 0) {
      issues.push(`${path}.checks 必须是非空数组`);
    }
    if (entry?.kind === "browser") {
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(entry?.reviewedAt ?? "")) {
        issues.push(`${path}.reviewedAt 必须记录 YYYY-MM-DD 人工复核日期`);
      }
      const viewport = entry.viewport;
      if (
        !Number.isInteger(viewport?.width) ||
        !Number.isInteger(viewport?.height) ||
        viewport?.dpr !== 1
      ) {
        issues.push(`${path}.viewport 必须记录整数尺寸和 DPR=1`);
      }
    }
  }
  for (const id of duplicateValues(ids)) {
    issues.push(`视觉证据 ID 重复：${id}`);
  }
  return issues;
}

export async function missingRepositoryPaths(root, documents) {
  const paths = new Set();
  for (const document of documents) {
    const evidenceEntries = [
      ...(document.entries ?? []),
      ...(document.trackedP1Evidence ?? []),
    ];
    for (const entry of evidenceEntries) {
      if (typeof entry.path === "string") paths.add(entry.path);
      for (const key of ["implementation", "automatedTests", "humanEvidence"]) {
        for (const value of entry[key] ?? []) {
          if (typeof value === "string" && !value.startsWith("https://")) {
            paths.add(value);
          }
        }
      }
    }
  }
  const missing = [];
  const repositoryRoot = resolve(root);
  for (const path of [...paths].sort()) {
    const target = resolve(repositoryRoot, path);
    const repositoryRelative = relative(repositoryRoot, target);
    const outsideRepository =
      repositoryRelative === "" ||
      repositoryRelative === ".." ||
      repositoryRelative.startsWith(".." + sep) ||
      isAbsolute(repositoryRelative);
    if (
      isAbsolute(path) ||
      /^[A-Za-z]:[\\/]/u.test(path) ||
      path.startsWith("\\\\") ||
      outsideRepository
    ) {
      missing.push(path);
      continue;
    }
    try {
      if (!(await lstat(target)).isFile()) missing.push(path);
    } catch {
      missing.push(path);
    }
  }
  return missing;
}
