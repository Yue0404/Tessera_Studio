import { describe, expect, it } from "vitest";
import { projectTextContentValid } from "./overlay-manager.js";

describe("projectTextContentValid", () => {
  it("按字素而非 UTF-16 单元限制 256 个字符", () => {
    expect(projectTextContentValid("👩🏽‍💻".repeat(256))).toBe(true);
    expect(projectTextContentValid("👩🏽‍💻".repeat(257))).toBe(false);
    expect(projectTextContentValid("e\u0301".repeat(256))).toBe(true);
  });

  it("统一识别 CRLF、LF 和单独 CR 的八行上限", () => {
    expect(projectTextContentValid("1\r2\n3\r\n4\n5\n6\n7\n8")).toBe(true);
    expect(projectTextContentValid("1\r2\r3\r4\r5\r6\r7\r8\r9")).toBe(false);
  });
});
