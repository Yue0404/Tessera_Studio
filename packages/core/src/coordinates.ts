import type {
  CellCoordinate,
  GridType,
  MapPoint,
  ProjectGrid,
} from "./types.js";

export const CHUNK_SIZE = 64;

export interface AxialCoordinate {
  q: number;
  r: number;
}

export interface ChunkCoordinate {
  chunkRow: number;
  chunkColumn: number;
}

export function assertGridCoordinate(
  grid: ProjectGrid,
  coordinate: CellCoordinate,
): void {
  if (
    !Number.isInteger(coordinate.row) ||
    !Number.isInteger(coordinate.column) ||
    coordinate.row < 0 ||
    coordinate.column < 0 ||
    coordinate.row >= grid.height ||
    coordinate.column >= grid.width
  ) {
    throw new RangeError("cell-coordinate-out-of-range");
  }
}

export function assertFiniteMapPoint(point: MapPoint): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new RangeError("map-point-not-finite");
  }
}

export function oddRToAxial(coordinate: CellCoordinate): AxialCoordinate {
  return {
    q: coordinate.column - (coordinate.row - (coordinate.row & 1)) / 2,
    r: coordinate.row,
  };
}

export function axialToOddR(coordinate: AxialCoordinate): CellCoordinate {
  if (!Number.isInteger(coordinate.q) || !Number.isInteger(coordinate.r)) {
    throw new RangeError("axial-coordinate-not-integer");
  }
  return {
    row: coordinate.r,
    column: coordinate.q + (coordinate.r - (coordinate.r & 1)) / 2,
  };
}

export function chunkCoordinateOf(coordinate: CellCoordinate): ChunkCoordinate {
  if (
    !Number.isInteger(coordinate.row) ||
    !Number.isInteger(coordinate.column) ||
    coordinate.row < 0 ||
    coordinate.column < 0
  ) {
    throw new RangeError("chunk-coordinate-source-invalid");
  }
  return {
    chunkRow: Math.floor(coordinate.row / CHUNK_SIZE),
    chunkColumn: Math.floor(coordinate.column / CHUNK_SIZE),
  };
}

export function chunkKeyOf(coordinate: ChunkCoordinate): string {
  return `${coordinate.chunkRow}:${coordinate.chunkColumn}`;
}

export function parseCellId(
  value: string,
): CellCoordinate & { gridType: GridType } {
  const match = /^cell:(square|hex-pointy):(0|[1-9]\d*):(0|[1-9]\d*)$/.exec(
    value,
  );
  if (match === null) throw new RangeError("cell-id-invalid");
  const [, gridType, rowText, columnText] = match;
  const row = Number(rowText);
  const column = Number(columnText);
  if (
    (gridType !== "square" && gridType !== "hex-pointy") ||
    !Number.isSafeInteger(row) ||
    !Number.isSafeInteger(column)
  ) {
    throw new RangeError("cell-id-invalid");
  }
  return { gridType, row, column };
}
