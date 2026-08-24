import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import {
  missingRepositoryPaths,
  validateExtractorReleaseCatalogDocument,
  validateTraceabilityDocument,
  validateVisualEvidenceDocument,
} from "./release-evidence.mjs";
import { validateReleaseLicenseStatements } from "./release-license-evidence.mjs";

const root = resolve(import.meta.dirname, "..");
const readJson = async (path) =>
  JSON.parse(await readFile(resolve(root, path), "utf8"));

const trace = await readJson("manual/requirements-traceability.json");
const visuals = await readJson("manual/visual-evidence.json");
const releaseCatalog = await readJson(
  "apps/web/public/extractor-releases.json",
);
const readme = await readFile(resolve(root, "README.md"), "utf8");
const releaseNotes = await readFile(
  resolve(root, "manual/RELEASE_NOTES.md"),
  "utf8",
);
const extractorNotice = await readFile(
  resolve(root, "tools/civ6-extractor/release/SOURCE-AND-LICENSE.txt"),
  "utf8",
);

const issues = [
  ...validateTraceabilityDocument(trace),
  ...validateVisualEvidenceDocument(visuals),
  ...validateExtractorReleaseCatalogDocument(releaseCatalog),
  ...validateReleaseLicenseStatements({
    readme,
    releaseNotes,
    extractorNotice,
  }),
];
for (const path of await missingRepositoryPaths(root, [trace, visuals])) {
  issues.push(`证据路径不存在：${path}`);
}

for (const forbidden of ["正三角形", "当前项目尚处于初始化阶段"]) {
  if (readme.includes(forbidden))
    issues.push(`README 仍含过时文案：${forbidden}`);
}
for (const required of [
  "pnpm e2e --workers=1",
  "pnpm e2e:production",
  "pnpm e2e:pages",
  "完整 Tessera Project",
]) {
  if (!readme.includes(required))
    issues.push(`README 缺少发布事实：${required}`);
}
for (const required of [
  "核心静态网站仍面向 Windows 10+",
  "Windows 11 24H2+ x64",
]) {
  if (!releaseNotes.includes(required)) {
    issues.push(`Release 说明缺少 Windows 支持边界：${required}`);
  }
}
if (issues.length > 0) {
  for (const issue of issues) console.error(`- ${issue}`);
  process.exitCode = 1;
} else {
  const mapped = trace.entries.flatMap((entry) => entry.requirementIds).length;
  const blocked = trace.entries.filter((entry) => entry.status === "blocked");
  console.log(
    `发布证据检查通过：${mapped} 个 P0 ID，${visuals.entries.length} 项视觉证据，${blocked.length} 个已解释阻塞。`,
  );
}
