import { describe, expect, it } from "vitest";
import {
  cellId,
  createProject,
  edgeIdentity,
  EditorStore,
  ModuleInstanceStore,
  type EdgeOverride,
  type FixedLayerState,
  type ModuleCellInstance,
  type ModuleConnectionInstance,
  type ModuleDomainGroupInstance,
  type ModuleEdgeInstance,
  type ModuleOverlayInstance,
} from "./index.js";

const input = {
  name: "通用模块实例",
  grid: {
    type: "square" as const,
    width: 40_000,
    height: 40_000,
    cellSize: 32,
  },
  style: {
    canvasBackground: "#09141DFF",
    defaultCellColor: "#14232DFF",
    gridColor: "#59656AFF",
    gridOpacity: 0.7,
    gridWidth: 1,
    defaultEdgeColor: "#59656AFF",
  },
};

function cellInstance(index: number): ModuleCellInstance {
  return {
    kind: "cell",
    instanceId: `instance-${index}`,
    elementId: "example.weather:cell.surface",
    layerId: "example.weather.surface",
    cellId: `cell:square:${index}:${index}`,
    attributes: { intensity: index },
    styleOverrides: {},
    extensions: {},
    runtimeStatus: "available",
  };
}

function editableStore(): EditorStore {
  const project = createProject(input);
  (project.layers as Map<string, FixedLayerState>).set(
    "example.weather.surface",
    {
      layerId: "example.weather.surface",
      moduleVersion: "1.0.0",
      zIndex: 2500,
      visible: true,
      locked: false,
      opacity: 1,
      allowedKinds: ["cell"],
      runtimeStatus: "available",
    },
  );
  return new EditorStore(project);
}

function edgeEditableStore(): EditorStore {
  const store = editableStore();
  const layers = store.state.layers as Map<string, FixedLayerState>;
  const surface = layers.get("example.weather.surface");
  if (surface === undefined) throw new Error("surface-layer-missing");
  layers.set("example.weather.surface", {
    ...surface,
    allowedKinds: ["cell", "edge", "overlay", "connection"],
  });
  return store;
}

function structureEdge(store: EditorStore): EdgeOverride {
  const identity = edgeIdentity(input.grid, { row: 3, column: 3 }, 1);
  return {
    instanceId: `tessera.structure-edge:${identity.edgeId}`,
    ...identity,
    strokeColor: store.state.style.defaultEdgeColor,
    strokeWidth: 2,
    strokeOpacity: 1,
    lineStyle: "solid",
    persistence: "reference-only",
  };
}

describe("ModuleInstanceStore", () => {
  it("按 elementId 维护增改删反向索引", () => {
    const first = cellInstance(1);
    const second = cellInstance(2);
    const instances = new ModuleInstanceStore([first, second]);
    expect(
      instances
        .valuesForElement("example.weather:cell.surface")
        .map((value) => value.instanceId),
    ).toEqual(["instance-1", "instance-2"]);

    instances.replace({
      ...first,
      elementId: "example.weather:cell.temperature",
    });
    expect(
      instances
        .valuesForElement("example.weather:cell.surface")
        .map((value) => value.instanceId),
    ).toEqual(["instance-2"]);
    expect(
      instances
        .valuesForElement("example.weather:cell.temperature")
        .map((value) => value.instanceId),
    ).toEqual(["instance-1"]);

    instances.delete(first.instanceId);
    expect(
      instances.valuesForElement("example.weather:cell.temperature"),
    ).toEqual([]);
  });

  it("只替换目标实例并保留无关大地图对象，可撤销和重做", () => {
    const store = editableStore();
    for (let index = 0; index < 2_000; index += 1) {
      store.state.moduleInstances.add(cellInstance(index));
    }
    const unrelated = store.state.moduleInstances.get("instance-1999");

    store.updateModuleInstance("instance-1", {
      attributes: { intensity: 99 },
    });

    expect(store.state.moduleInstances.get("instance-1")?.attributes).toEqual({
      intensity: 99,
    });
    expect(store.state.moduleInstances.get("instance-1999")).toBe(unrelated);
    store.undo();
    expect(store.state.moduleInstances.get("instance-1")?.attributes).toEqual({
      intensity: 1,
    });
    expect(store.state.moduleInstances.get("instance-1999")).toBe(unrelated);
    store.redo();
    expect(store.state.moduleInstances.get("instance-1")?.attributes).toEqual({
      intensity: 99,
    });
  });

  it("新增与删除保持载体索引一致且历史可恢复", () => {
    const store = editableStore();
    const instance = cellInstance(7);
    expect(store.addModuleInstance(instance)).toBe(instance.instanceId);
    expect(
      store.state.moduleInstances.valuesForCarrier("cell", instance.cellId),
    ).toHaveLength(1);

    expect(store.deleteModuleInstance(instance.instanceId)).toBe(true);
    expect(
      store.state.moduleInstances.valuesForCarrier("cell", instance.cellId),
    ).toEqual([]);
    store.undo();
    expect(store.state.moduleInstances.get(instance.instanceId)).toMatchObject({
      cellId: instance.cellId,
    });
  });

  it("缺包占位实例保持只读", () => {
    const store = editableStore();
    const missing = { ...cellInstance(1), runtimeStatus: "missing" as const };
    store.state.moduleInstances.add(missing);
    const currentLayer = store.state.layers.get(missing.layerId);
    if (currentLayer === undefined) throw new Error("missing-layer-missing");
    (store.state.layers as Map<string, FixedLayerState>).set(missing.layerId, {
      ...currentLayer,
      locked: true,
      allowedKinds: [],
      runtimeStatus: "missing",
    });

    store.updateModuleInstance(missing.instanceId, {
      attributes: { intensity: 2 },
    });
    expect(store.operationRejection).toEqual({
      code: "layer-module-missing",
      layerId: missing.layerId,
    });
    expect(
      store.state.moduleInstances.get(missing.instanceId)?.attributes,
    ).toEqual({
      intensity: 1,
    });
    expect(store.deleteModuleInstance(missing.instanceId)).toBe(false);
  });

  it("命令入口拒绝图层不允许的 kind 与 basic 命名空间且不产生历史", () => {
    const store = editableStore();
    const beforeRevision = store.state.revision;
    expect(() =>
      store.addModuleInstance({
        ...cellInstance(1),
        kind: "edge",
        edgeId: "edge:square:1",
        adjacentCellIds: ["cell:square:1:1"],
      }),
    ).toThrow("module-instance-kind-not-allowed:edge");
    expect(() =>
      store.addModuleInstance({
        ...cellInstance(2),
        elementId: "tessera.basic:cell.color",
      }),
    ).toThrow("module-instance-basic-owned");
    expect(store.state.moduleInstances.size).toBe(0);
    expect(store.state.revision).toBe(beforeRevision);
    expect(store.canUndo).toBe(false);
  });

  it("命令入口以稀疏索引拒绝 basic cell 与 edge 的实例 ID 冲突", () => {
    const store = editableStore();
    store.paintCell(1, 1, "#FFFFFFFF");
    const basicCell = store.state.cells.get(cellId("square", 1, 1));
    if (basicCell === undefined) throw new Error("basic-cell-missing");
    const cellConflict = {
      ...cellInstance(1),
      instanceId: basicCell.instanceId,
    };
    const beforeCellConflict = store.state.revision;
    expect(() => store.addModuleInstance(cellConflict)).toThrow(
      "module-instance-basic-id-conflict",
    );
    expect(store.state.revision).toBe(beforeCellConflict);

    const identity = edgeIdentity(input.grid, { row: 2, column: 2 }, 1);
    store.paintEdge(identity.edgeId, identity.adjacentCellIds, "#FFFFFFFF");
    const basicEdge = store.state.edges.get(identity.edgeId);
    if (basicEdge === undefined) throw new Error("basic-edge-missing");
    const beforeEdgeConflict = store.state.revision;
    expect(() =>
      store.addModuleInstance({
        ...cellInstance(2),
        instanceId: basicEdge.instanceId,
      }),
    ).toThrow("module-instance-basic-id-conflict");
    expect(store.state.revision).toBe(beforeEdgeConflict);
  });

  it("自由坐标与锚定 overlay 使用独立稀疏索引", () => {
    const free = (instanceId: string, x: number): ModuleOverlayInstance => ({
      kind: "overlay",
      objectKind: "free-overlay",
      overlayType: "marker",
      instanceId,
      elementId: "example.weather:marker.station",
      layerId: "example.weather.surface",
      point: { x, y: 32 },
      orderInLayer: 0,
      attributes: {},
      styleOverrides: {},
      extensions: {},
      runtimeStatus: "available",
    });
    const freeBase = free("cell-marker", 0);
    const anchored: ModuleOverlayInstance = {
      kind: "overlay",
      objectKind: "anchored-overlay",
      overlayType: freeBase.overlayType,
      instanceId: freeBase.instanceId,
      elementId: freeBase.elementId,
      layerId: freeBase.layerId,
      anchor: {
        kind: "cell",
        cellId: "cell:square:1:1",
        extensions: {},
      },
      orderInLayer: freeBase.orderInLayer,
      attributes: freeBase.attributes,
      styleOverrides: freeBase.styleOverrides,
      extensions: freeBase.extensions,
      runtimeStatus: freeBase.runtimeStatus,
    };
    const store = new ModuleInstanceStore([
      free("near", 32),
      free("far", 320_000),
      anchored,
    ]);

    expect(
      store
        .queryFreeOverlays({
          minX: 0,
          minY: 0,
          maxX: 64,
          maxY: 64,
        })
        .map((instance) => instance.instanceId),
    ).toEqual(["near"]);
    expect(
      store
        .valuesForOverlayAnchor("cell", "cell:square:1:1")
        .map((instance) => instance.instanceId),
    ).toEqual(["cell-marker"]);
    store.delete("near");
    expect(
      store.queryFreeOverlays({
        minX: 0,
        minY: 0,
        maxX: 64,
        maxY: 64,
      }),
    ).toEqual([]);
  });

  it("结构边提升为基础边样式时更换 UUID，撤销重做恢复双方身份", () => {
    const store = edgeEditableStore();
    const structure = structureEdge(store);
    const river: ModuleEdgeInstance = {
      kind: "edge",
      instanceId: "generic-river",
      elementId: "example.weather:edge.river",
      layerId: "example.weather.surface",
      edgeId: structure.edgeId,
      adjacentCellIds: structure.adjacentCellIds,
      attributes: {},
      styleOverrides: {},
      extensions: {},
      runtimeStatus: "available",
    };
    store.addModuleInstance(river, [structure]);
    expect(store.state.edges.get(structure.edgeId)?.instanceId).toBe(
      structure.instanceId,
    );

    store.paintEdge(structure.edgeId, structure.adjacentCellIds, "#123456FF");
    const explicitId = store.state.edges.get(structure.edgeId)?.instanceId;
    expect(explicitId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(
      store.state.edges.getByInstanceId(structure.instanceId),
    ).toBeUndefined();
    expect(store.state.edges.get(structure.edgeId)?.persistence).toBe(
      "explicit-style",
    );

    store.undo();
    expect(store.state.edges.get(structure.edgeId)).toMatchObject({
      instanceId: structure.instanceId,
      persistence: "reference-only",
    });
    store.redo();
    expect(store.state.edges.get(structure.edgeId)).toMatchObject({
      instanceId: explicitId,
      persistence: "explicit-style",
    });
  });

  it("删除基础边样式只降级结构边并保留同边各图层对象", () => {
    const store = edgeEditableStore();
    const structure = structureEdge(store);
    store.paintEdge(structure.edgeId, structure.adjacentCellIds, "#123456FF");
    const explicit = store.state.edges.get(structure.edgeId);
    if (explicit === undefined) throw new Error("explicit-edge-missing");
    const edgeData: EdgeOverride = {
      instanceId: explicit.instanceId,
      edgeId: explicit.edgeId,
      adjacentCellIds: explicit.adjacentCellIds,
      strokeColor: explicit.strokeColor,
      strokeWidth: explicit.strokeWidth,
      strokeOpacity: explicit.strokeOpacity,
      lineStyle: explicit.lineStyle,
      persistence: explicit.persistence,
    };
    const basicMarkerId = store.placeEdgeMarker(edgeData);
    const basicConnectionId = store.createConnection(
      { kind: "edge-midpoint", edgeId: structure.edgeId },
      { kind: "cell-center", cellId: "cell:square:3:5" },
      "line",
    );
    const river: ModuleEdgeInstance = {
      kind: "edge",
      instanceId: "generic-river",
      elementId: "example.weather:edge.river",
      layerId: "example.weather.surface",
      edgeId: structure.edgeId,
      adjacentCellIds: structure.adjacentCellIds,
      attributes: {},
      styleOverrides: {},
      extensions: {},
      runtimeStatus: "available",
    };
    const marker: ModuleOverlayInstance = {
      kind: "overlay",
      objectKind: "anchored-overlay",
      overlayType: "marker",
      instanceId: "generic-marker",
      elementId: "example.weather:marker.station",
      layerId: "example.weather.surface",
      anchor: { kind: "edge", edgeId: structure.edgeId, extensions: {} },
      orderInLayer: 0,
      attributes: {},
      styleOverrides: {},
      extensions: {},
      runtimeStatus: "available",
    };
    const connection: ModuleConnectionInstance = {
      kind: "connection",
      objectKind: "line",
      instanceId: "generic-connection",
      elementId: "example.weather:connection.front",
      layerId: "example.weather.surface",
      start: {
        kind: "edge-midpoint",
        edgeId: structure.edgeId,
        extensions: {},
      },
      end: {
        kind: "cell-center",
        cellId: "cell:square:4:5",
        extensions: {},
      },
      label: null,
      attributes: {},
      styleOverrides: {},
      extensions: {},
      runtimeStatus: "available",
    };
    store.addModuleInstance(river);
    store.addModuleInstance(marker);
    store.addModuleInstance(connection);

    store.select([{ kind: "edge", id: structure.edgeId }], false);
    store.deleteSelection();

    expect(store.state.edges.get(structure.edgeId)).toMatchObject({
      instanceId: structure.instanceId,
      persistence: "reference-only",
    });
    expect(store.state.overlays.get(basicMarkerId)).toBeDefined();
    expect(store.state.connections.get(basicConnectionId)).toBeDefined();
    expect(store.state.moduleInstances.get(river.instanceId)).toBeDefined();
    expect(store.state.moduleInstances.get(marker.instanceId)).toBeDefined();
    expect(
      store.state.moduleInstances.get(connection.instanceId),
    ).toBeDefined();

    store.undo();
    expect(store.state.edges.get(structure.edgeId)).toMatchObject({
      instanceId: explicit.instanceId,
      persistence: "explicit-style",
    });
    store.redo();
    expect(store.state.edges.get(structure.edgeId)?.persistence).toBe(
      "reference-only",
    );
  });

  it("替换 generic connection 原子维护边引用索引", () => {
    const connections = new ModuleInstanceStore();
    const connection: ModuleConnectionInstance = {
      kind: "connection",
      objectKind: "line",
      instanceId: "moving-front",
      elementId: "example.weather:connection.front",
      layerId: "example.weather.surface",
      start: { kind: "edge-midpoint", edgeId: "edge-a", extensions: {} },
      end: { kind: "map-point", point: { x: 64, y: 64 }, extensions: {} },
      label: null,
      attributes: {},
      styleOverrides: {},
      extensions: {},
      runtimeStatus: "available",
    };
    connections.add(connection);
    expect(connections.hasEdgeReference("edge-a")).toBe(true);
    connections.replace({
      ...connection,
      start: { kind: "edge-midpoint", edgeId: "edge-b", extensions: {} },
    });
    expect(connections.hasEdgeReference("edge-a")).toBe(false);
    expect(connections.hasEdgeReference("edge-b")).toBe(true);
  });

  it("generic connection 空间查询只访问视口相交候选并保留穿越线段", () => {
    const connections = new ModuleInstanceStore();
    connections.configureConnectionSpatialIndex(1024, (connection) => {
      if (
        connection.start.kind !== "map-point" ||
        connection.end.kind !== "map-point"
      )
        return undefined;
      return {
        minX: Math.min(connection.start.point.x, connection.end.point.x),
        minY: Math.min(connection.start.point.y, connection.end.point.y),
        maxX: Math.max(connection.start.point.x, connection.end.point.x),
        maxY: Math.max(connection.start.point.y, connection.end.point.y),
      };
    });
    const connection = (
      instanceId: string,
      startX: number,
      endX: number,
      y: number,
    ): ModuleConnectionInstance => ({
      kind: "connection",
      objectKind: "line",
      instanceId,
      elementId: "example.weather:connection.front",
      layerId: "example.weather.surface",
      start: { kind: "map-point", point: { x: startX, y }, extensions: {} },
      end: { kind: "map-point", point: { x: endX, y }, extensions: {} },
      label: null,
      attributes: {},
      styleOverrides: {},
      extensions: {},
      runtimeStatus: "available",
    });
    connections.add(connection("crossing", -100, 200, 32));
    for (let index = 0; index < 2_000; index += 1) {
      const startX = 100_000 + index * 2_048;
      connections.add(connection(`far-${index}`, startX, startX + 64, 32));
    }

    expect(
      connections
        .queryConnections({ minX: 0, minY: 0, maxX: 96, maxY: 96 })
        .map((value) => value.instanceId),
    ).toEqual(["crossing"]);
    expect(connections.connectionSpatialIndexStats.candidateCount).toBeLessThan(
      10,
    );
  });

  it("DomainGroup 空间索引在添加、替换、删除与重建后保持闭合", () => {
    const groups = new ModuleInstanceStore();
    const bounds = (group: ModuleDomainGroupInstance) => {
      const rows = group.memberCellIds.map(
        (id) => Number(id.split(":").at(-2)) * 32,
      );
      const columns = group.memberCellIds.map(
        (id) => Number(id.split(":").at(-1)) * 32,
      );
      return {
        minX: Math.min(...columns),
        minY: Math.min(...rows),
        maxX: Math.max(...columns) + 32,
        maxY: Math.max(...rows) + 32,
      };
    };
    groups.configureDomainGroupSpatialIndex(2_048, bounds);
    const instance: ModuleDomainGroupInstance = {
      kind: "domain-group",
      instanceId: "domain-indexed",
      elementId: "example.weather:domain.zone",
      layerId: "example.weather.surface",
      memberCellIds: ["cell:square:2:2", "cell:square:2:3"],
      attributes: {},
      styleOverrides: {},
      extensions: {},
      runtimeStatus: "available",
    };
    groups.add(instance);
    expect(
      groups.queryDomainGroups({ minX: 60, minY: 60, maxX: 130, maxY: 100 }),
    ).toHaveLength(1);

    groups.replace({
      ...instance,
      memberCellIds: ["cell:square:200:2", "cell:square:200:3"],
    });
    expect(
      groups.queryDomainGroups({ minX: 60, minY: 60, maxX: 130, maxY: 100 }),
    ).toHaveLength(0);
    expect(
      groups.queryDomainGroups({
        minX: 60,
        minY: 6_390,
        maxX: 130,
        maxY: 6_450,
      }),
    ).toHaveLength(1);

    groups.configureDomainGroupSpatialIndex(2_048, bounds);
    expect(groups.domainGroupSpatialIndexStats.indexedCount).toBe(1);
    expect(groups.delete(instance.instanceId)).toBe(true);
    expect(groups.domainGroupSpatialIndexStats.indexedCount).toBe(0);
  });
});
