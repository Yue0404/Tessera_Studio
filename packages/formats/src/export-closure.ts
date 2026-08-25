import {
  cellPolygon,
  clipSegmentToRect,
  edgeSegment,
  parseCellId,
  pointInRect,
  resolveDomainGroupLayout,
  type MapRect,
  type ProjectGrid,
  type ProjectState,
} from "@tessera/core";
import {
  computeProjectContentBounds,
  documentEndpointPoint,
  documentOverlayAnchorPoint,
  documentOverlayBounds,
  type ContentBounds,
} from "./content-bounds.js";
import { compareCellId, compareStableId } from "./deterministic-order.js";
import type { FragmentV1Document, ProjectV1Document } from "./format-types.js";
import { validateFragmentDocumentV1 } from "./fragment-format.js";
import {
  ProjectFormatError,
  toProjectV1,
  validateProjectDocumentV1,
} from "./project-format.js";

export interface ExportClosureSelection {
  readonly bounds: ContentBounds;
  readonly includedLayerIds: readonly string[];
}

interface SelectedObjects {
  readonly cellOverrides: any[];
  readonly edges: any[];
  readonly connections: any[];
  readonly overlays: any[];
  readonly domainGroups: any[];
  readonly embeddedAssets: any[];
}

function intersects(left: ContentBounds, right: ContentBounds): boolean {
  return !(
    left.maxX < right.minX ||
    left.minX > right.maxX ||
    left.maxY < right.minY ||
    left.minY > right.maxY
  );
}

function polygonBounds(points: readonly { x: number; y: number }[]) {
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

function cross(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  d: { x: number; y: number },
): boolean {
  const epsilon = 1e-9;
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return (
    Math.min(a.x, b.x) - epsilon <= Math.max(c.x, d.x) &&
    Math.min(c.x, d.x) - epsilon <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) - epsilon <= Math.max(c.y, d.y) &&
    Math.min(c.y, d.y) - epsilon <= Math.max(a.y, b.y) &&
    abC * abD <= epsilon &&
    cdA * cdB <= epsilon
  );
}

function pointInPolygon(
  point: { x: number; y: number },
  polygon: readonly { x: number; y: number }[],
): boolean {
  let inside = false;
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index, index += 1
  ) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    if (currentPoint === undefined || previousPoint === undefined) continue;
    if (
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
          currentPoint.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function polygonIntersectsRect(
  polygon: readonly { x: number; y: number }[],
  rect: ContentBounds,
): boolean {
  if (!intersects(polygonBounds(polygon), rect)) return false;
  if (polygon.some((point) => pointInRect(point, rect))) return true;
  const corners = [
    { x: rect.minX, y: rect.minY },
    { x: rect.maxX, y: rect.minY },
    { x: rect.maxX, y: rect.maxY },
    { x: rect.minX, y: rect.maxY },
  ];
  if (corners.some((point) => pointInPolygon(point, polygon))) return true;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    if (start === undefined || end === undefined) continue;
    for (let cornerIndex = 0; cornerIndex < corners.length; cornerIndex += 1) {
      const cornerStart = corners[cornerIndex];
      const cornerEnd = corners[(cornerIndex + 1) % corners.length];
      if (
        cornerStart !== undefined &&
        cornerEnd !== undefined &&
        segmentsIntersect(start, end, cornerStart, cornerEnd)
      ) {
        return true;
      }
    }
  }
  return false;
}

function collectAssetReferences(
  value: unknown,
  knownAssetIds: ReadonlySet<string>,
  result: Set<string>,
): void {
  if (Array.isArray(value)) {
    for (const item of value)
      collectAssetReferences(item, knownAssetIds, result);
    return;
  }
  if (value === null || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const assetRef = record.assetRef;
  if (typeof assetRef === "string" && knownAssetIds.has(assetRef)) {
    result.add(assetRef);
  } else if (
    assetRef !== null &&
    typeof assetRef === "object" &&
    typeof (assetRef as Record<string, unknown>).assetId === "string" &&
    knownAssetIds.has((assetRef as Record<string, unknown>).assetId as string)
  ) {
    result.add((assetRef as Record<string, unknown>).assetId as string);
  }
  for (const [key, item] of Object.entries(record)) {
    if (key === "assetRef") continue;
    collectAssetReferences(item, knownAssetIds, result);
  }
}

function selectObjects(
  source: ProjectV1Document,
  selection: ExportClosureSelection,
): SelectedObjects {
  const project = source as any;
  const includedLayers = new Set(selection.includedLayerIds);
  const grid: ProjectGrid = {
    type: project.grid.type,
    width: project.grid.width,
    height: project.grid.height,
    cellSize: project.grid.cellSize,
  };
  const rect: MapRect = selection.bounds;
  const sourceEdges = project.managers.edgeManager.edges as any[];
  const edgeById = new Map(sourceEdges.map((edge) => [edge.edgeId, edge]));

  const cellOverrides = (project.chunks as any[])
    .flatMap((chunk) => chunk.cellOverrides as any[])
    .map((cell) => ({
      ...structuredClone(cell),
      layerInstances: cell.layerInstances.filter((instance: any) =>
        includedLayers.has(instance.layerId),
      ),
    }))
    .filter((cell) => {
      if (cell.layerInstances.length === 0) return false;
      const coordinate = parseCellId(cell.cellId);
      return polygonIntersectsRect(
        cellPolygon(grid, coordinate.row, coordinate.column),
        selection.bounds,
      );
    })
    .sort((left, right) => compareCellId(left.cellId, right.cellId));

  const selectedEdges = new Map<string, any>();
  for (const edge of sourceEdges) {
    const layerInstances = edge.layerInstances.filter((instance: any) =>
      includedLayers.has(instance.layerId),
    );
    if (layerInstances.length === 0) continue;
    const segment = edgeSegment(grid, edge.edgeId, edge.adjacentCellIds);
    if (
      segment !== undefined &&
      clipSegmentToRect(segment[0], segment[1], rect) !== null
    ) {
      selectedEdges.set(edge.edgeId, {
        ...structuredClone(edge),
        layerInstances: structuredClone(layerInstances),
      });
    }
  }

  const overlays = (project.managers.overlayManager.overlays as any[])
    .filter((overlay) => includedLayers.has(overlay.layerId))
    .filter((overlay) => {
      const anchor = documentOverlayAnchorPoint(grid, edgeById, overlay);
      return (
        anchor !== undefined &&
        (pointInRect(anchor, rect) ||
          intersects(documentOverlayBounds(anchor, overlay), selection.bounds))
      );
    })
    .map((overlay) => structuredClone(overlay))
    .sort((left, right) => compareStableId(left.overlayId, right.overlayId));

  const connections = (project.managers.connectionManager.connections as any[])
    .filter((connection) => includedLayers.has(connection.layerId))
    .filter((connection) => {
      const start = documentEndpointPoint(grid, edgeById, connection.start);
      const end = documentEndpointPoint(grid, edgeById, connection.end);
      return (
        start !== undefined &&
        end !== undefined &&
        clipSegmentToRect(start, end, rect) !== null
      );
    })
    .map((connection) => structuredClone(connection))
    .sort((left, right) =>
      compareStableId(left.connectionId, right.connectionId),
    );

  const domainGroups = (project.domainGroups as any[])
    .filter((group) => includedLayers.has(group.layerId))
    .filter((group) =>
      group.memberCellIds.some((memberCellId: string) => {
        const coordinate = parseCellId(memberCellId);
        return polygonIntersectsRect(
          cellPolygon(grid, coordinate.row, coordinate.column),
          selection.bounds,
        );
      }),
    )
    .map((group) => structuredClone(group))
    .sort((left, right) => compareStableId(left.groupId, right.groupId));

  const requiredEdgeIds = new Set<string>();
  for (const overlay of overlays) {
    if (overlay.kind === "anchored-overlay" && overlay.anchor.kind === "edge") {
      requiredEdgeIds.add(overlay.anchor.edgeId);
    }
  }
  for (const connection of connections) {
    for (const endpoint of [connection.start, connection.end]) {
      if (endpoint.kind === "edge-midpoint") {
        requiredEdgeIds.add(endpoint.edgeId);
      }
    }
  }
  for (const edgeId of requiredEdgeIds) {
    const sourceEdge = edgeById.get(edgeId);
    if (sourceEdge === undefined) {
      throw new ProjectFormatError("export-edge-reference-missing", {
        edgeId,
      });
    }
    if (!selectedEdges.has(edgeId)) {
      const selectedInstances = sourceEdge.layerInstances
        .filter((instance: any) => includedLayers.has(instance.layerId))
        .map((instance: any) => structuredClone(instance));
      selectedEdges.set(edgeId, {
        ...structuredClone(sourceEdge),
        // 结构 Edge 由引用闭包保留；reference-only 不伪造 basic 样式实例。
        layerInstances: selectedInstances,
      });
    }
  }

  const selectedValues = [
    ...cellOverrides,
    ...selectedEdges.values(),
    ...connections,
    ...overlays,
    ...domainGroups,
  ];
  const knownAssetIds = new Set(
    (project.embeddedAssets as any[]).map((asset) => asset.assetId as string),
  );
  const referencedAssetIds = new Set<string>();
  for (const value of selectedValues) {
    collectAssetReferences(value, knownAssetIds, referencedAssetIds);
  }
  const embeddedAssets = (project.embeddedAssets as any[])
    .filter((asset) => referencedAssetIds.has(asset.assetId))
    .map((asset) => structuredClone(asset))
    .sort((left, right) => compareStableId(left.assetId, right.assetId));

  return {
    cellOverrides,
    edges: [...selectedEdges.values()].sort((left, right) =>
      compareStableId(left.edgeId, right.edgeId),
    ),
    connections,
    overlays,
    domainGroups,
    embeddedAssets,
  };
}

function buildPartialChunks(source: any, objects: SelectedObjects): any[] {
  const sourceChunkExtensions = new Map(
    source.chunks.map((chunk: any) => [
      `${chunk.chunkRow}:${chunk.chunkColumn}`,
      structuredClone(chunk.extensions),
    ]),
  );
  const chunks = new Map<string, any>();
  const ensureChunk = (cellId: string): any => {
    const coordinate = parseCellId(cellId);
    const chunkRow = Math.floor(coordinate.row / 64);
    const chunkColumn = Math.floor(coordinate.column / 64);
    const key = `${chunkRow}:${chunkColumn}`;
    const existing = chunks.get(key);
    if (existing !== undefined) return existing;
    const chunk = {
      chunkRow,
      chunkColumn,
      cellOverrides: [],
      ownedEdgeIds: [],
      ownedOverlayIds: [],
      ownedDomainGroupIds: [],
      extensions: sourceChunkExtensions.get(key) ?? {},
    };
    chunks.set(key, chunk);
    return chunk;
  };
  for (const cell of objects.cellOverrides) {
    ensureChunk(cell.cellId).cellOverrides.push(cell);
  }
  const edgeById = new Map(objects.edges.map((edge) => [edge.edgeId, edge]));
  for (const edge of objects.edges) {
    ensureChunk(edge.adjacentCellIds[0]).ownedEdgeIds.push(edge.edgeId);
  }
  for (const overlay of objects.overlays) {
    if (overlay.kind !== "anchored-overlay") continue;
    const ownerCellId =
      overlay.anchor.kind === "cell"
        ? overlay.anchor.cellId
        : edgeById.get(overlay.anchor.edgeId)?.adjacentCellIds[0];
    if (ownerCellId === undefined) {
      throw new ProjectFormatError("export-overlay-owner-missing", {
        overlayId: overlay.overlayId,
      });
    }
    ensureChunk(ownerCellId).ownedOverlayIds.push(overlay.overlayId);
  }
  for (const group of objects.domainGroups) {
    const owner = resolveDomainGroupLayout(
      source.grid as ProjectGrid,
      group.memberCellIds,
      group.extensions,
    ).anchorCellId;
    ensureChunk(owner).ownedDomainGroupIds.push(group.groupId);
  }
  for (const chunk of chunks.values()) {
    chunk.cellOverrides.sort((left: any, right: any) =>
      compareCellId(left.cellId, right.cellId),
    );
    chunk.ownedEdgeIds.sort(compareStableId);
    chunk.ownedOverlayIds.sort(compareStableId);
    chunk.ownedDomainGroupIds.sort(compareStableId);
  }
  return [...chunks.values()].sort(
    (left, right) =>
      left.chunkRow - right.chunkRow || left.chunkColumn - right.chunkColumn,
  );
}

function normalizedSelection(
  source: ProjectV1Document,
  selection: ExportClosureSelection,
): ExportClosureSelection {
  if (
    selection.bounds.minX > selection.bounds.maxX ||
    selection.bounds.minY > selection.bounds.maxY
  ) {
    throw new ProjectFormatError("export-selection-bounds-invalid");
  }
  const knownLayers = new Set(
    (source.layerStates as any[]).map((layer) => layer.layerId as string),
  );
  const includedLayerIds = [...new Set(selection.includedLayerIds)].sort(
    compareStableId,
  );
  if (
    includedLayerIds.length === 0 ||
    includedLayerIds.some((layerId) => !knownLayers.has(layerId))
  ) {
    throw new ProjectFormatError("export-selection-layer-invalid");
  }
  return { bounds: { ...selection.bounds }, includedLayerIds };
}

export function createPartialProjectV1(
  source: ProjectV1Document,
  requestedSelection: ExportClosureSelection,
): ProjectV1Document {
  validateProjectDocumentV1(source);
  const selection = normalizedSelection(source, requestedSelection);
  const objects = selectObjects(source, selection);
  const sourceRecord = source as any;
  const includedLayerIds = [...selection.includedLayerIds];
  const included = new Set(includedLayerIds);
  const omittedLayerIds = (sourceRecord.layerStates as any[])
    .map((layer) => layer.layerId as string)
    .filter((layerId) => !included.has(layerId))
    .sort(compareStableId);
  const partial: any = {
    ...structuredClone(sourceRecord),
    exportScope: "partial",
    isComplete: false,
    lineage: {
      sourceProjectId: source.lineage?.sourceProjectId ?? source.projectId,
      originScope: source.lineage?.originScope ?? source.exportScope,
      selectionBounds: { ...selection.bounds },
      includedLayerIds,
      omittedLayerIds,
      extensions: {},
    },
    contentBounds: null,
    chunks: buildPartialChunks(sourceRecord, objects),
    managers: {
      edgeManager: {
        formatVersion: "1",
        edges: objects.edges,
        extensions: structuredClone(
          sourceRecord.managers.edgeManager.extensions,
        ),
      },
      connectionManager: {
        formatVersion: "1",
        connections: objects.connections,
        extensions: structuredClone(
          sourceRecord.managers.connectionManager.extensions,
        ),
      },
      overlayManager: {
        formatVersion: "1",
        overlays: objects.overlays,
        extensions: structuredClone(
          sourceRecord.managers.overlayManager.extensions,
        ),
      },
    },
    domainGroups: objects.domainGroups,
    embeddedAssets: objects.embeddedAssets,
    viewState: null,
  };
  partial.contentBounds = computeProjectContentBounds(partial);
  validateProjectDocumentV1(partial);
  return partial;
}

export interface FragmentCreationOptions extends ExportClosureSelection {
  readonly fragmentId: string;
  readonly createdWithAppVersion?: string;
}

export function createFragmentV1(
  source: ProjectV1Document,
  options: FragmentCreationOptions,
): FragmentV1Document {
  validateProjectDocumentV1(source);
  const selection = normalizedSelection(source, options);
  const objects = selectObjects(source, selection);
  const sourceRecord = source as any;
  const usedLayerIds = new Set<string>();
  const recordLayer = (value: any): void => {
    if (typeof value.layerId === "string") usedLayerIds.add(value.layerId);
    for (const instance of value.layerInstances ?? []) {
      if (selection.includedLayerIds.includes(instance.layerId)) {
        usedLayerIds.add(instance.layerId);
      }
    }
  };
  for (const value of [
    ...objects.cellOverrides,
    ...objects.edges,
    ...objects.connections,
    ...objects.overlays,
    ...objects.domainGroups,
  ]) {
    recordLayer(value);
  }
  const fragment: any = {
    kind: "tessera-fragment",
    formatVersion: "1",
    createdWithAppVersion:
      options.createdWithAppVersion ?? source.createdWithAppVersion,
    fragmentId: options.fragmentId,
    sourceProjectId: source.projectId,
    sourceGrid: {
      type: source.grid.type,
      orientation: source.grid.orientation,
      width: source.grid.width,
      height: source.grid.height,
      cellSize: source.grid.cellSize,
      coordinateEncoding: source.grid.coordinateEncoding,
      extensions: structuredClone(source.grid.extensions),
    },
    fragmentBounds: { ...selection.bounds },
    requiredModules: [],
    requiredLayerIds: [...usedLayerIds].sort(compareStableId),
    objects: {
      cellOverrides: objects.cellOverrides,
      edges: objects.edges,
      connections: objects.connections,
      overlays: objects.overlays,
      domainGroups: objects.domainGroups,
      embeddedAssets: objects.embeddedAssets,
      extensions: {},
    },
    extensions: {},
  };
  const usedModuleIds = new Set<string>();
  for (const value of [
    ...objects.cellOverrides.flatMap((cell) => cell.layerInstances),
    ...objects.edges.flatMap((edge) => edge.layerInstances),
    ...objects.connections,
    ...objects.overlays,
    ...objects.domainGroups,
  ]) {
    const separator = value.elementId.indexOf(":");
    if (separator > 0) usedModuleIds.add(value.elementId.slice(0, separator));
  }
  fragment.requiredModules = [...usedModuleIds]
    .sort(compareStableId)
    .map((moduleId) => {
      const sourceModule = (sourceRecord.modules as any[]).find(
        (module) => module.moduleId === moduleId,
      );
      if (sourceModule === undefined) {
        throw new ProjectFormatError("export-module-reference-missing", {
          moduleId,
        });
      }
      return {
        moduleId,
        version: sourceModule.version,
        extensions: structuredClone(sourceModule.extensions),
      };
    });
  if (fragment.requiredModules.length === 0) {
    throw new ProjectFormatError("export-selection-empty");
  }
  validateFragmentDocumentV1(fragment);
  return fragment;
}

/** 从当前可编辑 basic 事实与 opaque baseline 调和后的工程生成 partial。 */
export function createPartialProjectFromStateV1(
  state: Readonly<ProjectState>,
  selection: ExportClosureSelection,
): ProjectV1Document {
  return createPartialProjectV1(
    toProjectV1(state, { mode: "preserve" }),
    selection,
  );
}

/** 从当前可编辑 basic 事实与 opaque baseline 调和后的工程生成 Fragment。 */
export function createFragmentFromStateV1(
  state: Readonly<ProjectState>,
  options: FragmentCreationOptions,
): FragmentV1Document {
  return createFragmentV1(toProjectV1(state, { mode: "preserve" }), options);
}
