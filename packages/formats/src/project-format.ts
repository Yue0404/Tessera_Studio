import {
  cellPolygon,
  EdgeManager,
  type CellOverride,
  type EdgeOverride,
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
    message: string,
    readonly issues: readonly ErrorObject[] = [],
  ) {
    super(message);
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
    throw new ProjectFormatError(`非法 cellId: ${id}`);
  return { row, column };
}

function validateSemanticClosure(project: Record<string, any>): void {
  if (
    (project.grid.type === "square" &&
      project.grid.orientation !== "axis-aligned") ||
    (project.grid.type === "hex-pointy" &&
      project.grid.orientation !== "pointy")
  ) {
    throw new ProjectFormatError("网格类型与方向不一致");
  }
  if (
    project.modules.length !== 1 ||
    project.modules[0]?.moduleId !== "tessera.basic" ||
    project.modules[0]?.version !== BASIC_VERSION ||
    project.modules[0]?.packageSourceKind !== "built-in"
  ) {
    throw new ProjectFormatError("M0 工程必须精确依赖 tessera.basic@1.0.0");
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
    throw new ProjectFormatError("基础模块固定图层不完整或顺序属性不一致");
  }
  const ownedEdges = new Set<string>();
  const cellIds = new Set<string>();
  const chunkKeys = new Set<string>();
  for (const chunk of project.chunks as any[]) {
    const key = `${String(chunk.chunkRow)}:${String(chunk.chunkColumn)}`;
    if (chunkKeys.has(key)) throw new ProjectFormatError(`重复分块: ${key}`);
    chunkKeys.add(key);
    for (const cell of chunk.cellOverrides as any[]) {
      const coordinate = parseCellId(cell.cellId);
      if (
        coordinate.row >= project.grid.height ||
        coordinate.column >= project.grid.width ||
        !cell.cellId.startsWith(`cell:${project.grid.type}:`)
      )
        throw new ProjectFormatError(`地格超出工程范围: ${cell.cellId}`);
      if (
        Math.floor(coordinate.row / 64) !== chunk.chunkRow ||
        Math.floor(coordinate.column / 64) !== chunk.chunkColumn ||
        cellIds.has(cell.cellId)
      )
        throw new ProjectFormatError(`地格分块归属冲突: ${cell.cellId}`);
      cellIds.add(cell.cellId);
    }
    for (const edgeId of chunk.ownedEdgeIds as string[]) {
      if (ownedEdges.has(edgeId))
        throw new ProjectFormatError(`Edge 被多个分块拥有: ${edgeId}`);
      ownedEdges.add(edgeId);
    }
  }
  const edgeIds = new Set<string>();
  for (const edge of project.managers.edgeManager.edges as any[]) {
    if (edgeIds.has(edge.edgeId) || !ownedEdges.has(edge.edgeId))
      throw new ProjectFormatError(`Edge 引用闭包失败: ${edge.edgeId}`);
    edgeIds.add(edge.edgeId);
    for (const id of edge.adjacentCellIds as string[]) {
      const coordinate = parseCellId(id);
      if (
        !id.startsWith(`cell:${project.grid.type}:`) ||
        coordinate.row >= project.grid.height ||
        coordinate.column >= project.grid.width
      )
        throw new ProjectFormatError(`Edge 邻接地格超出范围: ${id}`);
    }
  }
  if (edgeIds.size !== ownedEdges.size)
    throw new ProjectFormatError("分块包含不存在的 Edge 引用");
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
                  strokeOpacity: 1,
                  strokeWidth: edge.strokeWidth,
                  lineCap: "round",
                },
                attributes: {},
                extensions: {},
              },
            ],
            extensions: {},
          })),
        extensions: {},
      },
      connectionManager: {
        formatVersion: "1",
        connections: [],
        extensions: {},
      },
      overlayManager: { formatVersion: "1", overlays: [], extensions: {} },
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
    throw new ProjectFormatError("工程文件超过 512 MiB");
  if (text.charCodeAt(0) === 0xfeff)
    throw new ProjectFormatError("工程文件不得包含 BOM");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectFormatError("工程 JSON 无法解析");
  }
  if (!projectValidator(raw))
    throw new ProjectFormatError(
      "工程不符合 Project Format v1",
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
      });
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
    cells,
    edges: new EdgeManager(edgeValues),
    revision: 0,
  };
}
