import { describe, expect, it } from "vitest";
import {
  FixedStorageEstimateGateway,
  MemoryOpfsGateway,
  StorageRepositoryError,
  isQuotaExceededError,
  requireStorageCapacity,
  toStorageRepositoryError,
} from "./index.js";

const COMMIT_ID = "10000000-0000-4000-8000-000000000001";

function stream(...chunks: readonly number[][]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk));
      controller.close();
    },
  });
}

describe("storage infrastructure", () => {
  it("容量计划显式包含 peak、ratio 与 256 MiB 安全余量", async () => {
    const plan = await requireStorageCapacity(
      new FixedStorageEstimateGateway({
        quota: 1024 * 1024 * 1024,
        usage: 0,
      }),
      10,
      20,
    );
    expect(plan).toMatchObject({
      mode: "estimated",
      archiveBytes: 10,
      expandedBytes: 20,
      peakBytes: 30,
      safetyMarginBytes: 256 * 1024 * 1024,
      availableBytes: 1024 * 1024 * 1024,
    });
    expect(plan.requiredBytes).toBe(plan.peakBytes + plan.safetyMarginBytes);
  });

  it("estimate 缺失、配额不足与派生量溢出使用稳定错误", async () => {
    await expect(
      requireStorageCapacity(
        new FixedStorageEstimateGateway(
          {
            quota: undefined,
            usage: undefined,
          },
          false,
        ),
        1,
        1,
      ),
    ).rejects.toMatchObject({ code: "storage-estimate-unavailable" });
    await expect(
      requireStorageCapacity(
        new FixedStorageEstimateGateway({ quota: 100, usage: 90 }),
        6,
        4,
        { minimumSafetyMarginBytes: 1, maximumPeakUsageRatio: 0.8 },
      ),
    ).rejects.toMatchObject({
      code: "storage-quota-insufficient",
      details: { requiredBytes: 13, availableBytes: 10 },
      uiAction: "free-space",
    });
    await expect(
      requireStorageCapacity(
        new FixedStorageEstimateGateway({
          quota: Number.MAX_SAFE_INTEGER,
          usage: 0,
        }),
        1,
        1,
        {
          minimumSafetyMarginBytes: 0,
          maximumPeakUsageRatio: Number.MIN_VALUE,
        },
      ),
    ).rejects.toMatchObject({
      code: "local-package-input-invalid",
      details: { field: "capacityPolicy" },
    });
  });

  it("estimate 缺失但持久化获准时进入逐文件 best-effort，拒绝或异常才失败", async () => {
    await expect(
      requireStorageCapacity(
        new FixedStorageEstimateGateway(
          { quota: undefined, usage: undefined },
          true,
        ),
        10,
        20,
      ),
    ).resolves.toMatchObject({
      mode: "persistent-best-effort",
      peakBytes: 30,
      availableBytes: null,
      quotaBytes: null,
      usageBytes: null,
    });
    await expect(
      requireStorageCapacity(
        {
          estimate: async () => ({ quota: undefined, usage: undefined }),
          requestPersistence: async () => {
            throw new Error("raw-persistence-error");
          },
        },
        10,
        20,
      ),
    ).rejects.toMatchObject({ code: "storage-estimate-unavailable" });
  });

  it("跨 realm QuotaExceededError 只按安全 name 映射且不泄漏 message", () => {
    const wrapped = { name: "QuotaExceededError", message: "secret-path" };
    expect(isQuotaExceededError(wrapped)).toBe(true);
    const error = toStorageRepositoryError(
      wrapped,
      "opfs-operation-failed",
      { operation: "write" },
      "retry",
    );
    expect(error).toMatchObject({
      code: "storage-quota-write-failed",
      message: "storage-quota-write-failed",
      details: { operation: "write" },
    });
    expect(JSON.stringify(error)).not.toContain("secret-path");
  });

  it("Memory OPFS exclusive commit 不覆盖旧字节且写入在越界块停止", async () => {
    const opfs = new MemoryOpfsGateway();
    await opfs.createCommitExclusive(COMMIT_ID);
    expect(await opfs.writeFile(COMMIT_ID, "file-000000", stream([1]), 1)).toBe(
      1,
    );
    await expect(opfs.createCommitExclusive(COMMIT_ID)).rejects.toMatchObject({
      code: "local-package-input-invalid",
      details: { reason: "collision" },
    });
    expect(await opfs.fileSize(COMMIT_ID, "file-000000")).toBe(1);

    const second = "10000000-0000-4000-8000-000000000002";
    await opfs.createCommitExclusive(second);
    let consumed = 0;
    const source = {
      async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
        consumed += 1;
        yield new Uint8Array([1]);
        consumed += 1;
        yield new Uint8Array([2, 3]);
        consumed += 1;
        yield new Uint8Array([4]);
      },
    };
    await expect(
      opfs.writeFile(second, "file-000000", source, 1),
    ).rejects.toMatchObject({
      code: "local-package-byte-count-mismatch",
      details: { declaredBytes: 1, actualBytesAtLeast: 3 },
    });
    expect(consumed).toBe(2);
    expect(await opfs.fileSize(second, "file-000000")).toBe(1);
  });

  it("稳定错误对象仅暴露 code/details/issues/action", () => {
    const error = new StorageRepositoryError(
      "local-package-not-ready",
      { identityKey: "module:example.test@1.0.0" },
      "retry",
    );
    expect(error).toMatchObject({
      code: "local-package-not-ready",
      message: "local-package-not-ready",
      issues: [],
      uiAction: "retry",
    });
  });
});
