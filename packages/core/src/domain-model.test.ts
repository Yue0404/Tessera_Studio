import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  axialToOddR,
  cellId,
  chunkCoordinateOf,
  createProject,
  edgeIdentity,
  EdgeManager,
  EdgeManagerError,
  EditorStore,
  oddRToAxial,
  SparseChunkStore,
  FillThresholdError,
} from "./index.js";

const input = {
  name: "M1",
  grid: { type: "square" as const, width: 40000, height: 40000, cellSize: 32 },
  style: {
    canvasBackground: "#09141DFF",
    defaultCellColor: "#14232DFF",
    gridColor: "#59656AFF",
    gridOpacity: 0.7,
    gridWidth: 1,
    defaultEdgeColor: "#59656AFF",
  },
};

describe("整数坐标与稀疏分块", () => {
  it("odd-r 与轴向整数坐标可往返", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 39999 }),
        fc.integer({ min: 0, max: 39999 }),
        (row, column) => {
          expect(axialToOddR(oddRToAxial({ row, column }))).toEqual({
            row,
            column,
          });
        },
      ),
    );
  });

  it("64×64 边界稳定映射且空白地图不创建桶", () => {
    const store = new SparseChunkStore();
    expect(store.bucketCount).toBe(0);
    expect(chunkCoordinateOf({ row: 63, column: 63 })).toEqual({
      chunkRow: 0,
      chunkColumn: 0,
    });
    expect(chunkCoordinateOf({ row: 64, column: 64 })).toEqual({
      chunkRow: 1,
      chunkColumn: 1,
    });
  });

  it("运行时 LRU 不淘汰含未提交显式内容的桶", () => {
    const store = new SparseChunkStore();
    store.touchRuntimeChunk(0, 0);
    store.touchRuntimeChunk(1, 1);
    store.set("cell:square:0:0", {
      instanceId: crypto.randomUUID(),
      cellId: "cell:square:0:0",
      row: 0,
      column: 0,
      fillColor: "#FFFFFFFF",
      fillOpacity: 1,
    });
    expect(store.evictRuntimeChunks(1)).toEqual(["1:1"]);
    expect(store.loadedChunkKeys).toEqual(["0:0"]);
  });
});

describe("Manager 唯一所有权与原子事务", () => {
  it("EdgeManager 错误使用稳定 code 与结构化 details", () => {
    const duplicate = {
      instanceId: crypto.randomUUID(),
      edgeId: "edge:square:0:0|0:1",
      adjacentCellIds: ["cell:square:0:0", "cell:square:0:1"],
      strokeColor: "#59656AFF",
      strokeWidth: 2,
      strokeOpacity: 1,
      lineStyle: "solid" as const,
    };
    try {
      new EdgeManager([duplicate, duplicate]);
      throw new Error("expected-edge-manager-error");
    } catch (error) {
      expect(error).toBeInstanceOf(EdgeManagerError);
      expect(error).toMatchObject({
        code: "edge-duplicate",
        message: "edge-duplicate",
        details: { edgeId: duplicate.edgeId },
      });
    }
  });
  it("相邻格查询严格复用同一 Edge 实例", () => {
    const store = new EditorStore(createProject(input));
    const left = edgeIdentity(input.grid, { row: 2, column: 2 }, 1);
    const right = edgeIdentity(input.grid, { row: 2, column: 3 }, 3);
    store.paintEdge(left.edgeId, left.adjacentCellIds, "#D9B866FF");
    expect(store.state.edges.get(left.edgeId)).toBe(
      store.state.edges.get(right.edgeId),
    );
  });

  it("框选空白派生边不会实例化 Edge", () => {
    const store = new EditorStore(createProject(input));
    const blank = edgeIdentity(input.grid, { row: 10, column: 10 }, 1);
    store.selectInstantiatedEdges([blank.edgeId]);
    expect(store.selection).toEqual([]);
    expect(store.state.edges.size).toBe(0);
    expect(store.state.cells.bucketCount).toBe(0);
  });

  it("边锚定标记跨 Edge/Overlay/Chunk 使用同一事务并整体撤销重做", () => {
    const store = new EditorStore(createProject(input));
    const identity = edgeIdentity(input.grid, { row: 70, column: 70 }, 1);
    const edge = {
      instanceId: crypto.randomUUID(),
      ...identity,
      strokeColor: "#59656AFF",
      strokeWidth: 2,
      strokeOpacity: 1,
      lineStyle: "solid" as const,
    };
    store.placeEdgeMarker(edge);
    const transactionId = store.state.lastTransactionId;
    expect(transactionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(store.state.edges.size).toBe(1);
    expect(store.state.overlays.size).toBe(1);
    expect(store.state.cells.bucketCount).toBe(1);
    store.undo();
    expect(store.state.lastTransactionId).toBe(transactionId);
    expect(store.state.edges.size).toBe(0);
    expect(store.state.overlays.size).toBe(0);
    expect(store.state.cells.bucketCount).toBe(0);
    store.redo();
    expect(store.state.edges.size).toBe(1);
    expect(store.state.overlays.size).toBe(1);
  });

  it("跨 Manager 中途失败会逆序回滚且不进入历史", () => {
    const store = new EditorStore(createProject(input));
    const invalidEdge = {
      instanceId: crypto.randomUUID(),
      edgeId: "edge:square:invalid",
      adjacentCellIds: ["not-a-cell-id"],
      strokeColor: "#59656AFF",
      strokeWidth: 2,
      strokeOpacity: 1,
      lineStyle: "solid" as const,
    };
    expect(() => store.placeEdgeMarker(invalidEdge)).toThrow("cell-id-invalid");
    expect(store.state.edges.size).toBe(0);
    expect(store.state.overlays.size).toBe(0);
    expect(store.state.cells.bucketCount).toBe(0);
    expect(store.state.revision).toBe(0);
    expect(store.canUndo).toBe(false);
  });

  it("批处理失败与显式取消都恢复批前状态", () => {
    const failed = new EditorStore(createProject(input));
    failed.beginBatch();
    failed.paintCell(1, 1, "#E3614DFF");
    expect(() => failed.paintCell(-1, 1, "#E3614DFF")).toThrow(
      "cell-coordinate-out-of-range",
    );
    expect(failed.state.cells.size).toBe(0);
    expect(failed.state.revision).toBe(0);
    expect(failed.canUndo).toBe(false);

    const cancelled = new EditorStore(createProject(input));
    cancelled.beginBatch();
    cancelled.paintCell(2, 2, "#E3614DFF");
    cancelled.cancelBatch();
    expect(cancelled.state.cells.size).toBe(0);
    expect(cancelled.state.revision).toBe(0);
    expect(cancelled.canUndo).toBe(false);
  });

  it("已有 batch 内跨 Manager 失败会连同先前步骤一起回滚", () => {
    const store = new EditorStore(createProject(input));
    store.beginBatch();
    store.paintCell(1, 1, "#E3614DFF");
    expect(() =>
      store.placeEdgeMarker({
        instanceId: crypto.randomUUID(),
        edgeId: "edge:square:invalid-in-batch",
        adjacentCellIds: ["not-a-cell-id"],
        strokeColor: "#59656AFF",
        strokeWidth: 2,
        strokeOpacity: 1,
        lineStyle: "solid",
      }),
    ).toThrow("cell-id-invalid");
    expect(store.state.cells.size).toBe(0);
    expect(store.state.edges.size).toBe(0);
    expect(store.state.overlays.size).toBe(0);
    expect(store.state.revision).toBe(0);
    expect(store.canUndo).toBe(false);
  });

  it("持久化确认后 clean 桶可被运行时 LRU 淘汰", () => {
    const store = new SparseChunkStore();
    store.touchRuntimeChunk(0, 0);
    store.set("cell:square:0:0", {
      instanceId: crypto.randomUUID(),
      cellId: "cell:square:0:0",
      row: 0,
      column: 0,
      fillColor: "#FFFFFFFF",
      fillOpacity: 1,
    });
    expect(store.evictRuntimeChunks(0)).toEqual([]);
    store.markAllClean();
    expect(store.evictRuntimeChunks(0)).toEqual(["0:0"]);
  });

  it("单个远端显式格只创建一个文件桶", () => {
    const store = new EditorStore(createProject(input));
    store.paintCell(39999, 39999, "#E3614DFF");
    expect(store.state.cells.size).toBe(1);
    expect(store.state.cells.bucketCount).toBe(1);
    expect([...store.state.cells.buckets()][0]).toMatchObject({
      chunkRow: 624,
      chunkColumn: 624,
    });
    expect(store.state.cells.get(cellId("square", 39999, 39999))).toBeDefined();
  });

  it("小范围填充与擦除保持单次事务，大默认区域被安全门拒绝", () => {
    const small = new EditorStore(
      createProject({ ...input, grid: { ...input.grid, width: 3, height: 3 } }),
    );
    expect(small.fillCells(0, 0, "#E3614DFF")).toBe(9);
    expect(small.state.cells.size).toBe(9);
    expect(small.state.revision).toBe(1);
    small.eraseCell(1, 1);
    expect(small.state.cells.size).toBe(8);

    const huge = new EditorStore(createProject(input));
    expect(() => huge.fillCells(0, 0, "#E3614DFF")).toThrow(FillThresholdError);
    expect(huge.state.cells.size).toBe(0);
    expect(huge.state.revision).toBe(0);
  });

  it("Shift 选择对同一对象执行切换而非重复加入", () => {
    const store = new EditorStore(createProject(input));
    const selected = { kind: "cell" as const, id: cellId("square", 1, 1) };
    store.select([selected]);
    store.select([selected], true);
    expect(store.selection).toEqual([]);
  });

  it("三类 Overlay 锚点保留边引用与自由 float 坐标", () => {
    const store = new EditorStore(createProject(input));
    store.placeMarker({ kind: "cell", cellId: cellId("square", 2, 2) });
    const edge = edgeIdentity(input.grid, { row: 2, column: 2 }, 1);
    store.placeEdgeText(
      {
        instanceId: crypto.randomUUID(),
        ...edge,
        strokeColor: "#59656AFF",
        strokeWidth: 2,
        strokeOpacity: 1,
        lineStyle: "solid",
      },
      "边文字",
    );
    store.placeText({ x: 12.25, y: 33.75 }, "自由文字");
    expect([...store.state.overlays.values()]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "anchored-overlay",
          anchor: { kind: "cell", cellId: cellId("square", 2, 2) },
        }),
        expect.objectContaining({
          kind: "anchored-overlay",
          anchor: { kind: "edge", edgeId: edge.edgeId },
        }),
        expect.objectContaining({
          kind: "free-overlay",
          point: { x: 12.25, y: 33.75 },
        }),
      ]),
    );
  });

  it("edge-midpoint 连线在单事务中按需创建共享 Edge", () => {
    const store = new EditorStore(createProject(input));
    const first = edgeIdentity(input.grid, { row: 3, column: 3 }, 1);
    const second = edgeIdentity(input.grid, { row: 3, column: 5 }, 3);
    store.setTool("connection");
    store.pointerDown({ x: 1, y: 1 }, first.edgeId);
    store.pointerDown({ x: 2, y: 2 }, second.edgeId);
    store.commitConnection(
      { kind: "edge-midpoint", edgeId: first.edgeId },
      { kind: "edge-midpoint", edgeId: second.edgeId },
      { kind: "line", label: "道路" },
      [first, second],
    );
    expect(store.state.edges.size).toBe(2);
    expect(store.state.connections.size).toBe(1);
    const transactionId = store.state.lastTransactionId;
    store.undo();
    expect(store.state.edges.size).toBe(0);
    expect(store.state.connections.size).toBe(0);
    expect(store.state.lastTransactionId).toBe(transactionId);
  });

  it("共享边完整样式可编辑并撤销", () => {
    const store = new EditorStore(createProject(input));
    const identity = edgeIdentity(input.grid, { row: 1, column: 1 }, 1);
    store.paintEdge(identity.edgeId, identity.adjacentCellIds, "#111111FF");
    store.updateEdgeStyle(identity.edgeId, {
      strokeColor: "#ABCDEF88",
      strokeWidth: 7,
      strokeOpacity: 0.4,
      lineStyle: "dashed",
    });
    expect(store.state.edges.get(identity.edgeId)).toMatchObject({
      strokeColor: "#ABCDEF88",
      strokeWidth: 7,
      strokeOpacity: 0.4,
      lineStyle: "dashed",
    });
    store.undo();
    expect(store.state.edges.get(identity.edgeId)?.lineStyle).toBe("solid");
  });

  it("删除锚定 Overlay 同步解除分块 owner，撤销可完整恢复", () => {
    const store = new EditorStore(createProject(input));
    const overlayId = store.placeText(
      { kind: "cell", cellId: cellId("square", 1, 1) },
      "待删除",
    );
    store.select([{ kind: "overlay", id: overlayId }]);
    store.deleteSelection();
    expect(store.state.overlays.size).toBe(0);
    expect(
      [...store.state.cells.buckets()].flatMap((bucket) => [
        ...bucket.ownedOverlayIds,
      ]),
    ).not.toContain(overlayId);
    store.undo();
    expect(store.state.overlays.get(overlayId)).toBeDefined();
    expect(
      [...store.state.cells.buckets()].flatMap((bucket) => [
        ...bucket.ownedOverlayIds,
      ]),
    ).toContain(overlayId);
  });

  it("删除最后一个边锚定引用会回收 reference-only Edge，撤销重做原子", () => {
    const store = new EditorStore(createProject(input));
    const identity = edgeIdentity(input.grid, { row: 4, column: 4 }, 1);
    const overlayId = store.placeEdgeMarker({
      instanceId: crypto.randomUUID(),
      ...identity,
      strokeColor: input.style.defaultEdgeColor,
      strokeWidth: 2,
      strokeOpacity: 1,
      lineStyle: "solid",
    });
    expect(store.state.edges.get(identity.edgeId)?.persistence).toBe(
      "reference-only",
    );
    store.select([{ kind: "overlay", id: overlayId }]);
    store.deleteSelection();
    expect(store.state.overlays.size).toBe(0);
    expect(store.state.edges.size).toBe(0);
    store.undo();
    expect(store.state.overlays.get(overlayId)).toBeDefined();
    expect(store.state.edges.get(identity.edgeId)?.persistence).toBe(
      "reference-only",
    );
    store.redo();
    expect(store.state.overlays.size).toBe(0);
    expect(store.state.edges.size).toBe(0);
  });

  it("显式编辑过的 Edge 删除最后 Overlay 后仍保留", () => {
    const store = new EditorStore(createProject(input));
    const identity = edgeIdentity(input.grid, { row: 5, column: 5 }, 1);
    store.paintEdge(
      identity.edgeId,
      identity.adjacentCellIds,
      input.style.defaultEdgeColor,
    );
    const overlayId = store.placeEdgeMarker({
      instanceId: crypto.randomUUID(),
      ...identity,
      strokeColor: input.style.defaultEdgeColor,
      strokeWidth: 2,
      strokeOpacity: 1,
      lineStyle: "solid",
    });
    expect(store.state.edges.get(identity.edgeId)?.persistence).toBe(
      "explicit-style",
    );
    store.select([{ kind: "overlay", id: overlayId }]);
    store.deleteSelection();
    expect(store.state.overlays.size).toBe(0);
    expect(store.state.edges.get(identity.edgeId)?.persistence).toBe(
      "explicit-style",
    );
  });

  it.each([
    ["内部", { row: 8, column: 8 }, 1],
    ["边界", { row: 0, column: 0 }, 0],
  ])(
    "%s reference-only Edge 在 Overlay/Connection 交叉引用下仅于最后引用删除时回收",
    (_label, coordinate, side) => {
      const store = new EditorStore(createProject(input));
      const identity = edgeIdentity(input.grid, coordinate, side);
      const overlayId = store.placeEdgeMarker({
        instanceId: crypto.randomUUID(),
        ...identity,
        strokeColor: input.style.defaultEdgeColor,
        strokeWidth: 2,
        strokeOpacity: 1,
        lineStyle: "solid",
      });
      store.setTool("connection");
      store.pointerDown({ x: 1, y: 1 }, identity.edgeId);
      store.pointerDown({ x: 2, y: 2 }, "point:2:2");
      const connectionId = store.commitConnection(
        { kind: "edge-midpoint", edgeId: identity.edgeId },
        { kind: "map-point", point: { x: 2.5, y: 2.75 } },
        { kind: "line" },
        [identity],
      );
      store.select([{ kind: "overlay", id: overlayId }]);
      store.deleteSelection();
      expect(store.state.edges.get(identity.edgeId)).toBeDefined();
      store.select([{ kind: "connection", id: connectionId }]);
      store.deleteSelection();
      expect(store.state.connections.size).toBe(0);
      expect(store.state.edges.size).toBe(0);
      expect(
        [...store.state.cells.buckets()].flatMap((bucket) => [
          ...bucket.ownedEdgeIds,
        ]),
      ).not.toContain(identity.edgeId);
      store.undo();
      expect(store.state.connections.get(connectionId)).toBeDefined();
      expect(store.state.edges.get(identity.edgeId)?.persistence).toBe(
        "reference-only",
      );
      store.redo();
      expect(store.state.connections.size).toBe(0);
      expect(store.state.edges.size).toBe(0);
      store.undo();
      store.undo();
      expect(store.state.connections.get(connectionId)).toBeDefined();
      expect(store.state.overlays.get(overlayId)).toBeDefined();
      store.select([{ kind: "connection", id: connectionId }]);
      store.deleteSelection();
      expect(store.state.edges.get(identity.edgeId)).toBeDefined();
      store.select([{ kind: "overlay", id: overlayId }]);
      store.deleteSelection();
      expect(store.state.edges.size).toBe(0);
    },
  );
});
