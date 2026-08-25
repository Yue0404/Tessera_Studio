import { describe, expect, it } from "vitest";
import { createProject, EditorStore } from "./editor-store.js";
import type { FixedLayerState, SelectedObject } from "./types.js";
import type { ModuleRuntimeInstance } from "./module-instance-store.js";

const input = {
  name: "橡皮事务",
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

function setLayer(
  store: EditorStore,
  layerId: string,
  patch: Partial<FixedLayerState>,
): void {
  const layers = store.state.layers as Map<string, FixedLayerState>;
  const current = layers.get(layerId);
  if (current === undefined) throw new Error(`layer-missing:${layerId}`);
  layers.set(layerId, { ...current, ...patch });
}

function addModuleLayer(store: EditorStore, locked: boolean): void {
  (store.state.layers as Map<string, FixedLayerState>).set("example.domain", {
    layerId: "example.domain",
    moduleVersion: "1.0.0",
    zIndex: 5_000,
    visible: true,
    locked,
    opacity: 1,
    allowedKinds: ["domain-group"],
    runtimeStatus: "available",
  });
}

describe("橡皮单对象事务", () => {
  it("基础标记通过同一 API 删除且一次撤销恢复", () => {
    const store = new EditorStore(createProject(input));
    const markerId = store.placeMarker({ x: 48, y: 48 });
    const beforeRevision = store.state.revision;
    const candidate: SelectedObject = { kind: "overlay", id: markerId };

    expect(store.eraseFirstEditable([candidate])).toEqual(candidate);
    expect(store.state.overlays.get(markerId)).toBeUndefined();
    expect(store.state.revision).toBe(beforeRevision + 1);
    store.undo();
    expect(store.state.overlays.get(markerId)).toBeDefined();
  });

  it("跳过顶层锁定对象并只删除首个可编辑对象，撤销恢复", () => {
    const store = new EditorStore(createProject(input));
    store.paintCell(1, 1, "#FFFFFFFF");
    const markerId = store.placeMarker({
      kind: "cell",
      cellId: "cell:square:1:1",
    });
    setLayer(store, "tessera.basic.placed-object", { locked: true });
    const beforeRevision = store.state.revision;

    const erased = store.eraseFirstEditable([
      { kind: "overlay", id: markerId },
      { kind: "cell", id: "cell:square:1:1" },
    ]);

    expect(erased).toEqual({ kind: "cell", id: "cell:square:1:1" });
    expect(store.state.overlays.get(markerId)).toBeDefined();
    expect(store.state.cells.get("cell:square:1:1")).toBeUndefined();
    expect(store.state.revision).toBe(beforeRevision + 1);
    store.undo();
    expect(store.state.cells.get("cell:square:1:1")).toBeDefined();
  });

  it("候选全部锁定时零历史并产生稳定拒绝", () => {
    const store = new EditorStore(createProject(input));
    store.paintCell(1, 1, "#FFFFFFFF");
    setLayer(store, "tessera.basic.cell-style", { locked: true });
    const beforeRevision = store.state.revision;
    const beforeTransaction = store.state.lastTransactionId;

    expect(
      store.eraseFirstEditable([{ kind: "cell", id: "cell:square:1:1" }]),
    ).toBeNull();
    expect(store.state.revision).toBe(beforeRevision);
    expect(store.state.lastTransactionId).toBe(beforeTransaction);
    expect(store.operationRejection).toMatchObject({
      code: "layer-locked",
      layerId: "tessera.basic.cell-style",
    });
  });

  it("generic/domain-group 使用同一候选 API 且一次撤销恢复", () => {
    const store = new EditorStore(createProject(input));
    addModuleLayer(store, false);
    const domain: ModuleRuntimeInstance = {
      kind: "domain-group",
      instanceId: "domain-1",
      elementId: "example:domain",
      layerId: "example.domain",
      memberCellIds: ["cell:square:2:2", "cell:square:2:3"],
      attributes: {},
      styleOverrides: {},
      extensions: {},
      runtimeStatus: "available",
    };
    store.addModuleInstance(domain);
    const candidate: SelectedObject = {
      kind: "module-instance",
      id: domain.instanceId,
    };

    expect(store.eraseFirstEditable([candidate])).toEqual(candidate);
    expect(store.state.moduleInstances.get(domain.instanceId)).toBeUndefined();
    store.undo();
    expect(store.state.moduleInstances.get(domain.instanceId)).toBeDefined();
  });
});
