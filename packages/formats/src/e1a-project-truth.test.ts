import {
  EditorStore,
  cellId,
  createProject,
  edgeIdentity,
} from "@tessera/core";
import { describe, expect, it } from "vitest";

import { computeProjectContentBounds } from "./content-bounds.js";
import {
  createFragmentFromStateV1,
  createPartialProjectFromStateV1,
  createPartialProjectV1,
} from "./export-closure.js";
import {
  ProjectFormatError,
  importExternalProjectV1,
  restoreProjectV1,
  stringifyProjectV1,
  toProjectV1,
  validateProjectDocumentV1,
} from "./project-format.js";

function createStore(): EditorStore {
  return new EditorStore(
    createProject({
      name: "E1a 格式真相",
      grid: { type: "square", width: 8, height: 8, cellSize: 32 },
      style: {
        canvasBackground: "#101820FF",
        defaultCellColor: "#223344FF",
        gridColor: "#FFFFFFFF",
        gridOpacity: 1,
        gridWidth: 1,
        defaultEdgeColor: "#FFFFFFFF",
      },
    }),
  );
}

function setCellLabel(
  store: EditorStore,
  row: number,
  column: number,
  label: string,
) {
  const id = cellId(store.state.grid.type, row, column);
  const current = store.state.cells.get(id);
  if (current === undefined) throw new Error("cell-missing");
  store.state.cells.set(id, { ...current, label });
}

function expectProjectCode(action: () => void, code: string): void {
  try {
    action();
    throw new Error("expected-project-error");
  } catch (error) {
    expect(error).toBeInstanceOf(ProjectFormatError);
    expect(error).toMatchObject({ code });
  }
}

describe("E1a Project v1 格式真相", () => {
  it("cell label 在 full、partial、Fragment 与 State 往返中不丢", () => {
    const store = createStore();
    store.paintCell(1, 1, "#AA3322FF");
    setCellLabel(store, 1, 1, "城市标签");

    const full = toProjectV1(store.state, { mode: "full" }) as any;
    expect(full.chunks[0].cellOverrides[0]).not.toHaveProperty("label");
    expect(
      full.chunks[0].cellOverrides[0].layerInstances[0].attributes.label,
    ).toBe("城市标签");
    const restored = restoreProjectV1(JSON.stringify(full));
    expect(restored.cells.get(cellId("square", 1, 1))?.label).toBe("城市标签");
    expect(
      (toProjectV1(restored) as any).chunks[0].cellOverrides[0]
        .layerInstances[0].attributes.label,
    ).toBe("城市标签");

    const selection = {
      bounds: { minX: 32, minY: 32, maxX: 64, maxY: 64 },
      includedLayerIds: ["tessera.basic.cell-style"],
    };
    const partial = createPartialProjectFromStateV1(
      store.state,
      selection,
    ) as any;
    const fragment = createFragmentFromStateV1(store.state, {
      ...selection,
      fragmentId: "11111111-1111-4111-8111-111111111111",
    }) as any;
    expect(
      partial.chunks[0].cellOverrides[0].layerInstances[0].attributes.label,
    ).toBe("城市标签");
    expect(
      fragment.objects.cellOverrides[0].layerInstances[0].attributes.label,
    ).toBe("城市标签");
  });

  it("内部恢复保留身份，外部 partial 总复制，full 同 ID 强制显式 copy/replace", () => {
    const store = createStore();
    store.paintCell(0, 0, "#AA3322FF");
    const full = toProjectV1(store.state, { mode: "full" });
    const partial = createPartialProjectV1(full, {
      bounds: { minX: 0, minY: 0, maxX: 32, maxY: 32 },
      includedLayerIds: ["tessera.basic.cell-style"],
    });
    const partialText = JSON.stringify(partial);
    expect(restoreProjectV1(partialText).projectId).toBe(partial.projectId);

    const derivedId = "22222222-2222-4222-8222-222222222222";
    const derived = importExternalProjectV1(partialText, {
      currentProjectId: null,
      sameProjectIdPolicy: "replace",
      uuidGenerator: () => derivedId,
    });
    expect(derived.projectId).toBe(derivedId);
    expect(derived.formatSource).toMatchObject({
      exportScope: "partial",
      isComplete: false,
      lineage: { sourceProjectId: full.projectId },
    });
    const preserved = toProjectV1(derived, { mode: "preserve" });
    const downloadedFull = toProjectV1(derived, { mode: "full" });
    expect(preserved).toMatchObject({
      projectId: derivedId,
      exportScope: "partial",
      isComplete: false,
    });
    expect(downloadedFull).toMatchObject({
      projectId: derivedId,
      exportScope: "full",
      isComplete: true,
      lineage: preserved.lineage,
    });
    expect(JSON.parse(stringifyProjectV1(derived, { mode: "full" }))).toEqual(
      downloadedFull,
    );
    expect(derived.formatSource.exportScope).toBe("partial");

    const fullText = JSON.stringify(full);
    expect(
      importExternalProjectV1(fullText, {
        currentProjectId: full.projectId,
        sameProjectIdPolicy: "replace",
      }).projectId,
    ).toBe(full.projectId);
    expect(
      importExternalProjectV1(fullText, {
        currentProjectId: full.projectId,
        sameProjectIdPolicy: "copy",
        uuidGenerator: () => "33333333-3333-4333-8333-333333333333",
      }).projectId,
    ).toBe("33333333-3333-4333-8333-333333333333");
    expect(
      importExternalProjectV1(fullText, {
        currentProjectId: "44444444-4444-4444-8444-444444444444",
        sameProjectIdPolicy: "copy",
      }).projectId,
    ).toBe(full.projectId);
  });

  it("rotation 文件严格使用度，[0,360) 往返且 90 度 bounds 正确", () => {
    const store = createStore();
    store.placeText({ x: 64, y: 64 }, "ABCD", {
      fontSize: 20,
      rotation: 90,
    });
    const document = toProjectV1(store.state) as any;
    expect(
      document.managers.overlayManager.overlays[0].styleOverrides.rotation,
    ).toBe(90);
    expect(computeProjectContentBounds(document)).toEqual({
      minX: 52,
      minY: 40,
      maxX: 76,
      maxY: 88,
    });
    expect(
      [...restoreProjectV1(JSON.stringify(document)).overlays.values()][0]
        ?.style.rotation,
    ).toBe(90);

    for (const value of [-1, 360]) {
      const invalid = structuredClone(document);
      invalid.managers.overlayManager.overlays[0].styleOverrides.rotation =
        value;
      expectProjectCode(
        () => validateProjectDocumentV1(invalid),
        value === 360 ? "basic-rotation-invalid" : "basic-number-range-invalid",
      );
    }
    const invalidNaN = structuredClone(document);
    invalidNaN.managers.overlayManager.overlays[0].styleOverrides.rotation =
      Number.NaN;
    expectProjectCode(
      () => validateProjectDocumentV1(invalidNaN),
      "basic-number-range-invalid",
    );
  });

  it("opaque baseline 深冻结并在 basic reconcile、partial 与 Fragment 中保持语义", () => {
    const store = createStore();
    store.paintCell(0, 0, "#AA3322FF");
    setCellLabel(store, 0, 0, "旧标签");
    const edge = edgeIdentity(store.state.grid, { row: 0, column: 0 }, 1);
    store.paintEdge(edge.edgeId, edge.adjacentCellIds, "#AA8844FF");
    const textId = store.placeText(
      { kind: "cell", cellId: cellId("square", 0, 0) },
      "旧文字",
    );
    store.createConnection(
      { kind: "cell-center", cellId: cellId("square", 0, 0) },
      { kind: "cell-center", cellId: cellId("square", 0, 1) },
      "line",
    );
    const baseline = toProjectV1(store.state) as any;
    const vendorOverlayId = "55555555-5555-4555-8555-555555555555";
    const groupId = "66666666-6666-4666-8666-666666666666";
    const assetId = "77777777-7777-4777-8777-777777777777";
    baseline.extensions = { root: { nested: [1, true, null] } };
    baseline.grid.extensions = { grid: { keep: true } };
    baseline.modules[0].extensions = { basicModule: "keep" };
    baseline.layerStates[0].extensions = { basicLayer: "keep" };
    baseline.layerStates.find(
      (layer: any) => layer.layerId === "tessera.basic.annotation",
    ).visible = false;
    baseline.mapStyle.extensions = { mapStyle: "keep" };
    baseline.managers.edgeManager.extensions = { edgeManager: "keep" };
    baseline.managers.connectionManager.extensions = {
      connectionManager: "keep",
    };
    baseline.managers.overlayManager.extensions = { overlayManager: "keep" };
    baseline.chunks[0].extensions = { chunk: "keep" };
    // v1 当前 schema 只允许 null；仍验证 reconcile 不擅自改写该已知字段。
    baseline.viewState = null;
    baseline.modules.push({
      moduleId: "vendor.module",
      version: "1.0.0",
      packageSourceKind: "user-file",
      extensions: { module: "opaque" },
    });
    baseline.layerStates.push({
      layerId: "vendor.module.objects",
      moduleVersion: "1.0.0",
      zIndex: 5000,
      visible: false,
      locked: true,
      opacity: 0.5,
      extensions: { layer: "opaque" },
    });
    const basicCell = baseline.chunks[0].cellOverrides[0];
    basicCell.extensions = { cell: "keep" };
    basicCell.layerInstances[0].extensions = { basicInstance: "keep" };
    basicCell.layerInstances.push({
      instanceId: "88888888-8888-4888-8888-888888888888",
      elementId: "vendor.module:cell-note",
      layerId: "vendor.module.objects",
      styleOverrides: { value: 1 },
      attributes: { note: "opaque" },
      extensions: { instance: "opaque" },
    });
    baseline.chunks[0].cellOverrides.push({
      cellId: cellId("square", 0, 2),
      layerInstances: [
        {
          instanceId: "99999999-9999-4999-8999-999999999999",
          elementId: "vendor.module:cell-only",
          layerId: "vendor.module.objects",
          styleOverrides: {},
          attributes: {},
          extensions: { onlyOpaque: true },
        },
      ],
      extensions: { opaqueCell: true },
    });
    const text = baseline.managers.overlayManager.overlays.find(
      (overlay: any) => overlay.overlayId === textId,
    );
    text.extensions = { basicOverlay: "keep" };
    text.anchor.extensions = { anchor: "keep" };
    const basicEdge = baseline.managers.edgeManager.edges[0];
    basicEdge.extensions = { basicEdge: "keep" };
    basicEdge.layerInstances[0].extensions = { edgeInstance: "keep" };
    const connection = baseline.managers.connectionManager.connections[0];
    connection.extensions = { basicConnection: "keep" };
    connection.start.extensions = { start: "keep" };
    connection.end.extensions = { end: "keep" };
    baseline.managers.overlayManager.overlays.push({
      kind: "anchored-overlay",
      overlayId: vendorOverlayId,
      elementId: "vendor.module:marker",
      layerId: "vendor.module.objects",
      overlayType: "marker",
      anchor: {
        kind: "cell",
        cellId: cellId("square", 0, 0),
        extensions: { opaqueAnchor: true },
      },
      styleOverrides: { value: 2 },
      attributes: { assetRef: assetId },
      orderInLayer: 0,
      extensions: { opaqueOverlay: true },
    });
    baseline.managers.overlayManager.overlays.sort((left: any, right: any) =>
      left.overlayId.localeCompare(right.overlayId),
    );
    baseline.chunks[0].ownedOverlayIds.push(vendorOverlayId);
    baseline.chunks[0].ownedOverlayIds.sort();
    baseline.domainGroups = [
      {
        kind: "domain-group",
        groupId,
        elementId: "vendor.module:region",
        layerId: "vendor.module.objects",
        memberCellIds: [cellId("square", 0, 0), cellId("square", 0, 1)],
        attributes: { assetRef: assetId },
        styleOverrides: {},
        extensions: { group: "opaque" },
      },
    ];
    baseline.chunks[0].ownedDomainGroupIds = [groupId];
    baseline.embeddedAssets = [
      {
        assetId,
        mimeType: "application/json",
        bytes: 2,
        encoding: "base64",
        data: "e30=",
        extensions: { asset: "opaque" },
      },
    ];
    baseline.contentBounds = computeProjectContentBounds(baseline);
    validateProjectDocumentV1(baseline);

    const collisionState = restoreProjectV1(JSON.stringify(baseline));
    collisionState.overlays.add({
      kind: "free-overlay",
      overlayId: vendorOverlayId,
      elementId: "tessera.basic:marker",
      layerId: "tessera.basic.placed-object",
      overlayType: "marker",
      point: { x: 16, y: 16 },
      orderInLayer: 0,
      style: {
        size: 12,
        rotation: 0,
        opacity: 1,
        color: "#FFFFFFFF",
        markerShape: "circle",
      },
      label: null,
      text: null,
    });
    expectProjectCode(
      () => toProjectV1(collisionState),
      "project-opaque-id-conflict",
    );

    const restoredState = restoreProjectV1(JSON.stringify(baseline));
    expect(Object.isFrozen(restoredState.formatSource.opaqueDocument)).toBe(
      true,
    );
    expect(() => {
      (restoredState.formatSource.opaqueDocument as any).extensions.root =
        "mutated";
    }).toThrow();
    expect(() => {
      (restoredState.formatSource as any).opaqueDocument = null;
    }).toThrow();
    expect(() => {
      (restoredState as any).formatSource = {
        exportScope: "full",
        isComplete: true,
        lineage: null,
        opaqueDocument: null,
      };
    }).toThrow();
    const restoredStore = new EditorStore(restoredState);
    restoredStore.paintCell(0, 0, "#00AAFFFF");
    setCellLabel(restoredStore, 0, 0, "新标签");
    const currentEdge = restoredStore.state.edges.get(edge.edgeId);
    if (currentEdge === undefined) throw new Error("edge-missing");
    restoredStore.updateEdgeStyle(edge.edgeId, {
      strokeColor: currentEdge.strokeColor,
      strokeWidth: 7,
      strokeOpacity: currentEdge.strokeOpacity,
      lineStyle: currentEdge.lineStyle,
    });
    const currentText = restoredStore.state.overlays.get(textId);
    if (currentText === undefined || currentText.overlayType !== "text") {
      throw new Error("text-missing");
    }
    // 隐藏图层拒绝编辑；本测试只验证格式保真，因此编辑时临时显示并在导出前恢复。
    restoredStore.setLayerState("tessera.basic.annotation", { visible: true });
    restoredStore.updateOverlay(textId, {
      ...currentText,
      text: "新文字",
      style: { ...currentText.style, rotation: 90 },
    });
    restoredStore.setLayerState("tessera.basic.annotation", { visible: false });
    const currentConnection = [...restoredStore.state.connections.values()][0];
    if (currentConnection === undefined) throw new Error("connection-missing");
    restoredStore.updateConnection(currentConnection.connectionId, {
      ...currentConnection,
      label: "新连接",
    });

    const output = toProjectV1(restoredStore.state, {
      mode: "preserve",
    }) as any;
    expect(output.extensions).toEqual(baseline.extensions);
    expect(output.grid.extensions).toEqual(baseline.grid.extensions);
    expect(output.modules).toEqual(baseline.modules);
    expect(
      output.layerStates.find(
        (layer: any) => layer.layerId === "vendor.module.objects",
      ),
    ).toEqual(
      baseline.layerStates.find(
        (layer: any) => layer.layerId === "vendor.module.objects",
      ),
    );
    expect(output.mapStyle.extensions).toEqual(baseline.mapStyle.extensions);
    expect(output.managers.edgeManager.extensions).toEqual(
      baseline.managers.edgeManager.extensions,
    );
    expect(output.managers.connectionManager.extensions).toEqual(
      baseline.managers.connectionManager.extensions,
    );
    expect(output.managers.overlayManager.extensions).toEqual(
      baseline.managers.overlayManager.extensions,
    );
    expect(output.chunks.at(0)?.extensions).toEqual(
      baseline.chunks.at(0)?.extensions,
    );
    expect(output.viewState).toEqual(baseline.viewState);
    expect(output.domainGroups).toMatchObject(baseline.domainGroups);
    expect(output.domainGroups[0]?.extensions).toMatchObject({
      group: "opaque",
    });
    expect(output.embeddedAssets).toEqual(baseline.embeddedAssets);
    const outputCell = output.chunks[0].cellOverrides.find(
      (cell: any) => cell.cellId === cellId("square", 0, 0),
    );
    if (outputCell === undefined) throw new Error("output-cell-missing");
    expect(outputCell.layerInstances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          elementId: "vendor.module:cell-note",
          extensions: { instance: "opaque" },
        }),
        expect.objectContaining({
          elementId: "tessera.basic:cell.color",
          extensions: { basicInstance: "keep" },
          styleOverrides: { fillColor: "#00AAFFFF", fillOpacity: 1 },
        }),
      ]),
    );
    expect(
      outputCell.layerInstances.find(
        (instance: any) => instance.elementId === "tessera.basic:cell.color",
      ).attributes,
    ).toEqual({ label: "新标签" });
    expect(outputCell.extensions).toEqual({ cell: "keep" });
    expect(output.chunks[0].cellOverrides).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cellId: cellId("square", 0, 2),
          extensions: { opaqueCell: true },
        }),
      ]),
    );
    const outputText = output.managers.overlayManager.overlays.find(
      (overlay: any) => overlay.overlayId === textId,
    );
    expect(outputText).toMatchObject({
      attributes: { text: "新文字" },
      styleOverrides: { rotation: 90 },
      extensions: { basicOverlay: "keep" },
      anchor: { extensions: { anchor: "keep" } },
    });
    expect(output.managers.connectionManager.connections[0]).toMatchObject({
      label: "新连接",
      extensions: { basicConnection: "keep" },
      start: { extensions: { start: "keep" } },
      end: { extensions: { end: "keep" } },
    });
    expect(output.managers.edgeManager.edges[0]).toMatchObject({
      extensions: { basicEdge: "keep" },
      layerInstances: [
        expect.objectContaining({
          extensions: { edgeInstance: "keep" },
          styleOverrides: expect.objectContaining({ strokeWidth: 7 }),
        }),
      ],
    });
    expect(output.managers.overlayManager.overlays).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          overlayId: vendorOverlayId,
          extensions: { opaqueOverlay: true },
        }),
      ]),
    );
    validateProjectDocumentV1(output);
    const fullOutput = toProjectV1(restoredStore.state, {
      mode: "full",
    }) as any;
    expect(
      fullOutput.layerStates.find(
        (layer: any) => layer.layerId === "tessera.basic.annotation",
      ).visible,
    ).toBe(false);
    expect(
      fullOutput.managers.overlayManager.overlays.some(
        (item: any) => item.overlayId === vendorOverlayId,
      ),
    ).toBe(true);

    const selection = {
      bounds: { minX: 0, minY: 0, maxX: 96, maxY: 64 },
      includedLayerIds: [
        "tessera.basic.cell-style",
        "tessera.basic.annotation",
        "tessera.basic.connection",
        "vendor.module.objects",
      ],
    };
    const partial = createPartialProjectFromStateV1(
      restoredStore.state,
      selection,
    ) as any;
    const fragment = createFragmentFromStateV1(restoredStore.state, {
      ...selection,
      fragmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    }) as any;
    expect(partial.modules).toEqual(baseline.modules);
    expect(
      partial.managers.overlayManager.overlays.some(
        (item: any) => item.overlayId === vendorOverlayId,
      ),
    ).toBe(true);
    expect(
      fragment.objects.overlays.some(
        (item: any) => item.overlayId === vendorOverlayId,
      ),
    ).toBe(true);
    expect(fragment.objects.embeddedAssets).toEqual(baseline.embeddedAssets);
  });

  it("删除 basic 对象后不从 opaque baseline 复活", () => {
    const store = createStore();
    store.paintCell(0, 0, "#AA3322FF");
    const overlayId = store.placeText({ x: 32, y: 32 }, "删除");
    const baseline = toProjectV1(store.state);
    const state = restoreProjectV1(JSON.stringify(baseline));
    const editing = new EditorStore(state);
    editing.eraseCell(0, 0);
    editing.select([{ kind: "overlay", id: overlayId }]);
    editing.deleteSelection();
    const output = toProjectV1(editing.state) as any;
    expect(output.chunks).toEqual([]);
    expect(output.managers.overlayManager.overlays).toEqual([]);
  });

  it("删除后重建的新 instanceId 不继承旧 instance extensions", () => {
    const store = createStore();
    store.paintCell(0, 0, "#AA3322FF");
    const baseline = toProjectV1(store.state) as any;
    const oldInstance = baseline.chunks[0].cellOverrides[0].layerInstances[0];
    oldInstance.extensions = { stale: true };
    const state = restoreProjectV1(JSON.stringify(baseline));
    const editing = new EditorStore(state);
    editing.eraseCell(0, 0);
    editing.paintCell(0, 0, "#00AAFFFF");
    const output = toProjectV1(editing.state) as any;
    const nextInstance = output.chunks[0].cellOverrides[0].layerInstances[0];
    expect(nextInstance.instanceId).not.toBe(oldInstance.instanceId);
    expect(nextInstance.extensions).toEqual({});
  });
});
