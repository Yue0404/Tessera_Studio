import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeLineEndings } from "./line-ending.mjs";

test("Schema 生成比较忽略 Git 的 CRLF 展开", () => {
  const generated = "第一行\n第二行\n";
  const checkout = "第一行\r\n第二行\r\n";
  assert.equal(normalizeLineEndings(checkout), normalizeLineEndings(generated));
});

test("Schema 生成比较不掩盖内容和孤立 CR 差异", () => {
  assert.notEqual(
    normalizeLineEndings("事实 A\r"),
    normalizeLineEndings("事实 A\n"),
  );
  assert.notEqual(
    normalizeLineEndings("事实 A\n"),
    normalizeLineEndings("事实 B\n"),
  );
});
