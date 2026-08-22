import type { ProjectState } from "@tessera/core";

import { computeProjectContentBounds } from "./content-bounds.js";
import { compareStableId } from "./deterministic-order.js";
import type { ProjectV1Document } from "./format-types.js";

const BASIC_ELEMENT_PREFIX = "tessera.basic:";
const BASIC_LAYER_PREFIX = "tessera.basic.";

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

function reconcileEdges(baseline: any, current: any): any[] {
  const beforeById = new Map(
    baseline.managers.edgeManager.edges.map((edge: any) => [edge.edgeId, edge]),
  );
  const nextById = new Map(
    current.managers.edgeManager.edges.map((edge: any) => [edge.edgeId, edge]),
  );
  const ids = new Set([...beforeById.keys(), ...nextById.keys()]);
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
    if (layerInstances.length === 0) continue;
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

function reconcileLayers(baseline: any, current: any): any[] {
  const beforeById = new Map(
    baseline.layerStates.map((layer: any) => [layer.layerId, layer]),
  );
  const opaque = baseline.layerStates
    .filter((layer: any) => !layer.layerId.startsWith(BASIC_LAYER_PREFIX))
    .map(clone);
  const basic = current.layerStates
    .filter((layer: any) => layer.layerId.startsWith(BASIC_LAYER_PREFIX))
    .map((layer: any) => mergeExtensions(layer, beforeById.get(layer.layerId)));
  return [...opaque, ...basic].sort(
    (left, right) =>
      left.zIndex - right.zIndex ||
      compareStableId(left.layerId, right.layerId),
  );
}

/**
 * validated opaque baseline 只保留 core 不可编辑的事实；当前 basic 状态始终覆盖基线。
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
    fresh.contentBounds = computeProjectContentBounds(fresh);
    return fresh as ProjectV1Document;
  }
  const baseline: any = clone(opaque);
  const current: any = clone(generated);
  const cells = reconcileCells(baseline, current);
  const edges = reconcileEdges(baseline, current);
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
    layerStates: reconcileLayers(baseline, current),
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
  result.contentBounds = computeProjectContentBounds(result);
  return result as ProjectV1Document;
}
