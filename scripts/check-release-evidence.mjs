import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import {
  missingRepositoryPaths,
  validateTraceabilityDocument,
  validateVisualEvidenceDocument,
} from "./release-evidence.mjs";

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

const issues = [
  ...validateTraceabilityDocument(trace),
  ...validateVisualEvidenceDocument(visuals),
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
  "仓库当前没有根级项目许可证",
]) {
  if (!readme.includes(required))
    issues.push(`README 缺少发布事实：${required}`);
}
if (!releaseNotes.includes("普通 Windows 10 22H2")) {
  issues.push("Release 说明未记录 Windows 10 支持阻塞");
}
if (!Array.isArray(releaseCatalog.releases)) {
  issues.push("提取器 release catalog 缺少 releases 数组");
}
for (const release of releaseCatalog.releases ?? []) {
  if (
    typeof release?.assetUrl !== "string" ||
    !release.assetUrl.startsWith(
      "https://github.com/Yue0404/Tessera_Studio/releases/download/",
    )
  ) {
    issues.push("提取器 release catalog 含非正式 GitHub Release URL");
  }
  if (
    typeof release?.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(release.sha256) ||
    /^0{64}$/u.test(release.sha256)
  ) {
    issues.push("提取器 release catalog 含占位或无效 SHA-256");
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
