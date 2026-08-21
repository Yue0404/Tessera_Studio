import type {
  CellCoordinate,
  GridType,
  Point,
  ProjectGrid,
  VisibleCell,
} from "./types.js";

const SQRT_3 = Math.sqrt(3);

export function cellId(type: GridType, row: number, column: number): string {
  return `cell:${type}:${row}:${column}`;
}

function compareCoordinate(a: CellCoordinate, b: CellCoordinate): number {
  return a.row - b.row || a.column - b.column;
}

export function cellCenter(
  grid: ProjectGrid,
  row: number,
  column: number,
): Point {
  if (grid.type === "square") {
    return {
      x: (column + 0.5) * grid.cellSize,
      y: (row + 0.5) * grid.cellSize,
    };
  }
  return {
    x: grid.cellSize * SQRT_3 * (column + 0.5 + 0.5 * (row & 1)),
    y: grid.cellSize * (1 + 1.5 * row),
  };
}

export function cellPolygon(
  grid: ProjectGrid,
  row: number,
  column: number,
): readonly Point[] {
  if (grid.type === "square") {
    const x = column * grid.cellSize;
    const y = row * grid.cellSize;
    return [
      { x, y },
      { x: x + grid.cellSize, y },
      { x: x + grid.cellSize, y: y + grid.cellSize },
      { x, y: y + grid.cellSize },
    ];
  }
  const center = cellCenter(grid, row, column);
  return Array.from({ length: 6 }, (_, index) => {
    const angle = ((-90 + index * 60) * Math.PI) / 180;
    return {
      x: center.x + grid.cellSize * Math.cos(angle),
      y: center.y + grid.cellSize * Math.sin(angle),
    };
  });
}

function roundAxial(q: number, r: number): { q: number; r: number } {
  let x = q;
  let z = r;
  const y = -x - z;
  let rx = Math.round(x);
  const ry = Math.round(y);
  let rz = Math.round(z);
  const xDiff = Math.abs(rx - x);
  const yDiff = Math.abs(ry - y);
  const zDiff = Math.abs(rz - z);
  if (xDiff > yDiff && xDiff > zDiff) rx = -ry - rz;
  else if (yDiff <= zDiff) rz = -rx - ry;
  x = rx;
  z = rz;
  return { q: x, r: z };
}

export function mapPointToCell(
  grid: ProjectGrid,
  point: Point,
): CellCoordinate | undefined {
  if (grid.type === "square") {
    const column = Math.floor(point.x / grid.cellSize);
    const row = Math.floor(point.y / grid.cellSize);
    return row >= 0 && column >= 0 && row < grid.height && column < grid.width
      ? { row, column }
      : undefined;
  }
  const localX = point.x - (SQRT_3 * grid.cellSize) / 2;
  const localY = point.y - grid.cellSize;
  const axial = roundAxial(
    ((SQRT_3 / 3) * localX - localY / 3) / grid.cellSize,
    ((2 / 3) * localY) / grid.cellSize,
  );
  const row = axial.r;
  const column = axial.q + (row - (row & 1)) / 2;
  return row >= 0 && column >= 0 && row < grid.height && column < grid.width
    ? { row, column }
    : undefined;
}

export function visibleCells(
  grid: ProjectGrid,
  viewportWidth: number,
  viewportHeight: number,
): VisibleCell[] {
  const rowStep = grid.type === "square" ? grid.cellSize : 1.5 * grid.cellSize;
  const columnStep =
    grid.type === "square" ? grid.cellSize : SQRT_3 * grid.cellSize;
  const rows = Math.min(grid.height, Math.ceil(viewportHeight / rowStep) + 2);
  const columns = Math.min(
    grid.width,
    Math.ceil(viewportWidth / columnStep) + 2,
  );
  const result: VisibleCell[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      result.push({
        row,
        column,
        cellId: cellId(grid.type, row, column),
        polygon: cellPolygon(grid, row, column),
        center: cellCenter(grid, row, column),
      });
    }
  }
  return result;
}

function containsPoint(polygon: readonly Point[], point: Point): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const current = polygon[i];
    const previous = polygon[j];
    if (current === undefined || previous === undefined) continue;
    const intersects =
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) /
          (previous.y - current.y) +
          current.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function hitTestCell(
  cells: readonly VisibleCell[],
  point: Point,
): VisibleCell | undefined {
  return cells.find((cell) => containsPoint(cell.polygon, point));
}

function squareNeighbor(
  row: number,
  column: number,
  side: number,
): CellCoordinate {
  const offsets = [
    { row: -1, column: 0 },
    { row: 0, column: 1 },
    { row: 1, column: 0 },
    { row: 0, column: -1 },
  ] as const;
  const offset = offsets[side] ?? offsets[0];
  return { row: row + offset.row, column: column + offset.column };
}

function hexNeighbor(
  row: number,
  column: number,
  side: number,
): CellCoordinate {
  const even = [
    { row: -1, column: 0 },
    { row: 0, column: 1 },
    { row: 1, column: 0 },
    { row: 1, column: -1 },
    { row: 0, column: -1 },
    { row: -1, column: -1 },
  ] as const;
  const odd = [
    { row: -1, column: 1 },
    { row: 0, column: 1 },
    { row: 1, column: 1 },
    { row: 1, column: 0 },
    { row: 0, column: -1 },
    { row: -1, column: 0 },
  ] as const;
  const offset = ((row & 1) === 0 ? even : odd)[side] ?? even[0];
  return { row: row + offset.row, column: column + offset.column };
}

const squareBoundarySides = ["top", "right", "bottom", "left"] as const;
const hexBoundarySides = [
  "upper-right",
  "right",
  "lower-right",
  "lower-left",
  "left",
  "upper-left",
] as const;

export function edgeIdentity(
  grid: ProjectGrid,
  cell: CellCoordinate,
  side: number,
): { edgeId: string; adjacentCellIds: string[] } {
  const neighbor =
    grid.type === "square"
      ? squareNeighbor(cell.row, cell.column, side)
      : hexNeighbor(cell.row, cell.column, side);
  const ownId = cellId(grid.type, cell.row, cell.column);
  if (
    neighbor.row < 0 ||
    neighbor.column < 0 ||
    neighbor.row >= grid.height ||
    neighbor.column >= grid.width
  ) {
    const boundary =
      grid.type === "square"
        ? squareBoundarySides[side]
        : hexBoundarySides[side];
    return {
      edgeId: `edge:${grid.type}:${cell.row}:${cell.column}|boundary:${boundary ?? "unknown"}`,
      adjacentCellIds: [ownId],
    };
  }
  const ordered =
    compareCoordinate(cell, neighbor) <= 0
      ? [cell, neighbor]
      : [neighbor, cell];
  const first = ordered[0];
  const second = ordered[1];
  if (first === undefined || second === undefined)
    throw new Error("无法规范化边坐标");
  return {
    edgeId: `edge:${grid.type}:${first.row}:${first.column}|${second.row}:${second.column}`,
    adjacentCellIds: [
      cellId(grid.type, first.row, first.column),
      cellId(grid.type, second.row, second.column),
    ],
  };
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((point.x - start.x) * dx + (point.y - start.y) * dy) /
              lengthSquared,
          ),
        );
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

export function nearestEdge(cell: VisibleCell, point: Point): number {
  let nearest = 0;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < cell.polygon.length; index += 1) {
    const start = cell.polygon[index];
    const end = cell.polygon[(index + 1) % cell.polygon.length];
    if (start === undefined || end === undefined) continue;
    const candidate = distanceToSegment(point, start, end);
    if (candidate < distance) {
      distance = candidate;
      nearest = index;
    }
  }
  return nearest;
}
