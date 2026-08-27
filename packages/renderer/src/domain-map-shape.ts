import {
  cellPolygon,
  domainGroupGeometry,
  parseCellId,
  type MapPoint,
  type MapRect,
  type ModuleDomainGroupInstance,
  type ProjectState,
} from "@tessera/core";

export type DomainMapShape = "circle" | "square" | "hexagon";

export interface DomainMapShapeGeometry {
  readonly center: MapPoint;
  readonly size: number;
  readonly points: readonly MapPoint[];
  readonly bounds: MapRect;
}

function rotatedPoint(
  center: Readonly<MapPoint>,
  radius: number,
  degrees: number,
): MapPoint {
  const angle = (degrees * Math.PI) / 180;
  return {
    x: center.x + Math.cos(angle) * radius,
    y: center.y + Math.sin(angle) * radius,
  };
}

/** 物体尺寸取 footprint 外包围盒短边比例，始终保留地格边界间距。 */
export function domainMapShapeGeometry(
  state: Readonly<ProjectState>,
  instance: Readonly<ModuleDomainGroupInstance>,
  shape: DomainMapShape,
  sizeScale: number,
  rotation: number,
): DomainMapShapeGeometry {
  const group = domainGroupGeometry(state.grid, instance.memberCellIds);
  const footprintPoints = group.memberCellIds.flatMap((cellId) => {
    const { row, column } = parseCellId(cellId);
    return cellPolygon(state.grid, row, column);
  });
  const footprintBounds = {
    minX: Math.min(...footprintPoints.map((point) => point.x)),
    minY: Math.min(...footprintPoints.map((point) => point.y)),
    maxX: Math.max(...footprintPoints.map((point) => point.x)),
    maxY: Math.max(...footprintPoints.map((point) => point.y)),
  };
  const size =
    Math.min(
      footprintBounds.maxX - footprintBounds.minX,
      footprintBounds.maxY - footprintBounds.minY,
    ) * sizeScale;
  const count = shape === "circle" ? 32 : shape === "square" ? 4 : 6;
  const start = shape === "square" ? -135 : shape === "hexagon" ? -90 : -90;
  const points = Array.from({ length: count }, (_, index) =>
    rotatedPoint(
      group.center,
      size / 2,
      start + rotation + (360 * index) / count,
    ),
  );
  return {
    center: group.center,
    size,
    points,
    bounds: {
      minX: Math.min(...points.map((point) => point.x)),
      minY: Math.min(...points.map((point) => point.y)),
      maxX: Math.max(...points.map((point) => point.x)),
      maxY: Math.max(...points.map((point) => point.y)),
    },
  };
}

export function domainMapShapeContainsPoint(
  geometry: Readonly<DomainMapShapeGeometry>,
  point: Readonly<MapPoint>,
): boolean {
  let inside = false;
  const points = geometry.points;
  for (
    let current = 0, previous = points.length - 1;
    current < points.length;
    previous = current++
  ) {
    const a = points[current];
    const b = points[previous];
    if (a === undefined || b === undefined) continue;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}

export function domainMapShapeIntersectsRect(
  geometry: Readonly<DomainMapShapeGeometry>,
  rect: Readonly<MapRect>,
): boolean {
  if (
    geometry.bounds.maxX < rect.minX ||
    geometry.bounds.minX > rect.maxX ||
    geometry.bounds.maxY < rect.minY ||
    geometry.bounds.minY > rect.maxY
  )
    return false;
  return (
    geometry.points.some(
      (point) =>
        point.x >= rect.minX &&
        point.x <= rect.maxX &&
        point.y >= rect.minY &&
        point.y <= rect.maxY,
    ) ||
    domainMapShapeContainsPoint(geometry, {
      x: (rect.minX + rect.maxX) / 2,
      y: (rect.minY + rect.maxY) / 2,
    })
  );
}
