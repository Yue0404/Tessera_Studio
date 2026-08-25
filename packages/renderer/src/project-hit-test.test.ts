import { describe, expect, it } from "vitest";
import {
  cellCenter,
  createProject,
  edgeIdentity,
  edgeSegment,
  EditorStore,
  type FixedLayerState,
  visibleCells,
} from "@tessera/core";
import {
  boxSelectProjectObjects,
  hitTestProjectObject,
  topmostProjectHit,
} from "./project-hit-test.js";

function store() {
  return new EditorStore(
    createProject({
      name: "命中",
      grid: { type: "square", width: 20, height: 20, cellSize: 32 },
      style: {
        canvasBackground: "#09141DFF",
        defaultCellColor: "#14232DFF",
        gridColor: "#59656AFF",
        gridOpacity: 0.7,
        gridWidth: 1,
        defaultEdgeColor: "#59656AFF",
      },
    }),
  );
}

describe("固定图层直接命中", () => {
  it("分别命中已有 cell、edge、connection 与 overlay", () => {
    const cellStore = store();
    const cells = visibleCells(cellStore.state.grid, 640, 640);
    const cell = cells.find((item) => item.row === 2 && item.column === 2);
    if (cell === undefined) throw new Error("missing-cell");
    expect(hitTestProjectObject(cellStore.state, cell.center, cell)).toEqual({
      kind: "cell",
      id: cell.cellId,
    });

    const edgeStore = store();
    const identity = edgeIdentity(edgeStore.state.grid, cell, 1);
    edgeStore.paintEdge(identity.edgeId, identity.adjacentCellIds, "#FFFFFFFF");
    const segment = edgeSegment(
      edgeStore.state.grid,
      identity.edgeId,
      identity.adjacentCellIds,
    );
    if (segment === undefined) throw new Error("missing-segment");
    const midpoint = {
      x: (segment[0].x + segment[1].x) / 2,
      y: (segment[0].y + segment[1].y) / 2,
    };
    expect(hitTestProjectObject(edgeStore.state, midpoint, cell)).toEqual({
      kind: "edge",
      id: identity.edgeId,
    });

    const connectionStore = store();
    const connectionId = connectionStore.createConnection(
      { kind: "map-point", point: { x: 50.25, y: 100.5 } },
      { kind: "map-point", point: { x: 250.75, y: 100.5 } },
      "line",
    );
    expect(
      hitTestProjectObject(connectionStore.state, { x: 150.5, y: 100.5 }, cell),
    ).toEqual({ kind: "connection", id: connectionId });

    const overlayStore = store();
    const overlayId = overlayStore.placeMarker({
      kind: "cell",
      cellId: cell.cellId,
    });
    expect(
      hitTestProjectObject(
        overlayStore.state,
        cellCenter(overlayStore.state.grid, cell.row, cell.column),
        cell,
      ),
    ).toEqual({ kind: "overlay", id: overlayId });
  });

  it("reference-only 结构边不会伪装成基础边命中", () => {
    const edgeStore = store();
    const cell = visibleCells(edgeStore.state.grid, 640, 640).find(
      (item) => item.row === 2 && item.column === 2,
    );
    if (cell === undefined) throw new Error("missing-cell");
    const identity = edgeIdentity(edgeStore.state.grid, cell, 1);
    edgeStore.state.edges.ensure({
      instanceId: `tessera.structure-edge:${identity.edgeId}`,
      edgeId: identity.edgeId,
      adjacentCellIds: identity.adjacentCellIds,
      strokeColor: edgeStore.state.style.defaultEdgeColor,
      strokeWidth: 2,
      strokeOpacity: 1,
      lineStyle: "solid",
      persistence: "reference-only",
    });
    const segment = edgeSegment(
      edgeStore.state.grid,
      identity.edgeId,
      identity.adjacentCellIds,
    );
    if (segment === undefined) throw new Error("missing-segment");
    const midpoint = {
      x: (segment[0].x + segment[1].x) / 2,
      y: (segment[0].y + segment[1].y) / 2,
    };

    expect(hitTestProjectObject(edgeStore.state, midpoint, cell)).toEqual({
      kind: "cell",
      id: cell.cellId,
    });
  });

  it.each(["line", "arrow"] as const)(
    "%s 显示时优先命中连接，隐藏后跨 zoom 稳定命中其引用的显式边",
    (kind) => {
      const editor = store();
      const cell = visibleCells(editor.state.grid, 640, 640).find(
        (item) => item.row === 2 && item.column === 2,
      );
      if (cell === undefined) throw new Error("missing-cell");
      const identity = edgeIdentity(editor.state.grid, cell, 1);
      editor.paintEdge(identity.edgeId, identity.adjacentCellIds, "#FFFFFFFF");
      const segment = edgeSegment(
        editor.state.grid,
        identity.edgeId,
        identity.adjacentCellIds,
      );
      if (segment === undefined) throw new Error("missing-segment");
      const midpoint = {
        x: (segment[0].x + segment[1].x) / 2,
        y: (segment[0].y + segment[1].y) / 2,
      };
      const connectionId = editor.createConnection(
        { kind: "map-point", point: segment[0] },
        { kind: "map-point", point: segment[1] },
        kind,
      );
      const connectionLayer = editor.state.layers.get(
        "tessera.basic.connection",
      );
      if (connectionLayer === undefined)
        throw new Error("connection-layer-missing");

      for (const zoom of [0.25, 1, 4]) {
        (editor.state.layers as Map<string, FixedLayerState>).set(
          connectionLayer.layerId,
          { ...connectionLayer, visible: true },
        );
        expect(
          hitTestProjectObject(editor.state, midpoint, cell, zoom),
        ).toEqual({
          kind: "connection",
          id: connectionId,
        });
        (editor.state.layers as Map<string, FixedLayerState>).set(
          connectionLayer.layerId,
          { ...connectionLayer, visible: false },
        );
        expect(
          hitTestProjectObject(editor.state, midpoint, cell, zoom),
        ).toEqual({
          kind: "edge",
          id: identity.edgeId,
        });
      }
    },
  );

  it("基础与 generic 重叠时按全局图层 zIndex 选择最上层对象", () => {
    const editor = store();
    const cell = visibleCells(editor.state.grid, 640, 640).find(
      (item) => item.row === 2 && item.column === 2,
    );
    if (cell === undefined) throw new Error("missing-cell");
    const layerId = "example.weather.surface";
    (editor.state.layers as Map<string, FixedLayerState>).set(layerId, {
      layerId,
      moduleVersion: "1.0.0",
      zIndex: 100,
      visible: true,
      locked: false,
      opacity: 1,
      allowedKinds: ["cell"],
      runtimeStatus: "available",
    });
    editor.state.moduleInstances.add({
      kind: "cell",
      instanceId: "generic-cell",
      elementId: "example.weather:cell.rain",
      layerId,
      cellId: cell.cellId,
      attributes: {},
      styleOverrides: {},
      extensions: {},
      runtimeStatus: "available",
    });
    const basic = { kind: "cell" as const, id: cell.cellId };
    expect(topmostProjectHit(editor.state, basic, "generic-cell")).toEqual(
      basic,
    );

    const sameZLayer = editor.state.layers.get(layerId);
    if (sameZLayer === undefined) throw new Error("generic-layer-missing");
    (editor.state.layers as Map<string, FixedLayerState>).set(layerId, {
      ...sameZLayer,
      zIndex: 500,
    });
    expect(topmostProjectHit(editor.state, basic, "generic-cell")).toEqual(
      basic,
    );

    const upperSameZLayerId = "zzz.weather.surface";
    (editor.state.layers as Map<string, FixedLayerState>).set(
      upperSameZLayerId,
      { ...sameZLayer, layerId: upperSameZLayerId, zIndex: 500 },
    );
    const generic = editor.state.moduleInstances.get("generic-cell");
    if (generic === undefined || generic.kind !== "cell")
      throw new Error("generic-instance-missing");
    editor.state.moduleInstances.replace({
      ...generic,
      layerId: upperSameZLayerId,
    });
    expect(topmostProjectHit(editor.state, basic, "generic-cell")).toEqual({
      kind: "module-instance",
      id: "generic-cell",
    });

    const lowerLayer = editor.state.layers.get(upperSameZLayerId);
    if (lowerLayer === undefined) throw new Error("generic-layer-missing");
    (editor.state.layers as Map<string, FixedLayerState>).set(
      upperSameZLayerId,
      {
        ...lowerLayer,
        zIndex: 800,
      },
    );
    expect(topmostProjectHit(editor.state, basic, "generic-cell")).toEqual({
      kind: "module-instance",
      id: "generic-cell",
    });
  });

  it("基础候选跨类型按图层和层内稳定顺序选择", () => {
    const editor = store();
    const point = { x: 96, y: 96 };
    const first = editor.placeMarker(point);
    const second = editor.placeMarker(point);
    const firstOverlay = editor.state.overlays.get(first);
    const secondOverlay = editor.state.overlays.get(second);
    if (firstOverlay === undefined || secondOverlay === undefined)
      throw new Error("overlay-missing");
    editor.state.overlays.replace({ ...firstOverlay, orderInLayer: 1 });
    editor.state.overlays.replace({ ...secondOverlay, orderInLayer: 2 });
    expect(hitTestProjectObject(editor.state, point, undefined)).toEqual({
      kind: "overlay",
      id: second,
    });

    editor.state.overlays.replace({ ...firstOverlay, orderInLayer: 2 });
    expect(hitTestProjectObject(editor.state, point, undefined)).toEqual({
      kind: "overlay",
      id: [first, second].sort().at(-1),
    });

    const connectionId = editor.createConnection(
      { kind: "map-point", point: { x: 32, y: 96 } },
      { kind: "map-point", point: { x: 160, y: 96 } },
      "line",
    );
    expect(hitTestProjectObject(editor.state, point, undefined)).toEqual({
      kind: "connection",
      id: connectionId,
    });
  });

  it("基础 marker 与 text 命中遵守跨 zoom 的 CSS 尺寸钳制", () => {
    const markerStore = store();
    const markerId = markerStore.placeMarker({ x: 100, y: 100 });
    const marker = markerStore.state.overlays.get(markerId);
    if (marker === undefined || marker.overlayType !== "marker")
      throw new Error("marker-missing");
    markerStore.state.overlays.replace({
      ...marker,
      style: { ...marker.style, size: 1 },
    });
    expect(
      hitTestProjectObject(
        markerStore.state,
        { x: 130, y: 100 },
        undefined,
        0.1,
      ),
    ).toEqual({ kind: "overlay", id: markerId });
    markerStore.state.overlays.replace({
      ...marker,
      style: { ...marker.style, size: 10_000 },
    });
    expect(
      hitTestProjectObject(markerStore.state, { x: 220, y: 100 }, undefined, 1),
    ).toEqual({ kind: "overlay", id: markerId });
    expect(
      hitTestProjectObject(
        markerStore.state,
        { x: 120, y: 100 },
        undefined,
        10,
      ),
    ).toBeNull();

    const textStore = store();
    const textId = textStore.placeText({ x: 300, y: 100 }, "可读文字", {
      fontSize: 1,
    });
    expect(
      hitTestProjectObject(textStore.state, { x: 350, y: 100 }, undefined, 0.1),
    ).toEqual({ kind: "overlay", id: textId });
    const text = textStore.state.overlays.get(textId);
    if (text === undefined || text.overlayType !== "text")
      throw new Error("text-missing");
    textStore.state.overlays.replace({
      ...text,
      style: { ...text.style, fontSize: 10_000 },
    });
    expect(
      hitTestProjectObject(textStore.state, { x: 320, y: 100 }, undefined, 10),
    ).toBeNull();
  });

  it("宽文字的可见区域按旋转矩形命中并压过底层地格", () => {
    const editor = store();
    const cell = visibleCells(editor.state.grid, 640, 640).find(
      (item) => item.row === 2 && item.column === 2,
    );
    if (cell === undefined) throw new Error("missing-cell");
    const overlayId = editor.placeText(
      { kind: "cell", cellId: cell.cellId },
      "可见文字命中区域",
      { fontSize: 18 },
    );
    expect(
      hitTestProjectObject(
        editor.state,
        { x: cell.center.x + 40, y: cell.center.y },
        cell,
      ),
    ).toEqual({ kind: "overlay", id: overlayId });

    const overlay = editor.state.overlays.get(overlayId);
    if (overlay === undefined || overlay.overlayType !== "text")
      throw new Error("text-missing");
    editor.state.overlays.replace({
      ...overlay,
      style: { ...overlay.style, rotation: 90 },
    });
    expect(
      hitTestProjectObject(
        editor.state,
        { x: cell.center.x, y: cell.center.y + 40 },
        cell,
      ),
    ).toEqual({ kind: "overlay", id: overlayId });
  });

  it("256 个中日韩文字的末端先由空间索引召回再完成精确命中", () => {
    const editor = store();
    const anchor = { x: 320, y: 160 };
    const overlayId = editor.placeText(anchor, "界".repeat(256), {
      fontSize: 18,
    });
    const farVisiblePoint = { x: anchor.x + 2_200, y: anchor.y };

    expect(
      editor.state.overlays
        .query({
          minX: farVisiblePoint.x - 1,
          minY: farVisiblePoint.y - 1,
          maxX: farVisiblePoint.x + 1,
          maxY: farVisiblePoint.y + 1,
        })
        .map((overlay) => overlay.overlayId),
    ).toContain(overlayId);
    expect(
      hitTestProjectObject(editor.state, farVisiblePoint, undefined, 1),
    ).toEqual({ kind: "overlay", id: overlayId });

    // 相机最小缩放 0.25 下，8 CSS px 最小字号换算为 32 地图单位；索引必须覆盖该最大显示宽度。
    const minimumZoomEdge = { x: anchor.x + 4_000, y: anchor.y };
    expect(
      editor.state.overlays
        .query({
          minX: minimumZoomEdge.x - 1,
          minY: minimumZoomEdge.y - 1,
          maxX: minimumZoomEdge.x + 1,
          maxY: minimumZoomEdge.y + 1,
        })
        .map((overlay) => overlay.overlayId),
    ).toContain(overlayId);
    expect(
      hitTestProjectObject(editor.state, minimumZoomEdge, undefined, 0.25),
    ).toEqual({ kind: "overlay", id: overlayId });
  });
});

describe("稀疏持久化对象框选", () => {
  it.each(["square", "hex-pointy"] as const)(
    "%s 空白格与结构边不被选择，显式编辑对象会被选择",
    (type) => {
      const editor = new EditorStore(
        createProject({
          ...inputForGrid(type),
        }),
      );
      const center = cellCenter(editor.state.grid, 2, 2);
      const rect = {
        minX: center.x - editor.state.grid.cellSize,
        minY: center.y - editor.state.grid.cellSize,
        maxX: center.x + editor.state.grid.cellSize,
        maxY: center.y + editor.state.grid.cellSize,
      };
      const visible = visibleCells(editor.state.grid, 640, 640);
      const cell = visible.find((item) => item.row === 2 && item.column === 2);
      if (cell === undefined) throw new Error("missing-cell");
      const identity = edgeIdentity(editor.state.grid, cell, 1);
      editor.state.edges.ensure({
        instanceId: `tessera.structure-edge:${identity.edgeId}`,
        edgeId: identity.edgeId,
        adjacentCellIds: identity.adjacentCellIds,
        strokeColor: editor.state.style.defaultEdgeColor,
        strokeWidth: 1,
        strokeOpacity: 1,
        lineStyle: "solid",
        persistence: "reference-only",
      });

      expect(boxSelectProjectObjects(editor.state, rect, visible)).toEqual([]);
      expect(editor.state.cells.size).toBe(0);
      expect(editor.state.edges.size).toBe(1);

      editor.paintCell(2, 2, "#FFFFFFFF");
      editor.paintEdge(identity.edgeId, identity.adjacentCellIds, "#FFFFFFFF");
      expect(boxSelectProjectObjects(editor.state, rect, visible)).toEqual(
        expect.arrayContaining([
          { kind: "cell", id: cell.cellId },
          { kind: "edge", id: identity.edgeId },
        ]),
      );
    },
  );

  it("隐藏图层不参与框选，锁定但可见图层仍可选择", () => {
    const editor = store();
    const visible = visibleCells(editor.state.grid, 640, 640);
    const cell = visible.find((item) => item.row === 2 && item.column === 2);
    if (cell === undefined) throw new Error("missing-cell");
    const rect = {
      minX: cell.center.x - 40,
      minY: cell.center.y - 40,
      maxX: cell.center.x + 40,
      maxY: cell.center.y + 40,
    };
    editor.paintCell(2, 2, "#FFFFFFFF");
    const markerId = editor.placeMarker({ x: cell.center.x, y: cell.center.y });
    const connectionId = editor.createConnection(
      {
        kind: "map-point",
        point: { x: cell.center.x - 20, y: cell.center.y },
      },
      {
        kind: "map-point",
        point: { x: cell.center.x + 20, y: cell.center.y },
      },
      "line",
    );
    const layers = editor.state.layers as Map<string, FixedLayerState>;
    const cellLayer = layers.get("tessera.basic.cell-style");
    const overlayLayer = layers.get("tessera.basic.placed-object");
    const connectionLayer = layers.get("tessera.basic.connection");
    if (
      cellLayer === undefined ||
      overlayLayer === undefined ||
      connectionLayer === undefined
    )
      throw new Error("layer-missing");
    layers.set(cellLayer.layerId, { ...cellLayer, locked: true });
    layers.set(overlayLayer.layerId, { ...overlayLayer, visible: false });
    layers.set(connectionLayer.layerId, {
      ...connectionLayer,
      visible: false,
    });

    expect(boxSelectProjectObjects(editor.state, rect, visible)).toEqual([
      { kind: "cell", id: cell.cellId },
    ]);
    expect(editor.state.overlays.get(markerId)).toBeDefined();
    expect(editor.state.connections.get(connectionId)).toBeDefined();
  });
});

function inputForGrid(type: "square" | "hex-pointy") {
  return {
    name: "框选",
    grid: { type, width: 20, height: 20, cellSize: 32 },
    style: {
      canvasBackground: "#09141DFF",
      defaultCellColor: "#14232DFF",
      gridColor: "#59656AFF",
      gridOpacity: 0.7,
      gridWidth: 1,
      defaultEdgeColor: "#59656AFF",
    },
  };
}
