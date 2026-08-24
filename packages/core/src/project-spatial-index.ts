import { CHUNK_SIZE, parseCellId } from "./coordinates.js";
import { cellCenter, cellPolygon, edgeSegment } from "./geometry.js";
import type {
  ModuleConnectionInstance,
  ModuleDomainGroupInstance,
} from "./module-instance-store.js";
import type {
  ConnectionData,
  ConnectionEndpoint,
  OverlayData,
  Point,
  ProjectState,
} from "./types.js";
import type { MapRect } from "./viewport-clipping.js";

function edgeMidpoint(
  state: Readonly<ProjectState>,
  edgeId: string,
): Point | undefined {
  const edge = state.edges.get(edgeId);
  if (edge === undefined) return undefined;
  const segment = edgeSegment(state.grid, edge.edgeId, edge.adjacentCellIds);
  return segment === undefined
    ? undefined
    : {
        x: (segment[0].x + segment[1].x) / 2,
        y: (segment[0].y + segment[1].y) / 2,
      };
}

export function projectConnectionEndpointPoint(
  state: Readonly<ProjectState>,
  endpoint: ConnectionEndpoint,
): Point | undefined {
  if (endpoint.kind === "map-point") return endpoint.point;
  if (endpoint.kind === "edge-midpoint") {
    return edgeMidpoint(state, endpoint.edgeId);
  }
  const coordinate = parseCellId(endpoint.cellId);
  return cellCenter(state.grid, coordinate.row, coordinate.column);
}

export function projectOverlayAnchorPoint(
  state: Readonly<ProjectState>,
  overlay: OverlayData,
): Point | undefined {
  if (overlay.kind === "free-overlay") return overlay.point;
  if (overlay.anchor.kind === "edge") {
    return edgeMidpoint(state, overlay.anchor.edgeId);
  }
  const coordinate = parseCellId(overlay.anchor.cellId);
  return cellCenter(state.grid, coordinate.row, coordinate.column);
}

function pointBounds(point: Point, radius: number): MapRect {
  return {
    minX: point.x - radius,
    minY: point.y - radius,
    maxX: point.x + radius,
    maxY: point.y + radius,
  };
}

function overlayBounds(
  state: Readonly<ProjectState>,
  overlay: OverlayData,
): MapRect | undefined {
  const point = projectOverlayAnchorPoint(state, overlay);
  if (point === undefined) return undefined;
  if (overlay.overlayType === "marker") {
    return pointBounds(point, Math.max(1, overlay.style.size * 1.5));
  }
  const lines = overlay.text.split("\n");
  const width =
    Math.max(1, ...lines.map((line) => [...line].length)) *
    overlay.style.fontSize *
    0.75;
  const height = Math.max(1, lines.length) * overlay.style.fontSize * 1.25;
  const radians = (overlay.style.rotation * Math.PI) / 180;
  const radiusX =
    (Math.abs(Math.cos(radians)) * width +
      Math.abs(Math.sin(radians)) * height) /
    2;
  const radiusY =
    (Math.abs(Math.sin(radians)) * width +
      Math.abs(Math.cos(radians)) * height) /
    2;
  return {
    minX: point.x - radiusX,
    minY: point.y - radiusY,
    maxX: point.x + radiusX,
    maxY: point.y + radiusY,
  };
}

function connectionBounds(
  state: Readonly<ProjectState>,
  connection: ConnectionData,
): MapRect | undefined {
  const start = projectConnectionEndpointPoint(state, connection.start);
  const end = projectConnectionEndpointPoint(state, connection.end);
  if (start === undefined || end === undefined) return undefined;
  const arrowRadius =
    connection.kind === "arrow"
      ? Math.max(3 * connection.style.strokeWidth, 0.18 * state.grid.cellSize)
      : 0;
  const labelRadius =
    connection.label === null
      ? 0
      : Math.max(
          state.grid.cellSize * 0.35,
          [...connection.label].length * state.grid.cellSize * 0.14,
        );
  const radius = Math.max(
    connection.style.strokeWidth / 2,
    arrowRadius,
    labelRadius,
  );
  return {
    minX: Math.min(start.x, end.x) - radius,
    minY: Math.min(start.y, end.y) - radius,
    maxX: Math.max(start.x, end.x) + radius,
    maxY: Math.max(start.y, end.y) + radius,
  };
}

function moduleConnectionBounds(
  state: Readonly<ProjectState>,
  connection: ModuleConnectionInstance,
): MapRect | undefined {
  const start = projectConnectionEndpointPoint(state, connection.start);
  const end = projectConnectionEndpointPoint(state, connection.end);
  if (start === undefined || end === undefined) return undefined;
  return {
    minX: Math.min(start.x, end.x),
    minY: Math.min(start.y, end.y),
    maxX: Math.max(start.x, end.x),
    maxY: Math.max(start.y, end.y),
  };
}

function moduleDomainGroupBounds(
  state: Readonly<ProjectState>,
  group: ModuleDomainGroupInstance,
): MapRect | undefined {
  const points = group.memberCellIds.flatMap((cellId) => {
    const coordinate = parseCellId(cellId);
    return cellPolygon(state.grid, coordinate.row, coordinate.column);
  });
  if (points.length === 0) return undefined;
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

/** 工程构造或恢复后调用一次；后续 Manager 写操作会同步维护索引。 */
export function configureProjectSpatialIndexes(state: ProjectState): void {
  const bucketSize = Math.max(1, state.grid.cellSize * CHUNK_SIZE);
  state.connections.configureSpatialIndex(bucketSize, (connection) =>
    connectionBounds(state, connection),
  );
  state.overlays.configureSpatialIndex(bucketSize, (overlay) =>
    overlayBounds(state, overlay),
  );
  state.moduleInstances.configureConnectionSpatialIndex(
    bucketSize,
    (connection) => moduleConnectionBounds(state, connection),
  );
  state.moduleInstances.configureDomainGroupSpatialIndex(bucketSize, (group) =>
    moduleDomainGroupBounds(state, group),
  );
}
