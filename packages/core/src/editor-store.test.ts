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
});
