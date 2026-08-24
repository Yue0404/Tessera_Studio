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

  it("retained 条目重进后只销毁一次且活动对象数始终等于缓存数", () => {
    let nextId = 0;
    const live = new Set<number>();
    const destroyed = new Map<number, number>();
    const cache = new GridChunkBatchCache<{ id: number; key: string }>();
    const callbacks = {
      create: (key: string) => {
        const value = { id: ++nextId, key };
        live.add(value.id);
        return value;
      },
      rebuild: vi.fn(),
      destroy: (value: { id: number; key: string }) => {
        expect(live.delete(value.id)).toBe(true);
        destroyed.set(value.id, (destroyed.get(value.id) ?? 0) + 1);
      },
    };
    const update = (
      visible: readonly string[],
      retained: readonly string[],
    ) => {
      const stats = cache.update(
        visible.map((key) => ({ key, revision: 0 })),
        new Set(retained),
        "style-a",
        callbacks,
      );
      expect(live.size).toBe(stats.batchCount);
      return stats;
    };

    expect(update(["0:0", "0:1"], ["0:0", "0:1"]).batchCount).toBe(2);
    expect(update(["0:1", "0:2"], ["0:0", "0:1", "0:2"]).batchCount).toBe(3);
    expect(update(["0:2"], ["0:1", "0:2"])).toMatchObject({
      batchCount: 2,
      evictedCount: 1,
    });
    expect(update(["0:0", "0:2"], ["0:0", "0:2"])).toMatchObject({
      batchCount: 2,
      rebuiltCount: 1,
      evictedCount: 1,
    });

    expect(cache.clear(callbacks.destroy)).toBe(2);
    expect(live.size).toBe(0);
    expect([...destroyed.values()]).toEqual([1, 1, 1, 1]);
  });
});
