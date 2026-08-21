import {
  cellPolygon,
  ConnectionManager,
  EdgeManager,
  OverlayManager,
  SparseChunkStore,
  createFixedLayerMap,
  type CellOverride,
  type ConnectionData,
  type EdgeOverride,
  type OverlayData,
  type ProjectState,
} from "@tessera/core";
import type { ErrorObject } from "ajv";
import validateProject from "./project-validator.generated.js";

const projectValidator = validateProject as typeof validateProject & {
  errors?: ErrorObject[] | null;
};

const BASIC_VERSION = "1.0.0";
const layerStates = [
  ["tessera.basic.cell-style", 500],
  ["tessera.basic.edge-style", 1500],
  ["tessera.basic.placed-object", 3000],
  ["tessera.basic.connection", 4300],
  ["tessera.basic.annotation", 4400],
] as const;

export class ProjectFormatError extends Error {
  constructor(
    readonly code: string,
    readonly details: Readonly<Record<string, unknown>> = {},
    readonly issues: readonly ErrorObject[] = [],
  ) {
    super(code);
    this.name = "ProjectFormatError";
  }
}

interface ChunkRecord {
  chunkRow: number;
  chunkColumn: number;
  cellOverrides: unknown[];
  ownedEdgeIds: string[];
  ownedOverlayIds: string[];
  ownedDomainGroupIds: string[];
  extensions: Record<string, never>;
}

function chunkKey(row: number, column: number): string {
  return `${Math.floor(row / 64)}:${Math.floor(column / 64)}`;
}

function parseCellId(id: string): { row: number; column: number } {
  const parts = id.split(":");
  const row = Number(parts.at(-2));
  const column = Number(parts.at(-1));
  if (!Number.isInteger(row) || !Number.isInteger(column))
    throw new ProjectFormatError("cell-id-invalid", { cellId: id });
  return { row, column };
}

function serializeEndpoint(
  endpoint: ConnectionData["start"],
): Record<string, unknown> {
  if (endpoint.kind === "cell-center") {
    return { kind: endpoint.kind, cellId: endpoint.cellId, extensions: {} };
  }
  if (endpoint.kind === "edge-midpoint") {
    return { kind: endpoint.kind, edgeId: endpoint.edgeId, extensions: {} };
  }
  return {
    kind: endpoint.kind,
    point: { ...endpoint.point },
    extensions: {},
  };
}

function serializeConnection(
  connection: ConnectionData,
): Record<string, unknown> {
  const base = {
    kind: connection.kind,
    connectionId: connection.connectionId,
    elementId: connection.elementId,
    layerId: connection.layerId,
    start: serializeEndpoint(connection.start),
    end: serializeEndpoint(connection.end),
    styleOverrides: { ...connection.style },
    attributes: {},
    label: connection.label,
    extensions: {},
  };
  return connection.kind === "arrow"
    ? {
        ...base,
        arrowStart: connection.arrowStart,
        arrowEnd: connection.arrowEnd,
      }
    : base;
}

function serializeOverlay(overlay: OverlayData): Record<string, unknown> {
  const base = {
    kind: overlay.kind,
    overlayId: overlay.overlayId,
    elementId: overlay.elementId,
    layerId: overlay.layerId,
    overlayType: overlay.overlayType,
    styleOverrides: { ...overlay.style },
    attributes: overlay.overlayType === "text" ? { text: overlay.text } : {},
    orderInLayer: overlay.orderInLayer,
    extensions: {},
  };
  if (overlay.kind === "free-overlay") {
    return { ...base, point: { ...overlay.point } };
  }
  return {
    ...base,
    anchor:
      overlay.anchor.kind === "cell"
        ? { kind: "cell", cellId: overlay.anchor.cellId, extensions: {} }
        : { kind: "edge", edgeId: overlay.anchor.edgeId, extensions: {} },
  };
}

function parseEndpoint(endpoint: any): ConnectionData["start"] {
  if (endpoint.kind === "cell-center") {
    return { kind: endpoint.kind, cellId: endpoint.cellId };
  }
  if (endpoint.kind === "edge-midpoint") {
    return { kind: endpoint.kind, edgeId: endpoint.edgeId };
  }
  return { kind: "map-point", point: { ...endpoint.point } };
}

function parseConnection(connection: any): ConnectionData {
  const base = {
    connectionId: connection.connectionId,
    layerId: "tessera.basic.connection" as const,
    start: parseEndpoint(connection.start),
    end: parseEndpoint(connection.end),
    style: { ...connection.styleOverrides },
    label: connection.label,
  };
  return connection.kind === "arrow"
    ? {
        ...base,
        kind: "arrow",
        elementId: "tessera.basic:connection.arrow",
        arrowStart: connection.arrowStart,
        arrowEnd: connection.arrowEnd,
      }
    : {
        ...base,
        kind: "line",
        elementId: "tessera.basic:connection.line",
      };
}

function parseOverlay(overlay: any): OverlayData {
  const common = {
    overlayId: overlay.overlayId,
    layerId: overlay.layerId,
    orderInLayer: overlay.orderInLayer,
  };
  const location =
    overlay.kind === "free-overlay"
      ? { kind: "free-overlay" as const, point: { ...overlay.point } }
      : {
          kind: "anchored-overlay" as const,
          anchor:
            overlay.anchor.kind === "cell"
              ? { kind: "cell" as const, cellId: overlay.anchor.cellId }
              : { kind: "edge" as const, edgeId: overlay.anchor.edgeId },
        };
  if (overlay.overlayType === "text") {
    return {
      ...common,
      ...location,
      elementId: "tessera.basic:text",
      overlayType: "text",
      style: { ...overlay.styleOverrides },
      text: overlay.attributes.text,
    } as OverlayData;
  }
  return {
    ...common,
    ...location,
    elementId: "tessera.basic:marker",
    overlayType: "marker",
    style: { ...overlay.styleOverrides },
    text: null,
  } as OverlayData;
}

function validateSemanticClosure(project: Record<string, any>): void {
  if (
    (project.grid.type === "square" &&
      project.grid.orientation !== "axis-aligned") ||
    (project.grid.type === "hex-pointy" &&
      project.grid.orientation !== "pointy")
  ) {
    throw new ProjectFormatError("grid-orientation-mismatch");
  }
  if (
    project.modules.length !== 1 ||
    project.modules[0]?.moduleId !== "tessera.basic" ||
    project.modules[0]?.version !== BASIC_VERSION ||
    project.modules[0]?.packageSourceKind !== "built-in"
  ) {
    throw new ProjectFormatError("basic-module-contract-invalid", {
      requiredModuleId: "tessera.basic",
      requiredVersion: BASIC_VERSION,
    });
  }
  if (
    project.layerStates.length !== layerStates.length ||
    project.layerStates.some(
      (layer: any, index: number) =>
        layerStates[index]?.[0] !== layer.layerId ||
        layerStates[index]?.[1] !== layer.zIndex ||
        layer.moduleVersion !== BASIC_VERSION,
    )
  ) {
    throw new ProjectFormatError("basic-layer-contract-invalid");
  }
  const ownedEdges = new Set<string>();
  const ownedOverlays = new Set<string>();
  const cellIds = new Set<string>();
  const chunkKeys = new Set<string>();
  for (const chunk of project.chunks as any[]) {
    const key = `${String(chunk.chunkRow)}:${String(chunk.chunkColumn)}`;
    if (chunkKeys.has(key))
      throw new ProjectFormatError("chunk-duplicate", { chunkKey: key });
    chunkKeys.add(key);
    for (const cell of chunk.cellOverrides as any[]) {
      const coordinate = parseCellId(cell.cellId);
      if (
        coordinate.row >= project.grid.height ||
        coordinate.column >= project.grid.width ||
        !cell.cellId.startsWith(`cell:${project.grid.type}:`)
      )
        throw new ProjectFormatError("cell-out-of-bounds", {
          cellId: cell.cellId,
        });
      if (
        Math.floor(coordinate.row / 64) !== chunk.chunkRow ||
        Math.floor(coordinate.column / 64) !== chunk.chunkColumn ||
        cellIds.has(cell.cellId)
      )
        throw new ProjectFormatError("cell-chunk-ownership-conflict", {
          cellId: cell.cellId,
        });
      cellIds.add(cell.cellId);
    }
    for (const edgeId of chunk.ownedEdgeIds as string[]) {
      if (ownedEdges.has(edgeId))
        throw new ProjectFormatError("edge-owned-by-multiple-chunks", {
          edgeId,
        });
      ownedEdges.add(edgeId);
    }
    for (const overlayId of chunk.ownedOverlayIds as string[]) {
      if (ownedOverlays.has(overlayId)) {
        throw new ProjectFormatError("overlay-owned-by-multiple-chunks", {
          overlayId,
        });
      }
      ownedOverlays.add(overlayId);
    }
  }
  const edgeIds = new Set<string>();
  for (const edge of project.managers.edgeManager.edges as any[]) {
    if (edgeIds.has(edge.edgeId) || !ownedEdges.has(edge.edgeId))
      throw new ProjectFormatError("edge-reference-closure-invalid", {
        edgeId: edge.edgeId,
      });
    edgeIds.add(edge.edgeId);
    for (const id of edge.adjacentCellIds as string[]) {
      const coordinate = parseCellId(id);
      if (
        !id.startsWith(`cell:${project.grid.type}:`) ||
        coordinate.row >= project.grid.height ||
        coordinate.column >= project.grid.width
      )
        throw new ProjectFormatError("edge-adjacent-cell-out-of-bounds", {
          cellId: id,
        });
    }
  }
  if (edgeIds.size !== ownedEdges.size)
    throw new ProjectFormatError("chunk-edge-reference-missing");

  const overlayIds = new Set<string>();
  const anchoredOverlayIds = new Set<string>();
  for (const overlay of project.managers.overlayManager.overlays as any[]) {
    if (overlayIds.has(overlay.overlayId)) {
      throw new ProjectFormatError("overlay-duplicate", {
        overlayId: overlay.overlayId,
      });
    }
    overlayIds.add(overlay.overlayId);
    if (overlay.kind !== "anchored-overlay") continue;
    anchoredOverlayIds.add(overlay.overlayId);
    if (overlay.anchor.kind === "cell") {
      const coordinate = parseCellId(overlay.anchor.cellId);
      if (
        !overlay.anchor.cellId.startsWith(`cell:${project.grid.type}:`) ||
        coordinate.row >= project.grid.height ||
        coordinate.column >= project.grid.width
      ) {
        throw new ProjectFormatError("overlay-cell-anchor-out-of-bounds", {
          overlayId: overlay.overlayId,
        });
      }
    } else if (!edgeIds.has(overlay.anchor.edgeId)) {
      throw new ProjectFormatError("overlay-edge-reference-missing", {
        overlayId: overlay.overlayId,
      });
    }
  }
  if (
    anchoredOverlayIds.size !== ownedOverlays.size ||
    [...anchoredOverlayIds].some((overlayId) => !ownedOverlays.has(overlayId))
  ) {
    throw new ProjectFormatError("overlay-owner-closure-invalid");
  }

  const connectionIds = new Set<string>();
  for (const connection of project.managers.connectionManager
    .connections as any[]) {
    if (connectionIds.has(connection.connectionId)) {
      throw new ProjectFormatError("connection-duplicate", {
        connectionId: connection.connectionId,
      });
    }
    connectionIds.add(connection.connectionId);
    for (const endpoint of [connection.start, connection.end]) {
      if (endpoint.kind === "cell-center") {
        const coordinate = parseCellId(endpoint.cellId);
        if (
          !endpoint.cellId.startsWith(`cell:${project.grid.type}:`) ||
          coordinate.row >= project.grid.height ||
          coordinate.column >= project.grid.width
        ) {
          throw new ProjectFormatError(
            "connection-cell-endpoint-out-of-bounds",
            { connectionId: connection.connectionId },
          );
        }
      } else if (
        endpoint.kind === "edge-midpoint" &&
        !edgeIds.has(endpoint.edgeId)
      ) {
        throw new ProjectFormatError("connection-edge-reference-missing", {
          connectionId: connection.connectionId,
        });
      }
    }
  }
}

function boundsFor(
  state: Readonly<ProjectState>,
): Record<string, number> | null {
  const points = [...state.cells.values()].flatMap((cell) =>
    cellPolygon(state.grid, cell.row, cell.column),
  );
  for (const edge of state.edges.values()) {
    for (const id of edge.adjacentCellIds) {
      const coordinate = parseCellId(id);
      points.push(
        ...cellPolygon(state.grid, coordinate.row, coordinate.column),
      );
    }
  }
  if (points.length === 0) return null;
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

export function toProjectV1(
  state: Readonly<ProjectState>,
): Record<string, unknown> {
  const chunks = new Map<string, ChunkRecord>();
  const ensureChunk = (row: number, column: number): ChunkRecord => {
    const key = chunkKey(row, column);
    const existing = chunks.get(key);
    if (existing !== undefined) return existing;
    const created: ChunkRecord = {
      chunkRow: Math.floor(row / 64),
      chunkColumn: Math.floor(column / 64),
      cellOverrides: [],
      ownedEdgeIds: [],
      ownedOverlayIds: [],
      ownedDomainGroupIds: [],
      extensions: {},
    };
    chunks.set(key, created);
    return created;
  };

  for (const cell of [...state.cells.values()].sort(
    (a, b) => a.row - b.row || a.column - b.column,
  )) {
    ensureChunk(cell.row, cell.column).cellOverrides.push({
      cellId: cell.cellId,
      layerInstances: [
        {
          instanceId: cell.instanceId,
          elementId: "tessera.basic:cell.color",
          layerId: "tessera.basic.cell-style",
          styleOverrides: { fillColor: cell.fillColor, fillOpacity: 1 },
          attributes: {},
          extensions: {},
        },
      ],
      extensions: {},
    });
  }
  for (const edge of [...state.edges.values()].sort((a, b) =>
    a.edgeId.localeCompare(b.edgeId),
  )) {
    const owner = parseCellId(edge.adjacentCellIds[0] ?? "");
    ensureChunk(owner.row, owner.column).ownedEdgeIds.push(edge.edgeId);
  }
  for (const bucket of state.cells.buckets()) {
    const chunk = ensureChunk(bucket.chunkRow * 64, bucket.chunkColumn * 64);
    for (const overlayId of bucket.ownedOverlayIds) {
      if (!chunk.ownedOverlayIds.includes(overlayId)) {
        chunk.ownedOverlayIds.push(overlayId);
      }
    }
  }

  const serializedChunks = [...chunks.values()].sort(
    (a, b) => a.chunkRow - b.chunkRow || a.chunkColumn - b.chunkColumn,
  );
  return {
    kind: "tessera-project",
    formatVersion: "1",
    createdWithAppVersion: "0.1.0",
    projectId: state.projectId,
    name: state.name,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    exportScope: "full",
    isComplete: true,
    lineage: null,
    grid: {
      type: state.grid.type,
      orientation: state.grid.type === "square" ? "axis-aligned" : "pointy",
      width: state.grid.width,
      height: state.grid.height,
      cellSize: state.grid.cellSize,
      coordinateEncoding: "row-column-zero-based",
      chunkSizeCells: 64,
      extensions: {},
    },
    modules: [
      {
        moduleId: "tessera.basic",
        version: BASIC_VERSION,
        packageSourceKind: "built-in",
        extensions: {},
      },
    ],
    layerStates: layerStates.map(([layerId, zIndex]) => ({
      layerId,
      moduleVersion: BASIC_VERSION,
      zIndex,
      visible: true,
      locked: false,
      opacity: 1,
      extensions: {},
    })),
    mapStyle: {
      canvasBackground: state.style.canvasBackground,
      gridLineStyle: {
        strokeColor: state.style.gridColor,
        strokeOpacity: state.style.gridOpacity,
        strokeWidth: state.style.gridWidth,
      },
      defaultCellStyle: {
        fillColor: state.style.defaultCellColor,
        fillOpacity: 1,
      },
      defaultEdgeStyle: {
        strokeColor: state.style.defaultEdgeColor,
        strokeOpacity: 1,
        strokeWidth: state.style.gridWidth,
        lineCap: "round",
      },
      extensions: {},
    },
    contentBounds: boundsFor(state),
    chunks: serializedChunks,
    managers: {
      edgeManager: {
        formatVersion: "1",
        edges: [...state.edges.values()]
          .sort((a, b) => a.edgeId.localeCompare(b.edgeId))
          .map((edge) => ({
            kind: "edge",
            edgeId: edge.edgeId,
            adjacentCellIds: [...edge.adjacentCellIds],
            layerInstances: [
              {
                instanceId: edge.instanceId,
                elementId: "tessera.basic:edge.style",
                layerId: "tessera.basic.edge-style",
                styleOverrides: {
                  strokeColor: edge.strokeColor,
                  strokeOpacity: edge.strokeOpacity,
                  strokeWidth: edge.strokeWidth,
                  lineCap: "round",
                  lineStyle: edge.lineStyle,
                },
                attributes: { persistence: edge.persistence },
                extensions: {},
              },
            ],
            extensions: {},
          })),
        extensions: {},
      },
      connectionManager: {
        formatVersion: "1",
        connections: [...state.connections.values()]
          .sort((a, b) => a.connectionId.localeCompare(b.connectionId))
          .map(serializeConnection),
        extensions: {},
      },
      overlayManager: {
        formatVersion: "1",
        overlays: [...state.overlays.values()]
          .sort((a, b) => a.overlayId.localeCompare(b.overlayId))
          .map(serializeOverlay),
        extensions: {},
      },
    },
    domainGroups: [],
    embeddedAssets: [],
    viewState: null,
    extensions: {},
  };
}

export function stringifyProjectV1(state: Readonly<ProjectState>): string {
  return `${JSON.stringify(toProjectV1(state), null, 2)}\n`;
}

export function parseProjectV1(text: string): ProjectState {
  if (new TextEncoder().encode(text).byteLength > 512 * 1024 * 1024)
    throw new ProjectFormatError("project-size-limit-exceeded", {
      maxBytes: 512 * 1024 * 1024,
    });
  if (text.charCodeAt(0) === 0xfeff)
    throw new ProjectFormatError("project-bom-not-allowed");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectFormatError("project-json-invalid");
  }
  if (!projectValidator(raw))
    throw new ProjectFormatError(
      "project-schema-invalid",
      {},
      projectValidator.errors ?? [],
    );
  const project = raw as Record<string, any>;
  validateSemanticClosure(project);
  const cells = new Map<string, CellOverride>();
  for (const chunk of project.chunks as any[]) {
    for (const cell of chunk.cellOverrides as any[]) {
      const instance = cell.layerInstances.find(
        (item: any) => item.layerId === "tessera.basic.cell-style",
      );
      if (instance !== undefined) {
        const coordinate = parseCellId(cell.cellId as string);
        cells.set(cell.cellId as string, {
          instanceId: instance.instanceId,
          cellId: cell.cellId,
          ...coordinate,
          fillColor: instance.styleOverrides.fillColor,
          fillOpacity: instance.styleOverrides.fillOpacity,
        });
      }
    }
  }
  const edgeValues: EdgeOverride[] = [];
  for (const edge of project.managers.edgeManager.edges as any[]) {
    const instance = edge.layerInstances.find(
      (item: any) => item.layerId === "tessera.basic.edge-style",
    );
    if (instance !== undefined)
      edgeValues.push({
        instanceId: instance.instanceId,
        edgeId: edge.edgeId,
        adjacentCellIds: edge.adjacentCellIds,
        strokeColor: instance.styleOverrides.strokeColor,
        strokeWidth: instance.styleOverrides.strokeWidth,
        strokeOpacity: instance.styleOverrides.strokeOpacity,
        lineStyle: instance.styleOverrides.lineStyle ?? "solid",
        persistence: instance.attributes.persistence ?? "explicit-style",
      });
  }
  const cellStore = new SparseChunkStore(cells.values());
  for (const chunk of project.chunks as any[]) {
    for (const edgeId of chunk.ownedEdgeIds as string[]) {
      const edge = project.managers.edgeManager.edges.find(
        (candidate: any) => candidate.edgeId === edgeId,
      );
      const ownerCellId = edge?.adjacentCellIds?.[0];
      if (typeof ownerCellId === "string")
        cellStore.assignEdge(edgeId, ownerCellId);
    }
    for (const overlayId of chunk.ownedOverlayIds as string[]) {
      const overlay = project.managers.overlayManager.overlays.find(
        (candidate: any) => candidate.overlayId === overlayId,
      );
      if (
        overlay?.kind === "anchored-overlay" &&
        overlay.anchor?.kind === "cell"
      ) {
        cellStore.assignOverlay(overlayId, overlay.anchor.cellId);
      } else if (
        overlay?.kind === "anchored-overlay" &&
        overlay.anchor?.kind === "edge"
      ) {
        const edge = project.managers.edgeManager.edges.find(
          (candidate: any) => candidate.edgeId === overlay.anchor.edgeId,
        );
        const ownerCellId = edge?.adjacentCellIds?.[0];
        if (typeof ownerCellId === "string") {
          cellStore.assignOverlay(overlayId, ownerCellId);
        }
      }
    }
  }
  const layers = createFixedLayerMap() as Map<string, any>;
  for (const layer of project.layerStates as any[]) {
    const current = layers.get(layer.layerId);
    if (current !== undefined) {
      layers.set(layer.layerId, {
        ...current,
        visible: layer.visible,
        locked: layer.locked,
        opacity: layer.opacity,
      });
    }
  }
  return {
    projectId: project.projectId,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    grid: {
      type: project.grid.type,
      width: project.grid.width,
      height: project.grid.height,
      cellSize: project.grid.cellSize,
    },
    style: {
      canvasBackground: project.mapStyle.canvasBackground,
      defaultCellColor: project.mapStyle.defaultCellStyle.fillColor,
      gridColor: project.mapStyle.gridLineStyle.strokeColor,
      gridOpacity: project.mapStyle.gridLineStyle.strokeOpacity,
      gridWidth: project.mapStyle.gridLineStyle.strokeWidth,
      defaultEdgeColor: project.mapStyle.defaultEdgeStyle.strokeColor,
    },
    cells: cellStore,
    edges: new EdgeManager(edgeValues),
    connections: new ConnectionManager(
      project.managers.connectionManager.connections.map(parseConnection),
    ),
    overlays: new OverlayManager(
      project.managers.overlayManager.overlays.map(parseOverlay),
    ),
    layers,
    revision: 0,
    lastTransactionId: null,
  };
}
