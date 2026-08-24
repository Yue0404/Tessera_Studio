import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL(
  "../.github/workflows/civ6-extractor-release.yml",
  import.meta.url,
);
const publishScriptUrl = new URL(
  "../tools/civ6-extractor/scripts/publish-github-release.ps1",
  import.meta.url,
);
const buildScriptUrl = new URL(
  "../tools/civ6-extractor/scripts/build-release.ps1",
  import.meta.url,
);

function normalizeEol(value) {
  return value.replace(/\r\n?/gu, "\n");
}

async function readPortableText(url) {
  return normalizeEol(await readFile(url, "utf8"));
}

const [workflow, publishScript, buildScript] = await Promise.all([
  readPortableText(workflowUrl),
  readPortableText(publishScriptUrl),
  readPortableText(buildScriptUrl),
]);

test("发布契约读取在 LF 与 CRLF checkout 下保持相同语义", () => {
  const lfFixture = [
    "on:",
    "  workflow_dispatch:",
    "    inputs:",
    "      version:",
    "        required: true",
    "",
  ].join("\n");
  const crlfFixture = lfFixture.replaceAll("\n", "\r\n");
  for (const source of [lfFixture, crlfFixture]) {
    const normalized = normalizeEol(source);
    assert.match(normalized, /^on:\s*\n\s{2}workflow_dispatch:/mu);
    assert.match(
      normalized,
      /^\s{6}version:\n(?:.*\n){0,4}?\s{8}required: true$/mu,
    );
    assert.doesNotMatch(normalized, /\r/u);
  }
});

test("正式提取器发布只能手动触发并显式输入版本与 tag", () => {
  assert.match(workflow, /^on:\s*\n\s{2}workflow_dispatch:/mu);
  assert.doesNotMatch(workflow, /^\s{2}(?:push|pull_request|schedule):/mu);
  for (const input of ["version", "tag"]) {
    assert.match(
      workflow,
      new RegExp(
        `^\\s{6}${input}:\\n(?:.*\\n){0,4}?\\s{8}required: true$`,
        "mu",
      ),
    );
  }
});

test("发布工作流只在默认分支校验通过后授予 contents write", () => {
  assert.match(workflow, /^permissions: \{\}$/mu);
  assert.match(
    workflow,
    /validate-release-source:[\s\S]*?permissions: \{\}[\s\S]*?RELEASE_REF_NAME: \$\{\{ github\.ref_name \}\}[\s\S]*?REPOSITORY_DEFAULT_BRANCH: \$\{\{ github\.event\.repository\.default_branch \}\}[\s\S]*?throw "正式 Release 只能从默认分支/u,
  );
  assert.match(
    workflow,
    /publish-windows-release:[\s\S]*?needs: validate-release-source[\s\S]*?permissions:\n\s{6}contents: write/u,
  );
  assert.equal(workflow.match(/contents: write/gu)?.length, 1);
  assert.match(workflow, /persist-credentials: false/u);
  assert.match(workflow, /-SourceRefName "\$env:RELEASE_REF_NAME"/u);
  assert.match(workflow, /-DefaultBranch "\$env:REPOSITORY_DEFAULT_BRANCH"/u);
  assert.match(
    publishScript,
    /\$SourceRefName -cne \$DefaultBranch[\s\S]*?正式 Release 只能从仓库默认分支运行/u,
  );
});

test("发布先复用构建审计，再由草稿事务发布", () => {
  const releaseCheck = workflow.indexOf("pnpm release:check");
  const build = workflow.indexOf("build-release.ps1");
  const publish = workflow.indexOf("publish-github-release.ps1");
  assert.ok(releaseCheck >= 0 && releaseCheck < build && build < publish);
  assert.match(workflow, /CatalogOutputPath/u);
  assert.match(workflow, /actions\/upload-artifact@v4/u);
  assert.match(
    workflow,
    /-OutputRoot "\$\{\{ github\.workspace \}\}\/local-modules\/github-release"/u,
  );
  assert.doesNotMatch(workflow, /-OutputRoot "\$\{\{ runner\.temp \}\}/u);
  assert.doesNotMatch(workflow, /git\s+(?:add|commit|push)/u);
  assert.doesNotMatch(workflow, /-Version "\$\{\{ inputs\./u);
  assert.doesNotMatch(workflow, /-Tag "\$\{\{ inputs\./u);
});

test("远端 Release 严格保持 ZIP、SHA-256、summary 三项闭包", () => {
  assert.match(
    publishScript,
    /\$expectedAssetNames\s*=\s*@\([\s\S]*?\$artifactName,[\s\S]*?"\$artifactName\.sha256",[\s\S]*?"\$artifactName\.summary\.json"[\s\S]*?\)/u,
  );
  assert.match(
    publishScript,
    /\$Assets\.Count -ne \$expectedAssetNames\.Count/u,
  );
  assert.match(publishScript, /Get-ReleaseAssets/u);
  assert.match(
    publishScript,
    /Invoke-WebRequest[\s\S]*?application\/octet-stream/u,
  );
  const apiHostGate = publishScript.indexOf(
    "$assetApiUri.Host -cne 'api.github.com'",
  );
  const authorizedDownload = publishScript.indexOf(
    'Authorization = "Bearer $($env:GH_TOKEN)"',
  );
  assert.ok(apiHostGate >= 0 && apiHostGate < authorizedDownload);
  assert.match(
    publishScript,
    /\$Asset\.browser_download_url -cne \$ExpectedUrl/u,
  );
  assert.match(publishScript, /Get-FileHash[\s\S]*?-Algorithm SHA256/u);
});

test("draft 的 untagged URL 与发布后的 tag URL 分阶段严格验收", () => {
  const draftValidator = publishScript.slice(
    publishScript.indexOf("function Assert-DraftAssetBrowserUrl"),
    publishScript.indexOf("function Assert-PublishedAssetBrowserUrl"),
  );
  const publishedValidator = publishScript.slice(
    publishScript.indexOf("function Assert-PublishedAssetBrowserUrl"),
    publishScript.indexOf("function Undo-FailedPublishedRelease"),
  );
  const createDraft = publishScript.indexOf("$release = Invoke-GhJson");
  const draftUrlCheck = publishScript.indexOf(
    "Assert-DraftAssetBrowserUrl -Asset",
    createDraft,
  );
  const publish = publishScript.indexOf("'draft=false'");
  const publishedReadback = publishScript.indexOf("$publishedRelease =");
  const publishedUrlCheck = publishScript.indexOf(
    "Assert-PublishedAssetBrowserUrl -Asset",
    publishedReadback,
  );

  assert.match(draftValidator, /\/releases\/download\/untagged-/u);
  assert.match(draftValidator, /\$browserUri\.Host -cne 'github\.com'/u);
  assert.ok(
    draftValidator.includes("$draftToken -cnotmatch '^[A-Za-z0-9.-]+$'"),
  );
  assert.doesNotMatch(draftValidator, /\$Tag/u);
  assert.match(
    publishedValidator,
    /\$Asset\.browser_download_url -cne \$ExpectedUrl/u,
  );
  assert.match(
    publishScript,
    /\$expectedPublishedUrl = "https:\/\/github\.com\/\$Repository\/releases\/download\/\$Tag\/\$name"/u,
  );
  assert.ok(
    createDraft >= 0 &&
      createDraft < draftUrlCheck &&
      draftUrlCheck < publish &&
      publish < publishedReadback &&
      publishedReadback < publishedUrlCheck,
  );
});

test("失败路径不发布，发布后验收失败会显式回滚并保留诊断", () => {
  const createDraft = publishScript.indexOf("$release = Invoke-GhJson");
  const remoteDigest = publishScript.indexOf("远端 Release 资产逐字节复核失败");
  const finalDraftClosure = publishScript.indexOf(
    "$finalAssetsByName = Assert-AssetClosure",
  );
  const publish = publishScript.indexOf("'draft=false'");
  const publishedReadback = publishScript.indexOf("$publishedRelease =");
  const publishedClosure = publishScript.indexOf(
    "$publishedAssetsByName = Assert-AssetClosure",
  );
  const publishedUrlCheck = publishScript.indexOf(
    "Assert-PublishedAssetBrowserUrl -Asset",
    publishedReadback,
  );
  const catalogWrite = publishScript.indexOf("[IO.File]::WriteAllText");
  const catchBlock = publishScript.slice(
    publishScript.indexOf("catch {\n    $failure = $_"),
  );
  assert.ok(
    createDraft >= 0 &&
      createDraft < remoteDigest &&
      remoteDigest < finalDraftClosure &&
      finalDraftClosure < publish &&
      publish < publishedReadback &&
      publishedReadback < publishedClosure &&
      publishedClosure < publishedUrlCheck &&
      publishedUrlCheck < catalogWrite,
  );
  assert.match(catchBlock, /保持 draft/u);
  assert.match(catchBlock, /\$releaseState\.draft/u);
  assert.match(catchBlock, /无法回读/u);
  assert.match(catchBlock, /Undo-FailedPublishedRelease/u);
  assert.match(catchBlock, /自动回滚不完整/u);
  assert.doesNotMatch(catchBlock, /'draft=false'/u);
  assert.equal(publishScript.match(/'draft=false'/gu)?.length, 1);
  assert.match(
    publishScript,
    /'DELETE',[\s\S]*?releases\/\$ReleaseId[\s\S]*?'DELETE',[\s\S]*?git\/refs\/tags\/\$ReleaseTag/u,
  );
});

test("构建审计拒绝游戏资产、生成模块、绝对游戏路径与凭据", () => {
  for (const marker of [
    "'.artdef'",
    "'.blp'",
    "'.civbig'",
    "EndsWith('.tessera-module.zip'",
    "EndsWith('.tessera-preset.zip'",
    "Sid Meier''s Civilization VI",
    "SteamLibrary",
    "github_pat_",
    "PRIVATE KEY",
    "Authorization:\\s*Bearer",
  ]) {
    assert.ok(buildScript.includes(marker), `缺少发布边界标记：${marker}`);
  }
});
