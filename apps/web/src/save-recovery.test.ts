import { describe, expect, it } from "vitest";
import { saveFailureTranslationKey } from "./save-recovery.js";

describe("保存失败恢复", () => {
  it("区分容量不足与存储不可用", () => {
    expect(
      saveFailureTranslationKey({ code: "storage-quota-write-failed" }),
    ).toBe("error.saveQuotaExceeded");
    expect(saveFailureTranslationKey({ code: "project-save-failed" })).toBe(
      "error.saveStorageUnavailable",
    );
    expect(saveFailureTranslationKey(new Error("opaque"))).toBe(
      "error.saveStorageUnavailable",
    );
  });
});
