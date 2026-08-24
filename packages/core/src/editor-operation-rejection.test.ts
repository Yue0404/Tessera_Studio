import { describe, expect, it } from "vitest";
import {
  createProject,
  edgeIdentity,
  EditorStore,
  type FixedLayerState,
} from "./index.js";

const input = {
  name: "拒绝反馈",
  grid: { type: "square" as const, width: 8, height: 8, cellSize: 32 },
  style: {
    canvasBackground: "#09141DFF",
    defaultCellColor: "#14232DFF",
    gridColor: "#59656AFF",
    gridOpacity: 0.7,
    gridWidth: 1,
    defaultEdgeColor: "#59656AFF",
  },
};

function snapshot(store: EditorStore): string {
  return JSON.stringify({
    cells: [...store.state.cells.values()],
    edges: [...store.state.edges.values()],
    overlays: [...store.state.overlays.values()],
    connections: [...store.state.connections.values()],
    revision: store.state.revision,
  });
}

function lockLayer(store: EditorStore, layerId: string): void {
  const layers = store.state.layers as Map<string, FixedLayerState>;
  const layer = layers.get(layerId);
  if (layer === undefined) throw new Error(`layer-not-found:${layerId}`);
  layers.set(layerId, { ...layer, locked: true });
}

interface RejectionCase {
  readonly name: string;
  readonly layerId: string;
  prepare(store: EditorStore): () => void;
}

const cases: readonly RejectionCase[] = [
  {
    name: "画笔",
    layerId: "tessera.basic.cell-style",
    prepare: (store) => () => store.paintCell(1, 1, "#FFFFFFFF"),
  },
  {
    name: "填充",
    layerId: "tessera.basic.cell-style",
    prepare: (store) => () => void store.fillCells(1, 1, "#FFFFFFFF"),
  },
  {
    name: "擦除",
    layerId: "tessera.basic.cell-style",
    prepare: (store) => {
      store.paintCell(1, 1, "#FFFFFFFF");
      return () => store.eraseCell(1, 1);
    },
  },
  {
    name: "边绘制",
    layerId: "tessera.basic.edge-style",
    prepare: (store) => {
      const edge = edgeIdentity(store.state.grid, { row: 1, column: 1 }, 1);
      return () =>
        store.paintEdge(edge.edgeId, edge.adjacentCellIds, "#FFFFFFFF");
    },
  },
  {
    name: "标记放置",
    layerId: "tessera.basic.placed-object",
    prepare: (store) => () =>
      void store.placeMarker({
        kind: "cell",
        cellId: "cell:square:1:1",
      }),
  },
  {
    name: "文字放置",
    layerId: "tessera.basic.annotation",
    prepare: (store) => () =>
      void store.placeText(
        { kind: "cell", cellId: "cell:square:1:1" },
        "不应写入",
      ),
  },
  {
    name: "连接放置",
    layerId: "tessera.basic.connection",
    prepare: (store) => () =>
      void store.createConnection(
        { kind: "cell-center", cellId: "cell:square:1:1" },
        { kind: "cell-center", cellId: "cell:square:1:2" },
      ),
  },
  {
    name: "边属性",
    layerId: "tessera.basic.edge-style",
    prepare: (store) => {
      const edge = edgeIdentity(store.state.grid, { row: 1, column: 1 }, 1);
      store.paintEdge(edge.edgeId, edge.adjacentCellIds, "#111111FF");
      return () =>
        store.updateEdgeStyle(edge.edgeId, {
          strokeColor: "#FFFFFFFF",
          strokeWidth: 9,
          strokeOpacity: 1,
          lineStyle: "solid",
        });
    },
  },
  {
    name: "标记属性",
    layerId: "tessera.basic.placed-object",
    prepare: (store) => {
      const id = store.placeMarker({
        kind: "cell",
        cellId: "cell:square:1:1",
      });
      const marker = store.state.overlays.get(id);
      if (marker?.overlayType !== "marker") throw new Error("marker-not-found");
      return () =>
        store.updateOverlay(id, {
          ...marker,
          style: { ...marker.style, markerShape: "circle" },
        });
    },
  },
  {
    name: "连接属性",
    layerId: "tessera.basic.connection",
    prepare: (store) => {
      const id = store.createConnection(
        { kind: "cell-center", cellId: "cell:square:1:1" },
        { kind: "cell-center", cellId: "cell:square:1:2" },
      );
      const connection = store.state.connections.get(id);
      if (connection === undefined) throw new Error("connection-not-found");
      return () =>
        store.updateConnection(id, {
          ...connection,
          style: { ...connection.style, strokeWidth: 9 },
        });
    },
  },
  {
    name: "删除选择",
    layerId: "tessera.basic.placed-object",
    prepare: (store) => {
      const id = store.placeMarker({
        kind: "cell",
        cellId: "cell:square:1:1",
      });
      store.select([{ kind: "overlay", id }]);
      return () => store.deleteSelection();
    },
  },
];

describe("EditorStore 图层操作拒绝", () => {
  it.each(cases)("$name 在锁层时不改领域状态并提供可见原因", (value) => {
    const store = new EditorStore(createProject(input));
    const attempt = value.prepare(store);
    lockLayer(store, value.layerId);
    const before = snapshot(store);

    attempt();

    expect(snapshot(store)).toBe(before);
    expect(store.operationRejection).toEqual({
      code: "layer-locked",
      layerId: value.layerId,
    });
  });
});
