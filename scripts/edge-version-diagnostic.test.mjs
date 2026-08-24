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

function fact(caseId = "baseline") {
  return {
    kind: "facts",
    caseId,
    label: "current",
    browserVersion: "151.0.0.0",
    rendererStatus: "available",
    webglVendor: "Google Inc.",
    webglRenderer: "ANGLE",
  };
}

function errors(caseId = "baseline") {
  return {
    kind: "errors",
    caseId,
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
    }).reason,
    /runtime-identity-invalid/u,
  );
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
      facts: [
        fact("long-lived-trace-sentinel"),
        fact("long-lived-trace-sentinel"),
        fact("long-lived-trace-sentinel"),
      ],
      errors: [
        errors("long-lived-trace-sentinel"),
        errors("long-lived-trace-sentinel"),
        errors("long-lived-trace-sentinel"),
      ],
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
  assert.doesNotMatch(workflow, /support:matrix/u);
  assert.doesNotMatch(workflow, /upload-artifact/u);
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
