import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  browserMetadataFrom,
  classifyCompletedBrowserRun,
} from "./browser-support-matrix-result.mjs";

test("退出码成功但没有 browser.version 元数据仍判失败", () => {
  const missing = browserMetadataFrom("35 passed");
  assert.deepEqual(missing, { browserName: null, browserVersion: null });
  assert.deepEqual(classifyCompletedBrowserRun(0, missing), {
    status: "failed",
    reason: "browser-metadata-missing",
  });
  const present = browserMetadataFrom(
    '[tessera-browser-metadata]{"browserName":"firefox","browserVersion":"153.0"}',
  );
  assert.deepEqual(classifyCompletedBrowserRun(0, present), {
    status: "passed",
  });
});

test("Schema 约束 passed 与 unavailable 的身份字段", async () => {
  const schema = JSON.parse(
    await readFile(
      new URL(
        "../tests/browser-support/support-matrix-v1.schema.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const base = {
    profile: "support-matrix-v1",
    versionScope: "current",
    generatedAt: "2026-08-22T00:00:00.000Z",
    environment: { os: "test", arch: "x64", nodeVersion: "v24" },
    coverage: Array.from({ length: 6 }, (_, index) => ({
      flow: `flow-${index}`,
      specs: ["example.spec.ts"],
    })),
    previousMajor: {
      status: "not-tested",
      reason: "没有证据",
      automation: "固定镜像后执行",
    },
  };
  assert.equal(
    validate({
      ...base,
      runs: [
        {
          target: "firefox-playwright",
          status: "passed",
          channel: "firefox",
          browserName: "firefox",
          browserVersion: "153.0",
          exitCode: 0,
          durationMs: 1,
        },
      ],
    }),
    true,
  );
  assert.equal(
    validate({
      ...base,
      runs: [
        {
          target: "firefox-playwright",
          status: "passed",
          channel: "firefox",
          browserName: null,
          browserVersion: null,
          exitCode: 0,
          durationMs: 1,
        },
      ],
    }),
    false,
  );
  assert.equal(
    validate({
      ...base,
      runs: [
        {
          target: "chrome-system",
          status: "unavailable",
          channel: "chrome",
          browserName: null,
          browserVersion: null,
          exitCode: null,
          durationMs: 0,
        },
      ],
    }),
    false,
  );
  assert.equal(
    validate({
      ...base,
      versionScope: "previous",
      previousMajor: {
        status: "tested",
        reason: "固定前一主版本并完成测试",
        automation: "使用相同矩阵复跑",
      },
      runs: [
        {
          target: "firefox-playwright",
          status: "passed",
          channel: "firefox",
          browserName: "firefox",
          browserVersion: "152.0b1",
          exitCode: 0,
          durationMs: 1,
        },
      ],
    }),
    true,
  );
});
