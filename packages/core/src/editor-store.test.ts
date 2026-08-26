import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  cellCenter,
  createProject,
  edgeIdentity,
  EditorStore,
  type FixedLayerState,
  mapPointToCell,
} from "./index.js";

const input = {
  name: "test",
  grid: { type: "square" as const, width: 20, height: 20, cellSize: 32 },
  style: {
    canvasBackground: "#09141DFF",
    defaultCellColor: "#14232DFF",
    gridColor: "#59656AFF",
    gridOpacity: 0.7,
    gridWidth: 1,
    defaultEdgeColor: "#59656AFF",
  },
};

describe("EditorStore", () => {
  it("普通指针移动不发布、不改变工程或保存事务标识", () => {
    const store = new EditorStore(createProject(input));
    let published = 0;
    store.subscribe(() => {
      published += 1;
    });
    const before = {
      version: store.version,
      revision: store.state.revision,
      transactionId: store.state.lastTransactionId,
    };

    store.pointerDown({ x: 1, y: 1 }, "cell:square:0:0");
    store.pointerMove({ x: 2, y: 2 });
    store.pointerUp({ x: 2, y: 2 });

    expect(published).toBe(0);
    expect(store.version).toBe(before.version);
    expect(store.state.revision).toBe(before.revision);
    expect(store.state.lastTransactionId).toBe(before.transactionId);

    store.setTool("box-select");
    published = 0;
    store.pointerDown({ x: 1, y: 1 }, null);
    store.pointerMove({ x: 1, y: 1 });
    store.pointerMove({ x: 2, y: 2 });
    store.pointerUp({ x: 2, y: 2 });
    expect(published).toBe(3);
  });

  it("扩展模块连接无论提交成功或失败都复位状态机", () => {
    const store = new EditorStore(createProject(input));
    store.setTool("connection");
    store.pointerDown({ x: 1, y: 1 }, "cell:square:0:0");
    store.pointerDown({ x: 2, y: 2 }, "cell:square:0:1");
    expect(store.commitExternalConnection(() => "module-connection")).toBe(
      "module-connection",
    );
    expect(store.toolState.phase).toBe("choosing-start");

    store.pointerDown({ x: 1, y: 1 }, "cell:square:0:0");
    store.pointerDown({ x: 2, y: 2 }, "cell:square:0:1");
    expect(store.commitExternalConnection(() => "")).toBe("");
    expect(store.toolState).toMatchObject({
      phase: "choosing-start",
      startCellId: null,
      startPoint: null,
    });

    store.pointerDown({ x: 1, y: 1 }, "cell:square:0:0");
    store.pointerDown({ x: 2, y: 2 }, "cell:square:0:1");
    expect(() =>
      store.commitExternalConnection(() => {
        throw new Error("module-placement-failed");
      }),
    ).toThrow("module-placement-failed");
    expect(store.toolState.phase).toBe("choosing-start");
  });

  it("可撤销和重做地格修改", () => {
    const store = new EditorStore(createProject(input));
    store.paintCell(1, 2, "#E3614DFF");
    expect(store.state.cells.size).toBe(1);
    store.undo();
    expect(store.state.cells.size).toBe(0);
    store.redo();
    expect(store.state.cells.size).toBe(1);
  });

  it("相邻地格得到相同共享边 ID", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 18 }),
        fc.integer({ min: 1, max: 18 }),
        (row, column) => {
          const grid = input.grid;
          const right = edgeIdentity(grid, { row, column }, 1);
          const left = edgeIdentity(grid, { row, column: column + 1 }, 3);
          expect(right.edgeId).toBe(left.edgeId);
        },
      ),
    );
  });

  it("EdgeManager 对共享边返回严格相同对象", () => {
    const store = new EditorStore(createProject(input));
    const fromLeft = edgeIdentity(input.grid, { row: 3, column: 3 }, 1);
    const fromRight = edgeIdentity(input.grid, { row: 3, column: 4 }, 3);
    store.paintEdge(fromLeft.edgeId, fromLeft.adjacentCellIds, "#D9B866FF");
    const first = store.state.edges.get(fromLeft.edgeId);
    store.paintEdge(fromRight.edgeId, fromRight.adjacentCellIds, "#E3614DFF");
    expect(store.state.edges.get(fromRight.edgeId)).toBe(first);
    expect(store.state.edges.size).toBe(1);
  });

  it("两种网格的中心投影可往返", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("square" as const, "hex-pointy" as const),
        fc.integer({ min: 0, max: 19 }),
        fc.integer({ min: 0, max: 19 }),
        (type, row, column) => {
          const grid = { type, width: 20, height: 20, cellSize: 32 };
          expect(mapPointToCell(grid, cellCenter(grid, row, column))).toEqual({
            row,
            column,
          });
        },
      ),
    );
  });

  it.each([
    ["square", 4],
    ["hex-pointy", 6],
  ] as const)("%s 内部地格具有 %i 条互异共享边", (type, sideCount) => {
    const grid = { type, width: 20, height: 20, cellSize: 32 };
    const edges = Array.from({ length: sideCount }, (_, side) =>
      edgeIdentity(grid, { row: 10, column: 10 }, side),
    );
    expect(new Set(edges.map((edge) => edge.edgeId)).size).toBe(sideCount);
    expect(edges.every((edge) => edge.adjacentCellIds.length === 2)).toBe(true);
  });

  it("尖顶六边形 odd-r 奇数行向右偏移半个列步长", () => {
    const grid = {
      type: "hex-pointy" as const,
      width: 20,
      height: 20,
      cellSize: 32,
    };
    const even = cellCenter(grid, 2, 3);
    const odd = cellCenter(grid, 3, 3);
    expect(odd.x - even.x).toBeCloseTo((Math.sqrt(3) * grid.cellSize) / 2);
  });

  it("缺失模块占位层不可被解锁", () => {
    const project = createProject(input);
    (project.layers as Map<string, FixedLayerState>).set(
      "example.missing.layer",
      {
        layerId: "example.missing.layer",
        moduleVersion: "1.0.0",
        zIndex: 1200,
        visible: true,
        locked: true,
        opacity: 1,
        allowedKinds: [],
        runtimeStatus: "missing",
      },
    );
    const store = new EditorStore(project);

    expect(() =>
      store.setLayerState("example.missing.layer", { locked: false }),
    ).toThrow("missing-module-layer-must-stay-locked");
    store.setLayerState("example.missing.layer", { visible: false });
    expect(store.state.layers.get("example.missing.layer")).toMatchObject({
      visible: false,
      locked: true,
      runtimeStatus: "missing",
    });
  });

  it.each(["square", "hex-pointy"] as const)(
    "%s 箭头可反转和重绑定端点，撤销重做保持空间索引一致",
    (type) => {
      const store = new EditorStore(
        createProject({ ...input, grid: { ...input.grid, type } }),
      );
      const firstId = `cell:${type}:1:1`;
      const secondId = `cell:${type}:1:3`;
      const reboundId = `cell:${type}:2:4`;
      const connectionId = store.createConnection(
        { kind: "cell-center", cellId: firstId },
        { kind: "cell-center", cellId: secondId },
        { kind: "arrow", arrowMode: "end" },
      );
      const before = structuredClone(store.state.connections.get(connectionId));

      expect(store.reverseConnection(connectionId)).toBe(true);
      expect(store.state.connections.get(connectionId)).toMatchObject({
        start: { kind: "cell-center", cellId: secondId },
        end: { kind: "cell-center", cellId: firstId },
        arrowStart: true,
        arrowEnd: false,
      });
      expect(
        store.rebindConnectionCellEndpoint(connectionId, "end", reboundId),
      ).toBe(true);
      expect(store.state.connections.get(connectionId)?.end).toEqual({
        kind: "cell-center",
        cellId: reboundId,
      });
      expect(
        store.state.connections.query({
          minX: 0,
          minY: 0,
          maxX: 500,
          maxY: 500,
        }),
      ).toHaveLength(1);

      store.undo();
      store.undo();
      expect(store.state.connections.get(connectionId)).toEqual(before);
      store.redo();
      store.redo();
      expect(store.state.connections.get(connectionId)?.end).toEqual({
        kind: "cell-center",
        cellId: reboundId,
      });
    },
  );

  it.each([
    ["locked", { locked: true }, "layer-locked"],
    ["hidden", { visible: false }, "layer-hidden"],
    [
      "missing",
      { locked: true, runtimeStatus: "missing" },
      "layer-module-missing",
    ],
  ] as const)(
    "%s 图层拒绝连接与标记修改，并暴露稳定的单次拒绝结果",
    (_label, layerPatch, code) => {
      const store = new EditorStore(createProject(input));
      const connectionId = store.createConnection(
        { kind: "cell-center", cellId: "cell:square:1:1" },
        { kind: "cell-center", cellId: "cell:square:1:2" },
        { kind: "arrow", arrowMode: "end" },
      );
      const markerId = store.placeMarker(
        { kind: "cell", cellId: "cell:square:2:2" },
        "#123456FF",
        "circle",
      );
      const connectionBefore = structuredClone(
        store.state.connections.get(connectionId),
      );
      const markerBefore = structuredClone(store.state.overlays.get(markerId));
      const layers = store.state.layers as Map<string, FixedLayerState>;
      const connectionLayer = layers.get("tessera.basic.connection");
      if (connectionLayer === undefined)
        throw new Error("connection-layer-missing");
      layers.set("tessera.basic.connection", {
        ...connectionLayer,
        ...layerPatch,
      });
      const versionBefore = store.version;
      expect(store.reverseConnection(connectionId)).toBe(false);
      expect(store.operationRejection).toEqual({
        code,
        layerId: "tessera.basic.connection",
      });
      const versionAfterFirstRejection = store.version;
      expect(versionAfterFirstRejection).toBe(versionBefore + 1);
      expect(store.reverseConnection(connectionId)).toBe(false);
      expect(store.version).toBe(versionAfterFirstRejection);
      expect(store.state.connections.get(connectionId)).toEqual(
        connectionBefore,
      );

      const markerLayer = layers.get("tessera.basic.placed-object");
      if (markerLayer === undefined) throw new Error("marker-layer-missing");
      layers.set("tessera.basic.placed-object", {
        ...markerLayer,
        ...layerPatch,
      });
      if (markerBefore === undefined || markerBefore.overlayType !== "marker") {
        throw new Error("marker-not-found");
      }
      store.updateOverlay(markerId, {
        ...markerBefore,
        style: { ...markerBefore.style, markerShape: "diamond" },
      });
      expect(store.operationRejection).toEqual({
        code,
        layerId: "tessera.basic.placed-object",
      });
      expect(store.state.overlays.get(markerId)).toEqual(markerBefore);
    },
  );

  it("标记素材形状可在放置后原子编辑并撤销重做", () => {
    const store = new EditorStore(createProject(input));
    const markerId = store.placeMarker(
      { kind: "cell", cellId: "cell:square:2:2" },
      "#123456FF",
      "circle",
    );
    const before = store.state.overlays.get(markerId);
    if (before === undefined || before.overlayType !== "marker") {
      throw new Error("marker-not-found");
    }
    store.updateOverlay(markerId, {
      ...before,
      style: {
        ...before.style,
        markerShape: "diamond",
        size: 48,
        rotation: 45,
        opacity: 0.4,
        color: "#ABCDEF88",
      },
    });
    expect(store.state.overlays.get(markerId)).toMatchObject({
      style: {
        markerShape: "diamond",
        size: 48,
        rotation: 45,
        opacity: 0.4,
        color: "#ABCDEF88",
      },
    });
    store.undo();
    expect(store.state.overlays.get(markerId)).toEqual(before);
    store.redo();
    expect(store.state.overlays.get(markerId)).toMatchObject({
      style: { markerShape: "diamond", rotation: 45 },
    });
  });
});

describe("EditorStore 历史容量边界", () => {
  function color(index: number): string {
    return `#${index.toString(16).padStart(6, "0")}FF`;
  }

  it("保留完整 100 步并在边界停止撤销和重做", () => {
    const store = new EditorStore(createProject(input));
    for (let index = 1; index <= 100; index += 1) {
      store.paintCell(0, 0, color(index));
    }
    for (let index = 0; index < 100; index += 1) store.undo();
    expect(store.state.cells.size).toBe(0);
    expect(store.canUndo).toBe(false);
    for (let index = 0; index < 100; index += 1) store.redo();
    expect(store.state.cells.get("cell:square:0:0")?.fillColor).toBe(
      color(100),
    );
    expect(store.canRedo).toBe(false);
  });

  it("第 101 步仅淘汰最旧一步", () => {
    const store = new EditorStore(createProject(input));
    for (let index = 1; index <= 101; index += 1) {
      store.paintCell(0, 0, color(index));
    }
    for (let index = 0; index < 100; index += 1) store.undo();
    expect(store.state.cells.get("cell:square:0:0")?.fillColor).toBe(color(1));
    expect(store.canUndo).toBe(false);
    store.undo();
    expect(store.state.cells.get("cell:square:0:0")?.fillColor).toBe(color(1));
  });
});
