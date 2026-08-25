import { describe, expect, it } from "vitest";
import {
  cellCenter,
  createProject,
  edgeIdentity,
  EditorStore,
  projectOverlayAnchorPoint,
  type FixedLayerState,
  type GridContentKind,
  type GridSettingsUpdateResult,
  type GridType,
  type ModuleRuntimeInstance,
} from "./index.js";

function store(
  type: GridType = "square",
  width = 4,
  height = 4,
  cellSize = 32,
): EditorStore {
  return new EditorStore(
    createProject({
      name: "地图调整",
      grid: { type, width, height, cellSize },
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

function expectContentRejection(
  result: GridSettingsUpdateResult,
  objectKind: GridContentKind,
): void {
  expect(result).toMatchObject({
    status: "rejected",
    code: "grid-content-out-of-bounds",
    objectKind,
  });
}

function moduleBase(instanceId: string) {
  return {
    instanceId,
    elementId: "example.module:item",
    layerId: "example.module.layer",
    styleOverrides: {},
    attributes: {},
    extensions: {},
    runtimeStatus: "available" as const,
  };
}

function addModuleLayer(editor: EditorStore): void {
  (editor.state.layers as Map<string, FixedLayerState>).set(
    "example.module.layer",
    {
      layerId: "example.module.layer",
      moduleVersion: "1.0.0",
      zIndex: 5000,
      visible: true,
      locked: false,
      opacity: 1,
      runtimeStatus: "available",
      allowedKinds: ["cell", "edge", "overlay", "connection", "domain-group"],
    },
  );
}

function requiredOverlay(editor: EditorStore, overlayId: string) {
  const overlay = editor.state.overlays.get(overlayId);
  if (overlay === undefined)
    throw new Error(`测试 overlay 不存在：${overlayId}`);
  return overlay;
}

describe("EditorStore 地图尺寸原子调整", () => {
  it.each([
    [
      { width: 0, height: 4, cellSize: 32 },
      {
        code: "grid-width-invalid",
        field: "width",
        minimum: 1,
        maximum: 40_000,
      },
    ],
    [
      { width: 4, height: 40_001, cellSize: 32 },
      {
        code: "grid-height-invalid",
        field: "height",
        minimum: 1,
        maximum: 40_000,
      },
    ],
    [
      { width: 4, height: 4, cellSize: 12.5 },
      {
        code: "grid-cell-size-invalid",
        field: "cellSize",
        minimum: 12,
        maximum: 96,
      },
    ],
  ] as const)("非法输入结构化拒绝且零通知、零历史", (input, expected) => {
    const editor = store();
    const grid = editor.state.grid;
    const cells = editor.state.cells;
    const revision = editor.state.revision;
    const version = editor.version;
    expect(editor.updateGridSettings(input)).toMatchObject({
      status: "rejected",
      ...expected,
    });
    expect(editor.state.grid).toBe(grid);
    expect(editor.state.cells).toBe(cells);
    expect(editor.state.revision).toBe(revision);
    expect(editor.version).toBe(version);
    expect(editor.canUndo).toBe(false);
  });

  it("相同设置返回 unchanged，不制造 revision、历史或 Manager 重建", () => {
    const editor = store();
    const managers = {
      cells: editor.state.cells,
      edges: editor.state.edges,
      overlays: editor.state.overlays,
      connections: editor.state.connections,
      moduleInstances: editor.state.moduleInstances,
    };
    expect(
      editor.updateGridSettings({ width: 4, height: 4, cellSize: 32 }),
    ).toEqual({ status: "unchanged", grid: editor.state.grid });
    expect(editor.state).toMatchObject(managers);
    expect(editor.state.revision).toBe(0);
    expect(editor.version).toBe(0);
    expect(editor.canUndo).toBe(false);
  });

  it("方格扩大与 cellSize 调整是一个事务，锚定对象重算而自由坐标不缩放", () => {
    const editor = store("square", 4, 4, 32);
    const anchoredId = editor.placeMarker({
      kind: "cell",
      cellId: "cell:square:1:1",
    });
    const freeId = editor.placeMarker({ x: 20, y: 24 });
    const beforeRevision = editor.state.revision;
    const beforeCells = editor.state.cells;
    const beforeOverlays = editor.state.overlays;
    const beforeAnchor = projectOverlayAnchorPoint(
      editor.state,
      requiredOverlay(editor, anchoredId),
    );

    expect(
      editor.updateGridSettings({ width: 8, height: 6, cellSize: 64 }),
    ).toMatchObject({
      status: "updated",
      grid: { width: 8, height: 6, cellSize: 64 },
    });
    expect(editor.state.revision).toBe(beforeRevision + 1);
    expect(editor.state.cells).not.toBe(beforeCells);
    expect(editor.state.overlays).not.toBe(beforeOverlays);
    expect(
      projectOverlayAnchorPoint(
        editor.state,
        requiredOverlay(editor, anchoredId),
      ),
    ).toEqual(cellCenter(editor.state.grid, 1, 1));
    expect(editor.state.overlays.get(freeId)).toMatchObject({
      point: { x: 20, y: 24 },
    });
    const nextAnchor = cellCenter(editor.state.grid, 1, 1);
    expect(
      editor.state.overlays
        .query({
          minX: nextAnchor.x - 1,
          minY: nextAnchor.y - 1,
          maxX: nextAnchor.x + 1,
          maxY: nextAnchor.y + 1,
        })
        .map((overlay) => overlay.overlayId),
    ).toContain(anchoredId);

    editor.undo();
    expect(editor.state.grid).toMatchObject({
      width: 4,
      height: 4,
      cellSize: 32,
    });
    expect(
      projectOverlayAnchorPoint(
        editor.state,
        requiredOverlay(editor, anchoredId),
      ),
    ).toEqual(beforeAnchor);
    expect(editor.state.overlays.get(freeId)).toMatchObject({
      point: { x: 20, y: 24 },
    });
    editor.redo();
    expect(editor.state.grid).toMatchObject({
      width: 8,
      height: 6,
      cellSize: 64,
    });
  });

  it("基础 cell、edge、anchored overlay、connection 各自阻止裁掉持久内容", () => {
    const cases: readonly [GridContentKind, (editor: EditorStore) => void][] = [
      ["basic-cell", (editor) => editor.paintCell(3, 3, "#FF0000FF")],
      [
        "basic-edge",
        (editor) => {
          const edge = edgeIdentity(
            editor.state.grid,
            { row: 3, column: 3 },
            1,
          );
          editor.paintEdge(edge.edgeId, edge.adjacentCellIds, "#FF0000FF");
        },
      ],
      [
        "basic-overlay",
        (editor) => {
          editor.placeMarker({ kind: "cell", cellId: "cell:square:3:3" });
        },
      ],
      [
        "basic-connection",
        (editor) => {
          editor.createConnection(
            { kind: "cell-center", cellId: "cell:square:0:0" },
            { kind: "cell-center", cellId: "cell:square:3:3" },
            "line",
          );
        },
      ],
    ];
    for (const [kind, arrange] of cases) {
      const editor = store();
      arrange(editor);
      const revision = editor.state.revision;
      const lastTransactionId = editor.state.lastTransactionId;
      const version = editor.version;
      const grid = editor.state.grid;
      const managers = {
        cells: editor.state.cells,
        edges: editor.state.edges,
        overlays: editor.state.overlays,
        connections: editor.state.connections,
        moduleInstances: editor.state.moduleInstances,
      };
      const canUndo = editor.canUndo;
      const canRedo = editor.canRedo;
      expectContentRejection(editor.resizeMap(3, 3), kind);
      expect(editor.state.grid).toBe(grid);
      expect(editor.state).toMatchObject(managers);
      expect(editor.state.revision).toBe(revision);
      expect(editor.state.lastTransactionId).toBe(lastTransactionId);
      expect(editor.version).toBe(version);
      expect(editor.canUndo).toBe(canUndo);
      expect(editor.canRedo).toBe(canRedo);
    }
  });

  it("自由 overlay 与 connection 坐标保持数值不变，缩小几何边界时拒绝", () => {
    const overlayEditor = store("square", 4, 4, 32);
    overlayEditor.placeMarker({ x: 100, y: 100 });
    expectContentRejection(
      overlayEditor.updateGridSettings({ width: 4, height: 4, cellSize: 20 }),
      "basic-overlay",
    );

    const connectionEditor = store("square", 4, 4, 32);
    connectionEditor.createConnection(
      { kind: "map-point", point: { x: 10, y: 10 } },
      { kind: "map-point", point: { x: 100, y: 100 } },
      "line",
    );
    expectContentRejection(
      connectionEditor.updateGridSettings({
        width: 4,
        height: 4,
        cellSize: 20,
      }),
      "basic-connection",
    );
  });

  it("模块 cell/edge/overlay/connection/domain-group 均参与预检", () => {
    const cases: readonly [GridContentKind, ModuleRuntimeInstance][] = [
      [
        "module-cell",
        {
          ...moduleBase("module-cell"),
          kind: "cell",
          cellId: "cell:square:3:3",
        },
      ],
      [
        "module-edge",
        {
          ...moduleBase("module-edge"),
          kind: "edge",
          edgeId: "synthetic-edge",
          adjacentCellIds: ["cell:square:3:3"],
        },
      ],
      [
        "module-overlay",
        {
          ...moduleBase("module-overlay"),
          kind: "overlay",
          objectKind: "anchored-overlay",
          overlayType: "marker",
          anchor: {
            kind: "cell",
            cellId: "cell:square:3:3",
            extensions: {},
          },
          orderInLayer: 0,
        },
      ],
      [
        "module-connection",
        {
          ...moduleBase("module-connection"),
          kind: "connection",
          objectKind: "line",
          start: {
            kind: "cell-center",
            cellId: "cell:square:0:0",
            extensions: {},
          },
          end: {
            kind: "cell-center",
            cellId: "cell:square:3:3",
            extensions: {},
          },
          label: null,
        },
      ],
      [
        "module-domain-group",
        {
          ...moduleBase("module-domain"),
          kind: "domain-group",
          memberCellIds: ["cell:square:2:3", "cell:square:3:3"],
        },
      ],
    ];
    for (const [kind, instance] of cases) {
      const editor = store();
      addModuleLayer(editor);
      // 预检面对的是恢复后的持久事实，不依赖放置工作流补建结构边。
      editor.state.moduleInstances.add(instance);
      expectContentRejection(editor.resizeMap(3, 3), kind);
    }
  });

  it("模块自由 overlay 与自由 connection 也按新地图实际几何预检", () => {
    const freeOverlay = store();
    addModuleLayer(freeOverlay);
    freeOverlay.state.moduleInstances.add({
      ...moduleBase("module-free-overlay"),
      kind: "overlay",
      objectKind: "free-overlay",
      overlayType: "marker",
      point: { x: 100, y: 100 },
      orderInLayer: 0,
    });
    expectContentRejection(
      freeOverlay.updateGridSettings({ width: 4, height: 4, cellSize: 20 }),
      "module-overlay",
    );

    const freeConnection = store();
    addModuleLayer(freeConnection);
    freeConnection.state.moduleInstances.add({
      ...moduleBase("module-free-connection"),
      kind: "connection",
      objectKind: "line",
      start: {
        kind: "map-point",
        point: { x: 10, y: 10 },
        extensions: {},
      },
      end: {
        kind: "map-point",
        point: { x: 100, y: 100 },
        extensions: {},
      },
      label: null,
    });
    expectContentRejection(
      freeConnection.updateGridSettings({ width: 4, height: 4, cellSize: 20 }),
      "module-connection",
    );
  });

  it("尖顶六边形按 row/column 与实际多边形共同验证", () => {
    const anchored = store("hex-pointy", 4, 4, 32);
    anchored.placeMarker({
      kind: "cell",
      cellId: "cell:hex-pointy:3:3",
    });
    expectContentRejection(anchored.resizeMap(3, 3), "basic-overlay");

    const free = store("hex-pointy", 4, 4, 32);
    const point = cellCenter(free.state.grid, 3, 3);
    free.placeMarker(point);
    expectContentRejection(free.resizeMap(3, 3), "basic-overlay");
  });

  it("尖顶六边形多格域对象的全部相对成员都参与缩图预检", () => {
    const editor = store("hex-pointy", 5, 5, 32);
    addModuleLayer(editor);
    const instanceId = editor.addModuleInstance({
      ...moduleBase("hex-domain-group"),
      kind: "domain-group",
      memberCellIds: ["cell:hex-pointy:3:3", "cell:hex-pointy:4:3"],
    });
    expect(instanceId).toBe("hex-domain-group");
    expectContentRejection(editor.resizeMap(4, 4), "module-domain-group");
  });

  it("40000×40000 仍只处理稀疏对象，不按 16 亿格枚举", () => {
    const editor = store("square", 40_000, 40_000, 32);
    editor.paintCell(39_999, 39_999, "#FF0000FF");
    const startedAt = performance.now();
    expect(
      editor.updateGridSettings({
        width: 40_000,
        height: 40_000,
        cellSize: 33,
      }),
    ).toMatchObject({ status: "updated" });
    expect(performance.now() - startedAt).toBeLessThan(1_000);
    expect(editor.state.cells.size).toBe(1);
  });
});
