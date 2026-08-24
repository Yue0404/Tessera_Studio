import type { ProjectState } from "@tessera/core";

import { computeProjectContentBounds } from "./content-bounds.js";
import { compareStableId } from "./deterministic-order.js";
import type { ProjectV1Document } from "./format-types.js";

const BASIC_ELEMENT_PREFIX = "tessera.basic:";

export type ProjectSerializationMode = "preserve" | "full";

export class ProjectReconcileError extends Error {
  constructor(
    readonly code: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(code);
    this.name = "ProjectReconcileError";
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isBasicElement(value: any): boolean {
  return (
    typeof value?.elementId === "string" &&
    value.elementId.startsWith(BASIC_ELEMENT_PREFIX)
  );
}

function mergeExtensions(current: any, baseline: any): any {
  return {
    ...current,
    extensions: clone(baseline?.extensions ?? current.extensions ?? {}),
  };
}

function mergeBasicInstance(current: any, baseline: any): any {
  const same = baseline?.find(
    (candidate: any) =>
      candidate.instanceId === current.instanceId &&
      candidate.elementId === current.elementId &&
      candidate.layerId === current.layerId,
  );
  return {
    ...mergeExtensions(current, same),
    styleOverrides: {
      ...(same?.styleOverrides ?? {}),
      ...current.styleOverrides,
    },
    attributes: {
      ...(same?.attributes ?? {}),
      ...current.attributes,
    },
  };
}

function orderedInstances(values: any[]): any[] {
  return values.sort(
    (left, right) =>
      compareStableId(left.layerId, right.layerId) ||
      compareStableId(left.instanceId, right.instanceId),
  );
}

function allCells(project: any): Map<string, any> {
  return new Map(
    project.chunks.flatMap((chunk: any) =>
      chunk.cellOverrides.map((cell: any) => [cell.cellId, cell] as const),
    ),
  );
}

function reconcileCells(baseline: any, current: any): any[] {
  const baselineCells = allCells(baseline);
  const currentCells = allCells(current);
  const ids = new Set([...baselineCells.keys(), ...currentCells.keys()]);
  const result: any[] = [];
  for (const cellId of ids) {
    const before = baselineCells.get(cellId);
    const next = currentCells.get(cellId);
    const opaque = (before?.layerInstances ?? []).filter(
      (instance: any) => !isBasicElement(instance),
    );
    const basic = (next?.layerInstances ?? [])
      .filter(isBasicElement)
      .map((instance: any) =>
        mergeBasicInstance(instance, before?.layerInstances),
      );
    const layerInstances = orderedInstances([...opaque.map(clone), ...basic]);
    if (layerInstances.length === 0) continue;
    result.push({
      cellId,
      layerInstances,
      extensions: clone(before?.extensions ?? next?.extensions ?? {}),
    });
  }
  return result.sort((left, right) => compareCellId(left.cellId, right.cellId));
}

function reconcileEdges(
  state: Readonly<ProjectState>,
  baseline: any,
  current: any,
): any[] {
  const beforeById = new Map<string, any>(
    baseline.managers.edgeManager.edges.map((edge: any) => [edge.edgeId, edge]),
  );
  const nextById = new Map<string, any>(
    current.managers.edgeManager.edges.map((edge: any) => [edge.edgeId, edge]),
  );
  const ids = new Set<string>([...beforeById.keys(), ...nextById.keys()]);
  const result: any[] = [];
  for (const edgeId of ids) {
    const before: any = beforeById.get(edgeId);
    const next: any = nextById.get(edgeId);
    const opaque = (before?.layerInstances ?? []).filter(
      (instance: any) => !isBasicElement(instance),
    );
    const basic = (next?.layerInstances ?? [])
      .filter(isBasicElement)
      .map((instance: any) =>
        mergeBasicInstance(instance, before?.layerInstances),
      );
    const layerInstances = orderedInstances([...opaque.map(clone), ...basic]);
    // 结构边本身不带 layer instance；只要仍在唯一 EdgeManager 中，就先保留
    // carrier，后续 applyModuleRuntime 再按 overlay/connection 引用闭包裁剪。
    if (layerInstances.length === 0 && state.edges.get(edgeId) === undefined)
      continue;
    result.push({
      ...(next ?? clone(before)),
      layerInstances,
      extensions: clone(before?.extensions ?? next?.extensions ?? {}),
    });
  }
  return result.sort((left, right) =>
    compareStableId(left.edgeId, right.edgeId),
  );
}

function reconcileWholeObjects(
  baselineValues: any[],
  currentValues: any[],
  idKey: "connectionId" | "overlayId",
): any[] {
  const beforeById = new Map(
    baselineValues.map((value) => [value[idKey] as string, value]),
  );
  const result = baselineValues
    .filter((value) => !isBasicElement(value))
    .map(clone);
  for (const current of currentValues) {
    const before = beforeById.get(current[idKey]);
    if (before !== undefined && !isBasicElement(before)) {
      throw new ProjectReconcileError("project-opaque-id-conflict", {
        collection: idKey === "overlayId" ? "overlays" : "connections",
        id: current[idKey],
      });
    }
    const matchingBefore =
      before?.elementId === current.elementId &&
      before?.layerId === current.layerId
        ? before
        : undefined;
    let merged = {
      ...mergeExtensions(current, matchingBefore),
      styleOverrides: {
        ...(matchingBefore?.styleOverrides ?? {}),
        ...current.styleOverrides,
      },
      attributes: {
        ...(matchingBefore?.attributes ?? {}),
        ...current.attributes,
      },
    };
    if (idKey === "connectionId" && matchingBefore !== undefined) {
      merged = {
        ...merged,
        start: mergeExtensions(current.start, matchingBefore.start),
        end: mergeExtensions(current.end, matchingBefore.end),
      };
    } else if (
      idKey === "overlayId" &&
      matchingBefore?.kind === "anchored-overlay" &&
      current.kind === "anchored-overlay"
    ) {
      merged = {
        ...merged,
        anchor: mergeExtensions(current.anchor, matchingBefore.anchor),
      };
    }
    result.push(merged);
  }
  return result.sort((left, right) =>
    compareStableId(left[idKey], right[idKey]),
  );
}

function compareCellId(left: string, right: string): number {
  const leftParts = left.split(":");
  const rightParts = right.split(":");
  const leftRow = Number(leftParts.at(-2));
  const leftColumn = Number(leftParts.at(-1));
  const rightRow = Number(rightParts.at(-2));
  const rightColumn = Number(rightParts.at(-1));
  return leftRow - rightRow || leftColumn - rightColumn;
}

function cellChunkKey(cellId: string): string {
  const parts = cellId.split(":");
  const row = Number(parts.at(-2));
  const column = Number(parts.at(-1));
  return `${Math.floor(row / 64)}:${Math.floor(column / 64)}`;
}

function chunkKey(chunk: any): string {
  return `${String(chunk.chunkRow)}:${String(chunk.chunkColumn)}`;
}

function reconcileChunks(
  baseline: any,
  current: any,
  cells: any[],
  edges: any[],
  overlays: any[],
): any[] {
  const baselineChunks = new Map<string, any>(
    baseline.chunks.map((chunk: any) => [chunkKey(chunk), chunk]),
  );
  const currentChunks = new Map<string, any>(
    current.chunks.map((chunk: any) => [chunkKey(chunk), chunk]),
  );
  const chunks = new Map<string, any>();
  const ensure = (key: string): any => {
    const existing = chunks.get(key);
    if (existing !== undefined) return existing;
    const [chunkRow, chunkColumn] = key.split(":").map(Number);
    const created = {
      chunkRow,
      chunkColumn,
      cellOverrides: [],
      ownedEdgeIds: [],
      ownedOverlayIds: [],
      ownedDomainGroupIds: [],
      extensions: clone(baselineChunks.get(key)?.extensions ?? {}),
    };
    chunks.set(key, created);
    return created;
  };
  for (const cell of cells)
    ensure(cellChunkKey(cell.cellId)).cellOverrides.push(cell);

  const validEdges = new Set(edges.map((edge) => edge.edgeId));
  const validOverlays = new Set(overlays.map((overlay) => overlay.overlayId));
  const validGroups = new Set(
    baseline.domainGroups.map((group: any) => group.groupId),
  );
  for (const source of [baselineChunks, currentChunks]) {
    for (const [key, chunk] of source) {
      const target = ensure(key);
      for (const edgeId of chunk.ownedEdgeIds) {
        if (validEdges.has(edgeId) && !target.ownedEdgeIds.includes(edgeId))
          target.ownedEdgeIds.push(edgeId);
      }
      for (const overlayId of chunk.ownedOverlayIds) {
        if (
          validOverlays.has(overlayId) &&
          !target.ownedOverlayIds.includes(overlayId)
        )
          target.ownedOverlayIds.push(overlayId);
      }
      for (const groupId of chunk.ownedDomainGroupIds) {
        if (
          validGroups.has(groupId) &&
          !target.ownedDomainGroupIds.includes(groupId)
        )
          target.ownedDomainGroupIds.push(groupId);
      }
    }
  }
  for (const chunk of chunks.values()) {
    chunk.cellOverrides.sort((left: any, right: any) =>
      compareCellId(left.cellId, right.cellId),
    );
    chunk.ownedEdgeIds.sort(compareStableId);
    chunk.ownedOverlayIds.sort(compareStableId);
    chunk.ownedDomainGroupIds.sort(compareStableId);
  }
  return [...chunks.values()]
    .filter(
      (chunk) =>
        chunk.cellOverrides.length > 0 ||
        chunk.ownedEdgeIds.length > 0 ||
        chunk.ownedOverlayIds.length > 0 ||
        chunk.ownedDomainGroupIds.length > 0,
    )
    .sort(
      (left, right) =>
        left.chunkRow - right.chunkRow || left.chunkColumn - right.chunkColumn,
    );
}

function reconcileLayers(
  state: Readonly<ProjectState>,
  baseline: any,
  current: any,
): any[] {
  const beforeById = new Map<string, any>(
    baseline.layerStates.map((layer: any) => [layer.layerId, layer]),
  );
  const currentById = new Map<string, any>(
    current.layerStates.map((layer: any) => [layer.layerId, layer]),
  );
  const layerIds = new Set<string>([
    ...beforeById.keys(),
    ...currentById.keys(),
  ]);
  const result: any[] = [];
  for (const layerId of layerIds) {
    const before: any = beforeById.get(layerId);
    const next: any = currentById.get(layerId);
    const runtime = state.layers.get(layerId);
    if (runtime?.runtimeStatus === "missing" && before !== undefined) {
      // 缺包层运行时由恢复器强制锁定；持久化仍保留原值，精确包恢复后可还原。
      result.push({
        ...clone(before),
        visible: runtime.visible,
        locked: before.locked,
        opacity: runtime.opacity,
      });
    } else if (runtime !== undefined && before !== undefined) {
      result.push({
        ...clone(before),
        visible: runtime.visible,
        locked: runtime.locked,
        opacity: runtime.opacity,
      });
    } else if (next !== undefined) {
      result.push(mergeExtensions(next, before));
    } else if (before !== undefined) {
      result.push(clone(before));
    }
  }
  return result.sort(
    (left, right) =>
      left.zIndex - right.zIndex ||
      compareStableId(left.layerId, right.layerId),
  );
}

function runtimeLayerInstance(instance: any): any {
  return {
    instanceId: instance.instanceId,
    elementId: instance.elementId,
    layerId: instance.layerId,
    styleOverrides: clone(instance.styleOverrides),
    attributes: clone(instance.attributes),
    extensions: clone(instance.extensions),
  };
}

/** 将稀疏 runtime 容器投影回既有 Project v1 容器，不引入第二套持久化格式。 */
function applyModuleRuntime(state: Readonly<ProjectState>, project: any): void {
  const cells = allCells(project);
  for (const cell of cells.values()) {
    cell.layerInstances = cell.layerInstances.filter(isBasicElement);
  }
  const edges = new Map<string, any>(
    project.managers.edgeManager.edges.map((edge: any) => {
      edge.layerInstances = edge.layerInstances.filter(isBasicElement);
      return [edge.edgeId, edge] as const;
    }),
  );
  project.managers.connectionManager.connections =
    project.managers.connectionManager.connections.filter(isBasicElement);
  project.managers.overlayManager.overlays =
    project.managers.overlayManager.overlays.filter(isBasicElement);
  project.domainGroups = [];

  for (const instance of state.moduleInstances.values()) {
    if (instance.kind === "cell") {
      let cell = cells.get(instance.cellId);
      if (cell === undefined) {
        cell = { cellId: instance.cellId, layerInstances: [], extensions: {} };
        cells.set(instance.cellId, cell);
      }
      cell.layerInstances.push(runtimeLayerInstance(instance));
    } else if (instance.kind === "edge") {
      let edge = edges.get(instance.edgeId);
      if (edge === undefined) {
        edge = {
          kind: "edge",
          edgeId: instance.edgeId,
          adjacentCellIds: [...instance.adjacentCellIds],
          layerInstances: [],
          extensions: {},
        };
        edges.set(instance.edgeId, edge);
      }
      edge.layerInstances.push(runtimeLayerInstance(instance));
    } else if (instance.kind === "overlay") {
      project.managers.overlayManager.overlays.push({
        kind: instance.objectKind,
        overlayId: instance.instanceId,
        elementId: instance.elementId,
        layerId: instance.layerId,
        overlayType: instance.overlayType,
        ...(instance.objectKind === "anchored-overlay"
          ? { anchor: clone(instance.anchor) }
          : { point: clone(instance.point) }),
        styleOverrides: clone(instance.styleOverrides),
        attributes: clone(instance.attributes),
        orderInLayer: instance.orderInLayer,
        extensions: clone(instance.extensions),
      });
    } else if (instance.kind === "connection") {
      project.managers.connectionManager.connections.push({
        kind: instance.objectKind,
        connectionId: instance.instanceId,
        elementId: instance.elementId,
        layerId: instance.layerId,
        start: clone(instance.start),
        end: clone(instance.end),
        styleOverrides: clone(instance.styleOverrides),
        attributes: clone(instance.attributes),
        label: instance.label,
        ...(instance.objectKind === "arrow"
          ? {
              arrowStart: instance.arrowStart ?? false,
              arrowEnd: instance.arrowEnd ?? true,
            }
          : {}),
        extensions: clone(instance.extensions),
      });
    } else {
      project.domainGroups.push({
        kind: "domain-group",
        groupId: instance.instanceId,
        elementId: instance.elementId,
        layerId: instance.layerId,
        memberCellIds: [...instance.memberCellIds],
        attributes: clone(instance.attributes),
        styleOverrides: clone(instance.styleOverrides),
        extensions: clone(instance.extensions),
      });
    }
  }

  for (const cell of cells.values())
    cell.layerInstances = orderedInstances(cell.layerInstances);
  for (const edge of edges.values())
    edge.layerInstances = orderedInstances(edge.layerInstances);
  const referencedEdgeIds = new Set<string>();
  for (const overlay of project.managers.overlayManager.overlays) {
    if (overlay.kind === "anchored-overlay" && overlay.anchor.kind === "edge")
      referencedEdgeIds.add(overlay.anchor.edgeId);
  }
  for (const connection of project.managers.connectionManager.connections) {
    if (connection.start.kind === "edge-midpoint")
      referencedEdgeIds.add(connection.start.edgeId);
    if (connection.end.kind === "edge-midpoint")
      referencedEdgeIds.add(connection.end.edgeId);
  }
  for (const [edgeId, edge] of edges) {
    if (edge.layerInstances.length === 0 && !referencedEdgeIds.has(edgeId))
      edges.delete(edgeId);
  }
  project.managers.edgeManager.edges = [...edges.values()].sort((left, right) =>
    compareStableId(left.edgeId, right.edgeId),
  );
  project.managers.connectionManager.connections.sort((left: any, right: any) =>
    compareStableId(left.connectionId, right.connectionId),
  );
  project.managers.overlayManager.overlays.sort((left: any, right: any) =>
    compareStableId(left.overlayId, right.overlayId),
  );
  project.domainGroups.sort((left: any, right: any) =>
    compareStableId(left.groupId, right.groupId),
  );

  const priorChunks = new Map<string, any>(
    project.chunks.map((chunk: any) => [chunkKey(chunk), chunk] as const),
  );
  const chunks = new Map<string, any>();
  const ensure = (key: string): any => {
    const existing = chunks.get(key);
    if (existing !== undefined) return existing;
    const [chunkRow, chunkColumn] = key.split(":").map(Number);
    const created = {
      chunkRow,
      chunkColumn,
      cellOverrides: [],
      ownedEdgeIds: [],
      ownedOverlayIds: [],
      ownedDomainGroupIds: [],
      extensions: clone(priorChunks.get(key)?.extensions ?? {}),
    };
    chunks.set(key, created);
    return created;
  };
  for (const cell of cells.values()) {
    if (cell.layerInstances.length > 0)
      ensure(cellChunkKey(cell.cellId)).cellOverrides.push(cell);
  }
  for (const edge of project.managers.edgeManager.edges) {
    const owner = edge.adjacentCellIds[0];
    if (owner !== undefined)
      ensure(cellChunkKey(owner)).ownedEdgeIds.push(edge.edgeId);
  }
  const edgeById = new Map<string, any>(
    project.managers.edgeManager.edges.map((edge: any) => [edge.edgeId, edge]),
  );
  for (const overlay of project.managers.overlayManager.overlays) {
    if (overlay.kind !== "anchored-overlay") continue;
    const owner =
      overlay.anchor.kind === "cell"
        ? overlay.anchor.cellId
        : edgeById.get(overlay.anchor.edgeId)?.adjacentCellIds?.[0];
    if (owner !== undefined)
      ensure(cellChunkKey(owner)).ownedOverlayIds.push(overlay.overlayId);
  }
  for (const group of project.domainGroups) {
    const owner = group.memberCellIds[0];
    if (owner !== undefined)
      ensure(cellChunkKey(owner)).ownedDomainGroupIds.push(group.groupId);
  }
  for (const chunk of chunks.values()) {
    chunk.cellOverrides.sort((left: any, right: any) =>
      compareCellId(left.cellId, right.cellId),
    );
    chunk.ownedEdgeIds.sort(compareStableId);
    chunk.ownedOverlayIds.sort(compareStableId);
    chunk.ownedDomainGroupIds.sort(compareStableId);
  }
  project.chunks = [...chunks.values()].sort(
    (left, right) =>
      left.chunkRow - right.chunkRow || left.chunkColumn - right.chunkColumn,
  );
}

/**
 * validated opaque baseline 保留未进入专用 manager 的事实；当前运行时状态始终覆盖基线。
 */
export function reconcileProjectDocument(
  state: Readonly<ProjectState>,
  generated: Record<string, any>,
  mode: ProjectSerializationMode,
): ProjectV1Document {
  const opaque = state.formatSource.opaqueDocument;
  if (opaque === null) {
    const fresh = clone(generated);
    fresh.exportScope =
      mode === "full" ? "full" : state.formatSource.exportScope;
    fresh.isComplete = mode === "full" ? true : state.formatSource.isComplete;
    fresh.lineage = clone(state.formatSource.lineage);
    applyModuleRuntime(state, fresh);
    fresh.contentBounds = computeProjectContentBounds(fresh);
    return fresh as ProjectV1Document;
  }
  const baseline: any = clone(opaque);
  const current: any = clone(generated);
  const cells = reconcileCells(baseline, current);
  const edges = reconcileEdges(state, baseline, current);
  const connections = reconcileWholeObjects(
    baseline.managers.connectionManager.connections,
    current.managers.connectionManager.connections,
    "connectionId",
  );
  const overlays = reconcileWholeObjects(
    baseline.managers.overlayManager.overlays,
    current.managers.overlayManager.overlays,
    "overlayId",
  );
  const result: any = {
    ...baseline,
    projectId: current.projectId,
    name: current.name,
    createdAt: current.createdAt,
    updatedAt: current.updatedAt,
    exportScope: mode === "full" ? "full" : state.formatSource.exportScope,
    isComplete: mode === "full" ? true : state.formatSource.isComplete,
    lineage: clone(state.formatSource.lineage),
    grid: {
      ...baseline.grid,
      ...current.grid,
      extensions: clone(baseline.grid.extensions),
    },
    modules: clone(baseline.modules),
    layerStates: reconcileLayers(state, baseline, current),
    mapStyle: {
      ...baseline.mapStyle,
      ...current.mapStyle,
      gridLineStyle: {
        ...baseline.mapStyle.gridLineStyle,
        ...current.mapStyle.gridLineStyle,
      },
      defaultCellStyle: {
        ...baseline.mapStyle.defaultCellStyle,
        ...current.mapStyle.defaultCellStyle,
      },
      defaultEdgeStyle: {
        ...baseline.mapStyle.defaultEdgeStyle,
        ...current.mapStyle.defaultEdgeStyle,
      },
      extensions: clone(baseline.mapStyle.extensions),
    },
    managers: {
      edgeManager: {
        ...baseline.managers.edgeManager,
        edges,
        extensions: clone(baseline.managers.edgeManager.extensions),
      },
      connectionManager: {
        ...baseline.managers.connectionManager,
        connections,
        extensions: clone(baseline.managers.connectionManager.extensions),
      },
      overlayManager: {
        ...baseline.managers.overlayManager,
        overlays,
        extensions: clone(baseline.managers.overlayManager.extensions),
      },
    },
    domainGroups: clone(baseline.domainGroups),
    embeddedAssets: clone(baseline.embeddedAssets),
    viewState: clone(baseline.viewState),
    extensions: clone(baseline.extensions),
  };
  result.chunks = reconcileChunks(baseline, current, cells, edges, overlays);
  applyModuleRuntime(state, result);
  result.contentBounds = computeProjectContentBounds(result);
  return result as ProjectV1Document;
}
