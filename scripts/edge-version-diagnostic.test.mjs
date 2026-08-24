import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  classifyDiagnosticRun,
  diagnosticMessagesFrom,
} from "./edge-version-diagnostic-result.mjs";

const prefix = "[tessera-edge-diagnostic]";

function fact(caseId = "baseline", probeId = caseId, label = "current") {
  return {
    kind: "facts",
    caseId,
    probeId,
    label,
    browserVersion: "151.0.0.0",
    rendererStatus: "available",
    webglVendor: "Google Inc.",
    webglRenderer: "ANGLE",
  };
}

function errors(caseId = "baseline", probeId = caseId) {
  return {
    kind: "errors",
    caseId,
    probeId,
    pageErrors: [],
    consoleErrors: [],
    unhandledRejections: [],
  };
}

test("结构化日志提取并以精确版本、renderer 与页面错误分类", () => {
  const output = [
    "reporter prefix",
    `  ${prefix}${JSON.stringify(fact())}`,
    `${prefix}${JSON.stringify(errors())}`,
  ].join("\n");
  assert.equal(diagnosticMessagesFrom(output).length, 2);
  assert.equal(
    classifyDiagnosticRun({
      id: "baseline",
      exitCode: 0,
      durationMs: 12,
      output,
      expectedBrowserVersion: "151.0.0.0",
      expectedLabel: "current",
    }).status,
    "passed",
  );
  assert.match(
    classifyDiagnosticRun({
      id: "baseline",
      exitCode: 0,
      durationMs: 12,
      output,
      expectedBrowserVersion: "150.0.0.0",
      expectedLabel: "current",
    }).reason,
    /runtime-identity-invalid/u,
  );
});

test("错 case、错 A/B 标签与重复 sentinel probe 均不能伪造通过", () => {
  const classify = (facts, errorEntries, expectedProbeIds = ["baseline"]) =>
    classifyDiagnosticRun({
      id: "baseline",
      exitCode: 0,
      durationMs: 1,
      output: [...facts, ...errorEntries]
        .map((entry) => `${prefix}${JSON.stringify(entry)}`)
        .join("\n"),
      expectedBrowserVersion: "151.0.0.0",
      expectedLabel: "current",
      expectedProbeIds,
    });
  assert.match(
    classify([fact("wrong")], [errors("wrong")]).reason,
    /facts-identity-invalid/u,
  );
  assert.match(
    classify([fact("baseline", "baseline", "previous")], [errors()]).reason,
    /facts-identity-invalid/u,
  );
  assert.match(
    classify(
      [fact("baseline"), fact("baseline")],
      [errors("baseline"), errors("baseline")],
      ["baseline", "visual-export"],
    ).reason,
    /identity-invalid/u,
  );
  assert.match(classify([], []).reason, /count-invalid/u);
});

test("Schema 冻结六个独立用例与长生命周期哨兵", async () => {
  const schema = JSON.parse(
    await readFile(
      new URL(
        "../tests/browser-support/edge-diagnostic-v1.schema.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const resultEntry = (id) => ({
    id,
    status: "passed",
    exitCode: 0,
    durationMs: 1,
    facts: [fact(id)],
    errors: [errors(id)],
  });
  const valid = {
    profile: "edge-diagnostic-v1",
    label: "current",
    expectedBrowserVersion: "151.0.0.0",
    generatedAt: "2026-08-24T00:00:00.000Z",
    environment: { os: "win32", arch: "x64", nodeVersion: "v24" },
    cases: [
      "baseline",
      "data-workflow",
      "zoom-hit",
      "vertical-slice",
      "visual-export",
      "context-loss",
    ].map(resultEntry),
    sentinel: {
      ...resultEntry("long-lived-trace-sentinel"),
      facts: ["baseline", "visual-export", "context-loss"].map((probeId) =>
        fact("long-lived-trace-sentinel", probeId),
      ),
      errors: ["baseline", "visual-export", "context-loss"].map((probeId) =>
        errors("long-lived-trace-sentinel", probeId),
      ),
    },
    status: "passed",
  };
  assert.equal(validate(valid), true, ajv.errorsText(validate.errors));
  assert.equal(validate({ ...valid, cases: valid.cases.slice(0, 5) }), false);
});

test("工作流同 runner 先 current 后 previous，失败汇总后才退出", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/edge-previous-major.yml", import.meta.url),
    "utf8",
  );
  const current = workflow.indexOf("--label=current");
  const rollback = workflow.indexOf("ALLOWDOWNGRADE=1");
  const previous = workflow.indexOf("--label=previous");
  const summary = workflow.indexOf("if: always()");
  assert.ok(current >= 0 && current < rollback);
  assert.ok(rollback < previous && previous < summary);
  assert.match(workflow, /Get-AuthenticodeSignature/u);
  assert.match(workflow, /Microsoft Corporation/u);
  assert.match(workflow, /pw:api,pw:browser/u);
  assert.match(workflow, /测试后 Edge 文件版本：\$finalVersion/u);
  assert.doesNotMatch(workflow, /测试后 Edge 文件版本：`\$finalVersion`/u);
  assert.match(workflow, /EDGE_CURRENT_RESULT_EXISTS=True/u);
  assert.match(workflow, /EDGE_PREVIOUS_RESULT_EXISTS=True/u);
  assert.equal(workflow.match(/\bexit 0\b/gu)?.length, 2);
  assert.doesNotMatch(workflow, />>\s*\r?\n\s*\$env:GITHUB_STEP_SUMMARY/u);
  assert.doesNotMatch(workflow, />>\s*\$env:GITHUB_STEP_SUMMARY/u);
  assert.match(workflow, /Add-Content[\s\S]*GITHUB_STEP_SUMMARY/u);
  const summaryStep = workflow.slice(summary);
  const executableGuard = summaryStep.indexOf(
    "IsNullOrWhiteSpace($env:EDGE_EXECUTABLE)",
  );
  const finalVersionRead = summaryStep.indexOf(
    "[Diagnostics.FileVersionInfo]::GetVersionInfo",
  );
  assert.ok(executableGuard >= 0 && executableGuard < finalVersionRead);
  assert.match(summaryStep, /Test-Path[\s\S]*-PathType Leaf/u);
  assert.match(summaryStep, /Edge 可执行文件路径缺失或无效/u);
  assert.doesNotMatch(workflow, /support:matrix/u);
  assert.doesNotMatch(workflow, /upload-artifact/u);
});

test("Edge 诊断总预算留足余量且单动作与导航仍有独立上限", async () => {
  const config = await readFile(
    new URL("../playwright.edge-diagnostic.config.ts", import.meta.url),
    "utf8",
  );
  assert.match(config, /timeout:\s*180_000/u);
  assert.match(config, /actionTimeout:\s*30_000/u);
  assert.match(config, /navigationTimeout:\s*30_000/u);
});

test("跨 context 下载使用本用例持久路径且手册锁定真实 run 地址", async () => {
  const diagnosticSpec = await readFile(
    new URL(
      "../tests/edge-diagnostic/edge-browser-diagnostic.spec.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(diagnosticSpec, /testInfo\.outputPath\(/u);
  assert.match(diagnosticSpec, /download\.saveAs\(downloadPath\)/u);
  assert.doesNotMatch(diagnosticSpec, /download\.path\(\)/u);

  const manual = await readFile(
    new URL("../manual/M4_BROWSER_EVIDENCE.zh-CN.md", import.meta.url),
    "utf8",
  );
  assert.match(
    manual,
    /https:\/\/github\.com\/Yue0404\/Tessera_Studio\/actions\/runs\/32693990026/u,
  );
  assert.doesNotMatch(manual, /Yue-plus\/Tessera-Studio/u);
});
