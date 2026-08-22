import { stat } from "node:fs/promises";
import { resolve } from "node:path";

const REQUIREMENT_ID = /^[A-Z][A-Z0-9]*-[0-9]{3}$/u;
const VALID_STATUSES = new Set(["covered", "conditional", "blocked"]);

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
    for (const entry of document.entries ?? []) {
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
  for (const path of [...paths].sort()) {
    try {
      await stat(resolve(root, path));
    } catch {
      missing.push(path);
    }
  }
  return missing;
}
