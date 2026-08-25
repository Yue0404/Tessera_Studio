import { describe, expect, it } from "vitest";
import {
  createProject,
  edgeIdentity,
  EditorStore,
  type FixedLayerState,
  type ModuleCellInstance,
  type ModuleEdgeInstance,
} from "./index.js";

const input = {
  name: "清空画布",
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

function addModuleLayer(
  store: EditorStore,
  allowedKinds: FixedLayerState["allowedKinds"],
): void {
  (store.state.layers as Map<string, FixedLayerState>).set("example.layer", {
    layerId: "example.layer",
    moduleVersion: "1.0.0",
    zIndex: 2500,
    visible: true,
    locked: false,
    opacity: 1,
    allowedKinds,
    runtimeStatus: "available",
  });
}

describe("一键清空画布", () => {
  it("空工程禁用且不产生发布、事务或历史", () => {
    const store = new EditorStore(createProject(input));
    const beforeVersion = store.version;

    expect(store.canClearEditableContent).toBe(false);
    expect(store.clearEditableContent()).toBe(false);
    expect(store.version).toBe(beforeVersion);
    expect(store.state.lastTransactionId).toBeNull();
    expect(store.canUndo).toBe(false);
  });

  it("跨 manager 内容以单个事务清除，并可完整撤销和重做", () => {
    const store = new EditorStore(createProject(input));
    addModuleLayer(store, ["cell"]);
    const edge = edgeIdentity(store.state.grid, { row: 1, column: 1 }, 1);
    store.paintCell(1, 1, "#FFFFFFFF");
    store.paintEdge(edge.edgeId, edge.adjacentCellIds, "#FFFFFFFF");
    store.placeMarker({ kind: "cell", cellId: "cell:square:1:1" });
    store.createConnection(
      { kind: "map-point", point: { x: 1, y: 1 } },
      { kind: "map-point", point: { x: 2, y: 2 } },
      "arrow",
    );
    const moduleCell: ModuleCellInstance = {
      kind: "cell",
      instanceId: "module-cell",
      elementId: "example:cell",
      layerId: "example.layer",
      cellId: "cell:square:2:2",
      attributes: {},
      styleOverrides: {},
      extensions: {},
      runtimeStatus: "available",
    };
    store.addModuleInstance(moduleCell);

    expect(store.clearEditableContent()).toBe(true);
    expect(store.state.cells.size).toBe(0);
    expect(store.state.edges.size).toBe(0);
    expect(store.state.overlays.size).toBe(0);
    expect(store.state.connections.size).toBe(0);
    expect(store.state.moduleInstances.size).toBe(0);
    const clearTransactionId = store.state.lastTransactionId;

    store.undo();
    expect(store.state.cells.size).toBe(1);
    expect(store.state.edges.size).toBe(1);
    expect(store.state.overlays.size).toBe(1);
    expect(store.state.connections.size).toBe(1);
    expect(store.state.moduleInstances.size).toBe(1);
    expect(store.state.lastTransactionId).toBe(clearTransactionId);

    store.redo();
    expect(store.state.cells.size).toBe(0);
    expect(store.state.edges.size).toBe(0);
    expect(store.state.overlays.size).toBe(0);
    expect(store.state.connections.size).toBe(0);
    expect(store.state.moduleInstances.size).toBe(0);
  });

  it("隐藏但未锁定内容会清除，锁定对象及其结构边会保留", () => {
    const store = new EditorStore(createProject(input));
    addModuleLayer(store, ["edge"]);
    const edge = edgeIdentity(store.state.grid, { row: 3, column: 3 }, 1);
    store.paintEdge(edge.edgeId, edge.adjacentCellIds, "#FFFFFFFF");
    const moduleEdge: ModuleEdgeInstance = {
      kind: "edge",
      instanceId: "module-edge",
      elementId: "example:river",
      layerId: "example.layer",
      edgeId: edge.edgeId,
      adjacentCellIds: edge.adjacentCellIds,
      attributes: {},
      styleOverrides: {},
      extensions: {},
      runtimeStatus: "available",
    };
    store.addModuleInstance(moduleEdge);
    store.paintCell(1, 1, "#FFFFFFFF");
    const layers = store.state.layers as Map<string, FixedLayerState>;
    const cellLayer = layers.get("tessera.basic.cell-style");
    const moduleLayer = layers.get("example.layer");
    if (cellLayer === undefined || moduleLayer === undefined)
      throw new Error("layer-missing");
    layers.set(cellLayer.layerId, { ...cellLayer, visible: false });
    layers.set(moduleLayer.layerId, { ...moduleLayer, locked: true });

    expect(store.clearEditableContent()).toBe(true);
    expect(store.state.cells.size).toBe(0);
    expect(store.state.moduleInstances.get("module-edge")).toBeDefined();
    expect(store.state.edges.get(edge.edgeId)).toMatchObject({
      persistence: "reference-only",
    });

    store.undo();
    expect(store.state.cells.size).toBe(1);
    expect(store.state.edges.get(edge.edgeId)).toMatchObject({
      persistence: "explicit-style",
    });

    store.redo();
    expect(store.state.cells.size).toBe(0);
    expect(store.state.moduleInstances.get("module-edge")).toBeDefined();
    expect(store.state.edges.get(edge.edgeId)).toMatchObject({
      persistence: "reference-only",
    });
  });
});
