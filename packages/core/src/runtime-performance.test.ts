import { describe, expect, it, vi } from "vitest";
import {
  BACKGROUND_OPERATION_LIMIT,
  BackgroundTaskError,
  MAX_HISTORY_DIFF_BYTES,
  planBatchOperation,
  serializeBackgroundTaskError,
  startBackgroundTask,
} from "./background-task.js";
import { createProject, EditorStore } from "./editor-store.js";
import { SparseChunkStore } from "./sparse-chunk-store.js";
import { SparseSpatialIndex } from "./sparse-spatial-index.js";
import {
  executeFillRegionWorkerPayload,
  startFillRegionTask,
} from "./fill-region.js";
import type {
  FillRegionWorkerRequest,
  FillRegionWorkerResponse,
} from "./fill-region-worker-protocol.js";
import type { ConnectionData, OverlayData } from "./types.js";

const style = {
  canvasBackground: "#111111FF",
  defaultCellColor: "#222222FF",
  gridColor: "#FFFFFFFF",
  gridOpacity: 1,
  gridWidth: 1,
  defaultEdgeColor: "#FFFFFFFF",
};

function project(width = 40_000, height = 40_000) {
  return createProject({
    name: "性能测试",
    grid: { type: "square", width, height, cellSize: 10 },
    style,
  });
}

function connection(id: string, x: number): ConnectionData {
  return {
    connectionId: id,
    kind: "line",
    elementId: "tessera.basic:connection.line",
    layerId: "tessera.basic.connection",
    start: { kind: "map-point", point: { x, y: 10 } },
    end: { kind: "map-point", point: { x: x + 20, y: 10 } },
    style: {
      strokeColor: "#FFFFFFFF",
      strokeWidth: 2,
      strokeOpacity: 1,
      lineStyle: "solid",
    },
    label: null,
  };
}

function marker(id: string, x: number): OverlayData {
  return {
    overlayId: id,
    kind: "free-overlay",
    elementId: "tessera.basic:marker",
    layerId: "tessera.basic.placed-object",
    orderInLayer: 0,
    point: { x, y: 10 },
    overlayType: "marker",
    style: {
      size: 10,
      rotation: 0,
      opacity: 1,
      color: "#FFFFFFFF",
      markerShape: "circle",
    },
    text: null,
  };
}

class FakeFillWorker {
  onmessage:
    ((event: { readonly data: FillRegionWorkerResponse }) => void) | null =
    null;
  onerror: ((event: { readonly message?: string }) => void) | null = null;
  request: FillRegionWorkerRequest | null = null;
  terminateCount = 0;

  postMessage(message: FillRegionWorkerRequest): void {
    this.request = message;
  }

  terminate(): void {
    this.terminateCount += 1;
  }

  emit(message: FillRegionWorkerResponse): void {
    this.onmessage?.({ data: message });
  }
}

describe("运行时视口分块缓存", () => {
  it("只枚举可见分块与最多两圈预取，并报告确定性命中", () => {
    const store = new SparseChunkStore();
    const grid = {
      type: "square" as const,
      width: 40_000,
      height: 40_000,
      cellSize: 10,
    };
    const visible = [{ row: 6_400, column: 6_400 }];
    const cold = store.updateRuntimeViewport(grid, visible, {
      prefetchRings: 2,
      maxLoaded: 32,
    });
    expect(cold).toMatchObject({
      visibleChunkCount: 1,
      prefetchedChunkCount: 24,
      hitCount: 0,
      missCount: 25,
      loadedChunkCount: 25,
    });
    const warm = store.updateRuntimeViewport(grid, visible, {
      prefetchRings: 2,
      maxLoaded: 32,
    });
    expect(warm.hitCount).toBe(25);
    expect(warm.missCount).toBe(0);
  });

  it("LRU 仅淘汰干净分块，脏分块即使超过上限也保留", () => {
    const store = new SparseChunkStore();
    const grid = {
      type: "square" as const,
      width: 400,
      height: 400,
      cellSize: 10,
    };
    store.set("cell:square:0:0", {
      instanceId: "cell-0",
      cellId: "cell:square:0:0",
      row: 0,
      column: 0,
      fillColor: "#FFFFFFFF",
      fillOpacity: 1,
    });
    store.updateRuntimeViewport(grid, [{ row: 0, column: 0 }], {
      prefetchRings: 0,
      maxLoaded: 1,
    });
    const moved = store.updateRuntimeViewport(
      grid,
      [{ row: 320, column: 320 }],
      {
        prefetchRings: 0,
        maxLoaded: 1,
      },
    );
    expect(store.loadedChunkKeys).toContain("0:0");
    expect(moved.dirtyRetainedCount).toBe(1);
    expect(moved.loadedChunkCount).toBe(2);
  });

  it("拒绝超过地图范围的视口坐标与超过两圈的预取", () => {
    const store = new SparseChunkStore();
    const grid = {
      type: "square" as const,
      width: 10,
      height: 10,
      cellSize: 10,
    };
    expect(() =>
      store.updateRuntimeViewport(grid, [{ row: 10, column: 0 }]),
    ).toThrow("cell-coordinate-out-of-range");
    expect(() =>
      store.updateRuntimeViewport(grid, [{ row: 0, column: 0 }], {
        prefetchRings: 3 as 2,
      }),
    ).toThrow("runtime-chunk-prefetch-invalid");
  });
});

describe("Connection/Overlay 稀疏空间索引", () => {
  it("增删移动均同步索引，局部查询不扫描全表", () => {
    const state = project();
    for (let index = 0; index < 100; index += 1) {
      state.connections.add(connection(`connection-${index}`, index * 2_000));
      state.overlays.add(marker(`overlay-${index}`, index * 2_000));
    }
    const rect = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    expect(
      state.connections.query(rect).map((value) => value.connectionId),
    ).toEqual(["connection-0"]);
    expect(state.connections.spatialIndexStats.candidateCount).toBeLessThan(
      100,
    );
    expect(state.overlays.query(rect).map((value) => value.overlayId)).toEqual([
      "overlay-0",
    ]);
    expect(state.overlays.spatialIndexStats.candidateCount).toBeLessThan(100);

    state.connections.replace(connection("connection-0", 20_000));
    state.overlays.replace(marker("overlay-0", 20_000));
    expect(state.connections.query(rect)).toEqual([]);
    expect(state.overlays.query(rect)).toEqual([]);
    expect(
      state.connections.query({
        minX: 19_990,
        minY: 0,
        maxX: 20_100,
        maxY: 100,
      })[0]?.connectionId,
    ).toBe("connection-0");
    expect(
      state.overlays.query({
        minX: 19_990,
        minY: 0,
        maxX: 20_100,
        maxY: 100,
      })[0]?.overlayId,
    ).toBe("overlay-0");
    state.connections.delete("connection-0");
    state.overlays.delete("overlay-0");
    expect(state.connections.spatialIndexStats.indexedCount).toBe(99);
    expect(state.overlays.spatialIndexStats.indexedCount).toBe(99);
  });

  it("超长对象进入溢出集合，不按巨大包围盒面积分配桶", () => {
    const index = new SparseSpatialIndex(640);
    index.upsert("跨图连线", {
      minX: 0,
      minY: 0,
      maxX: 400_000,
      maxY: 400_000,
    });
    expect(index.stats).toMatchObject({ indexedCount: 1, bucketCount: 0 });
    expect(
      index.query({
        minX: 199_990,
        minY: 199_990,
        maxX: 200_010,
        maxY: 200_010,
      }),
    ).toEqual(["跨图连线"]);
    expect(
      index.query({ minX: 0, minY: 0, maxX: 400_000, maxY: 400_000 }),
    ).toEqual(["跨图连线"]);
  });
});

describe("统一后台任务协议", () => {
  it("严格应用四档工作量与 64 MiB 历史差异门禁", () => {
    expect(
      planBatchOperation({ itemCount: 10_000, estimatedHistoryBytes: 0 }).mode,
    ).toBe("direct");
    expect(
      planBatchOperation({ itemCount: 10_001, estimatedHistoryBytes: 0 }).mode,
    ).toBe("background");
    expect(() =>
      planBatchOperation({
        itemCount: BACKGROUND_OPERATION_LIMIT + 1,
        estimatedHistoryBytes: 0,
      }),
    ).toThrow(expect.objectContaining({ code: "batch-confirmation-required" }));
    expect(() =>
      planBatchOperation({
        itemCount: BACKGROUND_OPERATION_LIMIT + 1,
        estimatedHistoryBytes: 0,
        confirmed: true,
      }),
    ).not.toThrow();
    expect(() =>
      planBatchOperation({
        itemCount: 1,
        estimatedHistoryBytes: MAX_HISTORY_DIFF_BYTES + 1,
      }),
    ).toThrow(expect.objectContaining({ code: "batch-history-too-large" }));
    expect(() =>
      planBatchOperation({ itemCount: 2_000_001, estimatedHistoryBytes: 0 }),
    ).toThrow(expect.objectContaining({ code: "batch-work-too-large" }));
  });

  it("超过 100ms 后发布单调进度并在 yield 边界观察取消", async () => {
    let clock = 0;
    const holder: {
      task?: ReturnType<typeof startBackgroundTask<number>>;
    } = {};
    const progress: number[] = [];
    const task = startBackgroundTask(
      { mode: "background", itemCount: 20_000, estimatedHistoryBytes: 0 },
      async (context) => {
        await context.checkpoint(5_000);
        await context.checkpoint(10_000);
        return 1;
      },
      {
        createTaskId: () => "task-1",
        now: () => clock,
        yieldToEventLoop: async () => {
          clock += 110;
          if (clock >= 220) holder.task?.cancel();
        },
      },
    );
    holder.task = task;
    task.subscribeProgress((event) => progress.push(event.progress));
    await expect(task.result).rejects.toMatchObject({
      code: "batch-task-cancelled",
    });
    expect(progress.length).toBeGreaterThan(0);
    expect(progress).toEqual([...progress].sort((left, right) => left - right));
  });

  it("10001 以上通过 Worker 协议规划，过滤其他 taskId 并转发进度", async () => {
    const state = project(101, 101);
    const worker = new FakeFillWorker();
    let clock = 0;
    const task = startFillRegionTask(state, 0, 0, "#FF0000FF", {
      workerFactory: () => worker,
      dependencies: {
        createTaskId: () => "fill-worker-1",
        now: () => clock,
      },
    });
    const progress: number[] = [];
    task.subscribeProgress((event) => progress.push(event.progress));
    await Promise.resolve();
    const request = worker.request;
    if (request === null) throw new Error("worker-request-missing");
    worker.emit({
      type: "result",
      taskId: "other-task",
      cells: [],
    });
    clock = 120;
    worker.emit({
      type: "progress",
      taskId: "fill-worker-1",
      completed: 5_000,
    });
    const cells = await executeFillRegionWorkerPayload(request.payload, {
      isCancelled: () => false,
      checkpoint: () => undefined,
    });
    worker.emit({
      type: "result",
      taskId: "fill-worker-1",
      cells,
    });
    await expect(task.result).resolves.toHaveLength(10_201);
    expect(progress[0]).toBeGreaterThan(0);
    expect(progress.at(-1)).toBe(1);
    expect(worker.terminateCount).toBe(1);
    expect(request.payload.sparseColors).toEqual([]);
  });

  it("Worker 结构化错误保持稳定 code，取消会立即 terminate", async () => {
    const errorWorker = new FakeFillWorker();
    const failed = startFillRegionTask(project(101, 101), 0, 0, "#FF0000FF", {
      workerFactory: () => errorWorker,
      dependencies: { createTaskId: () => "fill-worker-error" },
    });
    await Promise.resolve();
    errorWorker.emit({
      type: "error",
      taskId: "fill-worker-error",
      error: serializeBackgroundTaskError(
        new BackgroundTaskError(
          "batch-work-too-large",
          { itemCount: 20_001, maximum: 20_000 },
          "reduce-range",
        ),
      ),
    });
    await expect(failed.result).rejects.toMatchObject({
      code: "batch-work-too-large",
    });
    expect(errorWorker.terminateCount).toBe(1);

    const cancelWorker = new FakeFillWorker();
    const cancelled = startFillRegionTask(
      project(101, 101),
      0,
      0,
      "#FF0000FF",
      {
        workerFactory: () => cancelWorker,
        dependencies: { createTaskId: () => "fill-worker-cancel" },
      },
    );
    await Promise.resolve();
    cancelled.cancel();
    await expect(cancelled.result).rejects.toMatchObject({
      code: "batch-task-cancelled",
    });
    expect(cancelWorker.terminateCount).toBe(1);
  });

  it("direct 不创建 Worker，Worker factory 失败时从头 fallback", async () => {
    const directFactory = vi.fn(() => new FakeFillWorker());
    await expect(
      startFillRegionTask(project(100, 100), 0, 0, "#FF0000FF", {
        workerFactory: directFactory,
      }).result,
    ).resolves.toHaveLength(10_000);
    expect(directFactory).not.toHaveBeenCalled();

    const fallbackFactory = vi.fn(() => {
      throw new Error("worker-unavailable");
    });
    await expect(
      startFillRegionTask(project(101, 101), 0, 0, "#FF0000FF", {
        workerFactory: fallbackFactory,
        dependencies: { yieldToEventLoop: () => Promise.resolve() },
      }).result,
    ).resolves.toHaveLength(10_201);
    expect(fallbackFactory).toHaveBeenCalledOnce();
  });

  it("真实填充后台路径取消后不写入半成品", async () => {
    const store = new EditorStore(project(200, 100));
    let release: (() => void) | undefined;
    let yieldedResolve: (() => void) | undefined;
    let blockFirstYield = true;
    const yielded = new Promise<void>((resolve) => {
      yieldedResolve = resolve;
    });
    const task = store.startFillCells(0, 0, "#FF0000FF", {
      dependencies: {
        yieldToEventLoop: () =>
          blockFirstYield
            ? new Promise<void>((resolve) => {
                blockFirstYield = false;
                release = resolve;
                yieldedResolve?.();
              })
            : Promise.resolve(),
      },
    });
    await yielded;
    task.cancel();
    release?.();
    await expect(task.result).rejects.toMatchObject({
      code: "batch-task-cancelled",
    });
    expect(store.state.cells.size).toBe(0);
    expect(store.canUndo).toBe(false);
  });

  it("超限填充在复制稀疏快照前拒绝", () => {
    const state = project();
    const values = vi.spyOn(state.cells, "values").mockImplementation(() => {
      throw new Error("不应读取");
    });
    expect(() =>
      new EditorStore(state).startFillCells(0, 0, "#FF0000FF"),
    ).toThrow(expect.objectContaining({ code: "batch-work-too-large" }));
    expect(values).not.toHaveBeenCalled();
  });

  it("后台规划期间工程变化时拒绝旧快照且不覆盖新编辑", async () => {
    const store = new EditorStore(project(200, 100));
    let release: (() => void) | undefined;
    let yieldedResolve: (() => void) | undefined;
    let blockFirstYield = true;
    const yielded = new Promise<void>((resolve) => {
      yieldedResolve = resolve;
    });
    const task = store.startFillCells(0, 0, "#FF0000FF", {
      dependencies: {
        yieldToEventLoop: () =>
          blockFirstYield
            ? new Promise<void>((resolve) => {
                blockFirstYield = false;
                release = resolve;
                yieldedResolve?.();
              })
            : Promise.resolve(),
      },
    });
    await yielded;
    store.paintCell(0, 0, "#00FF00FF");
    release?.();
    await expect(task.result).rejects.toMatchObject({
      code: "batch-state-changed",
    });
    expect(store.state.cells.get("cell:square:0:0")?.fillColor).toBe(
      "#00FF00FF",
    );
    expect(store.state.cells.size).toBe(1);
  });
});
