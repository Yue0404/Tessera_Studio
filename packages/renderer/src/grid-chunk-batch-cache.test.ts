import { describe, expect, it, vi } from "vitest";
import { GridChunkBatchCache } from "./grid-chunk-batch-cache.js";

describe("GridChunkBatchCache", () => {
  it("只创建首次进入和 revision 变脏的分块", () => {
    const cache = new GridChunkBatchCache<{ key: string }>();
    const rebuild = vi.fn();
    const destroy = vi.fn();
    const callbacks = {
      create: (key: string) => ({ key }),
      rebuild,
      destroy,
    };
    const first = cache.update(
      [{ key: "0:0", revision: 1 }],
      new Set(["0:0"]),
      "style-a",
      callbacks,
    );
    const warm = cache.update(
      [{ key: "0:0", revision: 1 }],
      new Set(["0:0"]),
      "style-a",
      callbacks,
    );
    const dirty = cache.update(
      [{ key: "0:0", revision: 2 }],
      new Set(["0:0"]),
      "style-a",
      callbacks,
    );
    expect(first.rebuiltCount).toBe(1);
    expect(warm).toMatchObject({ rebuiltCount: 0, reusedCount: 1 });
    expect(dirty.rebuiltCount).toBe(1);
    expect(rebuild).toHaveBeenCalledTimes(2);
    expect(destroy).not.toHaveBeenCalled();
  });

  it("离开 retained LRU 后销毁，样式签名改变精确清空旧批次", () => {
    const cache = new GridChunkBatchCache<{ key: string }>();
    const destroy = vi.fn();
    const callbacks = {
      create: (key: string) => ({ key }),
      rebuild: vi.fn(),
      destroy,
    };
    cache.update(
      [
        { key: "0:0", revision: 0 },
        { key: "0:1", revision: 0 },
      ],
      new Set(["0:0", "0:1"]),
      "style-a",
      callbacks,
    );
    expect(
      cache.update(
        [{ key: "0:1", revision: 0 }],
        new Set(["0:1"]),
        "style-a",
        callbacks,
      ),
    ).toMatchObject({ batchCount: 1, evictedCount: 1 });
    expect(
      cache.update(
        [{ key: "0:1", revision: 0 }],
        new Set(["0:1"]),
        "style-b",
        callbacks,
      ),
    ).toMatchObject({ batchCount: 1, rebuiltCount: 1, evictedCount: 1 });
    expect(destroy).toHaveBeenCalledTimes(2);
  });
});
