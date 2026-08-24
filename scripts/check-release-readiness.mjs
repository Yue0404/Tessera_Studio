import { spawnSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import {
  validateExtractorReleaseCatalogDocument,
  validateTraceabilityDocument,
} from "./release-evidence.mjs";
import {
  OFFICIAL_BENCHMARK_PROFILE_PATH,
  collectBenchmarkRepositoryEvidence,
} from "./benchmark-profile.mjs";
import {
  validateReleaseReadiness,
  verifyExtractorReleaseAssets,
} from "./release-readiness.mjs";

const root = resolve(import.meta.dirname, "..");
const readJson = async (path) =>
  JSON.parse(await readFile(resolve(root, path), "utf8"));

async function hasRootLicense() {
  for (const name of [
    "LICENSE",
    "LICENSE.md",
    "LICENSE.txt",
    "COPYING",
    "COPYING.md",
    "COPYING.txt",
  ]) {
    try {
      const candidate = await stat(resolve(root, name));
      if (candidate.isFile() && candidate.size > 0) return true;
    } catch {
      // 继续检查其余受支持的根级许可证文件名。
    }
  }
  return false;
}

const trace = await readJson("manual/requirements-traceability.json");
const acceptance = await readJson("manual/release-acceptance.json");
const releaseCatalog = await readJson(
  "apps/web/public/extractor-releases.json",
);
let benchmarkProfile;
try {
  benchmarkProfile = await readJson(OFFICIAL_BENCHMARK_PROFILE_PATH);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
const benchmarkProfileTracked =
  benchmarkProfile !== undefined &&
  spawnSync(
    "git",
    ["ls-files", "--error-unmatch", "--", OFFICIAL_BENCHMARK_PROFILE_PATH],
    {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    },
  ).status === 0;
const benchmarkRepositoryEvidence =
  benchmarkProfile === undefined
    ? undefined
    : collectBenchmarkRepositoryEvidence(
        benchmarkProfile?.provenance?.testedCommit,
        { cwd: root },
      );

const issues = [
  ...validateTraceabilityDocument(trace),
  ...validateExtractorReleaseCatalogDocument(releaseCatalog),
  ...validateReleaseReadiness({
    trace,
    acceptance,
    hasRootLicense: await hasRootLicense(),
    releaseCatalog,
    benchmarkProfile,
    benchmarkProfileTracked,
    benchmarkRepositoryEvidence,
  }),
];
if (issues.length === 0) {
  issues.push(...(await verifyExtractorReleaseAssets(releaseCatalog)));
}

if (issues.length > 0) {
  for (const issue of issues) console.error(`- ${issue}`);
  process.exitCode = 1;
} else {
  console.log(
    `正式发布就绪：${releaseCatalog.releases.length} 个提取器 Release 已逐字节验证。`,
  );
}
