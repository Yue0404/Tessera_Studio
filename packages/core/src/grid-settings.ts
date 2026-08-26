import { parseCellId } from "./coordinates.js";
import { cellPolygon, mapPointToCell } from "./geometry.js";
import type { ModuleRuntimeInstance } from "./module-instance-store.js";
import type {
  ConnectionEndpoint,
  MapPoint,
  ProjectGrid,
  ProjectState,
} from "./types.js";

export const MAP_DIMENSION_MIN = 1;
export const MAP_DIMENSION_MAX = 40_000;
export const MAP_CELL_SIZE_MIN = 12;
export const MAP_CELL_SIZE_MAX = 96;

export interface GridSettingsInput {
  readonly width: number;
  readonly height: number;
  readonly cellSize: number;
}

export type GridContentKind =
  | "basic-cell"
  | "basic-edge"
  | "basic-overlay"
  | "basic-connection"
  | "module-cell"
  | "module-edge"
  | "module-overlay"
  | "module-connection"
  | "module-domain-group";

export type GridSettingsUpdateResult =
  | {
      readonly status: "updated" | "unchanged";
      readonly grid: Readonly<ProjectGrid>;
    }
  | {
      readonly status: "rejected";
      readonly code:
        | "grid-width-invalid"
        | "grid-height-invalid"
        | "grid-cell-size-invalid"
        | "grid-content-out-of-bounds";
      readonly field?: "width" | "height" | "cellSize";
      readonly minimum?: number;
      readonly maximum?: number;
      readonly actual?: number;
      readonly objectKind?: GridContentKind;
      readonly objectId?: string;
      readonly reference?: string;
    };

function invalidIntegerRange(
  value: number,
  minimum: number,
  maximum: number,
): boolean {
  return !Number.isInteger(value) || value < minimum || value > maximum;
}

function cellInsideGrid(grid: Readonly<ProjectGrid>, value: string): boolean {
  try {
    const coordinate = parseCellId(value);
    return (
      coordinate.gridType === grid.type &&
      coordinate.row >= 0 &&
      coordinate.column >= 0 &&
      coordinate.row < grid.height &&
      coordinate.column < grid.width
    );
  } catch {
    return false;
  }
}

function pointOnSegment(
  point: MapPoint,
  start: MapPoint,
  end: MapPoint,
): boolean {
  const cross =
    (point.x - start.x) * (end.y - start.y) -
    (point.y - start.y) * (end.x - start.x);
  const scale = Math.max(
    1,
    Math.abs(point.x),
    Math.abs(point.y),
    Math.abs(start.x),
    Math.abs(start.y),
    Math.abs(end.x),
    Math.abs(end.y),
  );
  const tolerance = Number.EPSILON * scale * 16;
  return (
    Math.abs(cross) <= tolerance * scale &&
    point.x >= Math.min(start.x, end.x) - tolerance &&
    point.x <= Math.max(start.x, end.x) + tolerance &&
    point.y >= Math.min(start.y, end.y) - tolerance &&
    point.y <= Math.max(start.y, end.y) + tolerance
  );
}

function pointInsideOrOnPolygon(
  point: MapPoint,
  polygon: readonly MapPoint[],
): boolean {
  let inside = false;
  for (
    let index = 0, previousIndex = polygon.length - 1;
    index < polygon.length;
    previousIndex = index, index += 1
  ) {
    const current = polygon[index];
    const previous = polygon[previousIndex];
    if (current === undefined || previous === undefined) continue;
    if (pointOnSegment(point, previous, current)) return true;
    const crossesRay =
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) /
          (previous.y - current.y) +
          current.x;
    if (crossesRay) inside = !inside;
  }
  return inside;
}

function mapPointInsideGrid(
  grid: Readonly<ProjectGrid>,
  point: Readonly<MapPoint>,
): boolean {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  const coordinate = mapPointToCell(grid, point);
  return (
    coordinate !== undefined &&
    pointInsideOrOnPolygon(
      point,
      cellPolygon(grid, coordinate.row, coordinate.column),
    )
  );
}

function contentRejection(
  objectKind: GridContentKind,
  objectId: string,
  reference: string,
): GridSettingsUpdateResult {
  return {
    status: "rejected",
    code: "grid-content-out-of-bounds",
    objectKind,
    objectId,
    reference,
  };
}

function endpointInsideGrid(
  state: Readonly<ProjectState>,
  grid: Readonly<ProjectGrid>,
  endpoint: ConnectionEndpoint,
): boolean {
  if (endpoint.kind === "cell-center")
    return cellInsideGrid(grid, endpoint.cellId);
  if (endpoint.kind === "map-point")
    return mapPointInsideGrid(grid, endpoint.point);
  const edge = state.edges.get(endpoint.edgeId);
  return (
    edge !== undefined &&
    edge.adjacentCellIds.every((cellId) => cellInsideGrid(grid, cellId))
  );
}

function moduleInstanceRejection(
  state: Readonly<ProjectState>,
  grid: Readonly<ProjectGrid>,
  instance: ModuleRuntimeInstance,
): GridSettingsUpdateResult | null {
  if (instance.kind === "cell")
    return cellInsideGrid(grid, instance.cellId)
      ? null
      : contentRejection("module-cell", instance.instanceId, instance.cellId);
  if (instance.kind === "edge") {
    const invalid = instance.adjacentCellIds.find(
      (cellId) => !cellInsideGrid(grid, cellId),
    );
    return invalid === undefined
      ? null
      : contentRejection("module-edge", instance.instanceId, invalid);
  }
  if (instance.kind === "overlay") {
    if (instance.objectKind === "free-overlay")
      return instance.point !== undefined &&
        mapPointInsideGrid(grid, instance.point)
        ? null
        : contentRejection("module-overlay", instance.instanceId, "map-point");
    if (instance.anchor?.kind === "cell")
      return cellInsideGrid(grid, instance.anchor.cellId)
        ? null
        : contentRejection(
            "module-overlay",
            instance.instanceId,
            instance.anchor.cellId,
          );
    const edgeId = instance.anchor?.edgeId;
    const edge = edgeId === undefined ? undefined : state.edges.get(edgeId);
    return edge !== undefined &&
      edge.adjacentCellIds.every((cellId) => cellInsideGrid(grid, cellId))
      ? null
      : contentRejection(
          "module-overlay",
          instance.instanceId,
          edgeId ?? "edge-anchor-missing",
        );
  }
  if (instance.kind === "connection") {
    const invalid = [instance.start, instance.end].find(
      (endpoint) => !endpointInsideGrid(state, grid, endpoint),
    );
    return invalid === undefined
      ? null
      : contentRejection(
          "module-connection",
          instance.instanceId,
          invalid.kind,
        );
  }
  const invalid = instance.memberCellIds.find(
    (cellId) => !cellInsideGrid(grid, cellId),
  );
  return invalid === undefined
    ? null
    : contentRejection("module-domain-group", instance.instanceId, invalid);
}

/** 只沿稀疏持久对象遍历；绝不按 width × height 枚举地图。 */
export function validateGridSettingsUpdate(
  state: Readonly<ProjectState>,
  input: GridSettingsInput,
): GridSettingsUpdateResult {
  for (const [field, value, minimum, maximum, code] of [
    [
      "width",
      input.width,
      MAP_DIMENSION_MIN,
      MAP_DIMENSION_MAX,
      "grid-width-invalid",
    ],
    [
      "height",
      input.height,
      MAP_DIMENSION_MIN,
      MAP_DIMENSION_MAX,
      "grid-height-invalid",
    ],
    [
      "cellSize",
      input.cellSize,
      MAP_CELL_SIZE_MIN,
      MAP_CELL_SIZE_MAX,
      "grid-cell-size-invalid",
    ],
  ] as const) {
    if (invalidIntegerRange(value, minimum, maximum)) {
      return {
        status: "rejected",
        code,
        field,
        minimum,
        maximum,
        actual: value,
      };
    }
  }
  const grid: ProjectGrid = { ...state.grid, ...input };

  for (const cell of state.cells.values()) {
    if (
      !cellInsideGrid(grid, cell.cellId) ||
      cell.row < 0 ||
      cell.column < 0 ||
      cell.row >= grid.height ||
      cell.column >= grid.width
    )
      return contentRejection("basic-cell", cell.instanceId, cell.cellId);
  }
  for (const edge of state.edges.values()) {
    const invalid = edge.adjacentCellIds.find(
      (cellId) => !cellInsideGrid(grid, cellId),
    );
    if (invalid !== undefined)
      return contentRejection("basic-edge", edge.instanceId, invalid);
  }
  for (const overlay of state.overlays.values()) {
    if (overlay.kind === "free-overlay") {
      if (!mapPointInsideGrid(grid, overlay.point))
        return contentRejection(
          "basic-overlay",
          overlay.overlayId,
          "map-point",
        );
    } else if (
      overlay.anchor.kind === "cell" &&
      !cellInsideGrid(grid, overlay.anchor.cellId)
    ) {
      return contentRejection(
        "basic-overlay",
        overlay.overlayId,
        overlay.anchor.cellId,
      );
    } else if (overlay.anchor.kind === "edge") {
      const edge = state.edges.get(overlay.anchor.edgeId);
      if (
        edge === undefined ||
        !edge.adjacentCellIds.every((cellId) => cellInsideGrid(grid, cellId))
      )
        return contentRejection(
          "basic-overlay",
          overlay.overlayId,
          overlay.anchor.edgeId,
        );
    }
  }
  for (const connection of state.connections.values()) {
    const invalid = [connection.start, connection.end].find(
      (endpoint) => !endpointInsideGrid(state, grid, endpoint),
    );
    if (invalid !== undefined)
      return contentRejection(
        "basic-connection",
        connection.connectionId,
        invalid.kind,
      );
  }
  for (const instance of state.moduleInstances.values()) {
    const rejection = moduleInstanceRejection(state, grid, instance);
    if (rejection !== null) return rejection;
  }
  return { status: "updated", grid };
}
