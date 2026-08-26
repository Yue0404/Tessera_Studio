import {
  cellCenter,
  cellPolygon,
  edgeSegment,
  markerLabelBounds,
  markerLabelFontSize,
  parseCellId,
  unionMapRects,
  type Point,
  type ProjectGrid,
} from "@tessera/core";

export interface ContentBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

function includePoint(
  bounds: ContentBounds | null,
  point: Point,
): ContentBounds {
  if (bounds === null) {
    return { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y };
  }
  return {
    minX: Math.min(bounds.minX, point.x),
    minY: Math.min(bounds.minY, point.y),
    maxX: Math.max(bounds.maxX, point.x),
    maxY: Math.max(bounds.maxY, point.y),
  };
}

function includeRect(
  bounds: ContentBounds | null,
  rect: ContentBounds,
): ContentBounds {
  return includePoint(includePoint(bounds, { x: rect.minX, y: rect.minY }), {
    x: rect.maxX,
    y: rect.maxY,
  });
}

function edgeAnchorPoint(
  grid: ProjectGrid,
  edgeById: ReadonlyMap<string, any>,
  edgeId: string,
): Point | undefined {
  const edge = edgeById.get(edgeId);
  const segment =
    edge === undefined
      ? undefined
      : edgeSegment(grid, edge.edgeId, edge.adjacentCellIds);
  if (segment === undefined) return undefined;
  return {
    x: (segment[0].x + segment[1].x) / 2,
    y: (segment[0].y + segment[1].y) / 2,
  };
}

export function documentEndpointPoint(
  grid: ProjectGrid,
  edgeById: ReadonlyMap<string, any>,
  endpoint: any,
): Point | undefined {
  if (endpoint.kind === "map-point") return endpoint.point;
  if (endpoint.kind === "edge-midpoint") {
    return edgeAnchorPoint(grid, edgeById, endpoint.edgeId);
  }
  const coordinate = parseCellId(endpoint.cellId);
  return cellCenter(grid, coordinate.row, coordinate.column);
}

export function documentOverlayAnchorPoint(
  grid: ProjectGrid,
  edgeById: ReadonlyMap<string, any>,
  overlay: any,
): Point | undefined {
  if (overlay.kind === "free-overlay") return overlay.point;
  if (overlay.anchor.kind === "edge") {
    return edgeAnchorPoint(grid, edgeById, overlay.anchor.edgeId);
  }
  const coordinate = parseCellId(overlay.anchor.cellId);
  return cellCenter(grid, coordinate.row, coordinate.column);
}

export function documentOverlayBounds(
  point: Point,
  overlay: any,
): ContentBounds {
  if (
    overlay.elementId === "tessera.basic:marker" &&
    typeof overlay.styleOverrides.size === "number"
  ) {
    const radius = overlay.styleOverrides.size / 2;
    const markerBounds = {
      minX: point.x - radius,
      minY: point.y - radius,
      maxX: point.x + radius,
      maxY: point.y + radius,
    };
    return typeof overlay.attributes.label === "string"
      ? unionMapRects(
          markerBounds,
          markerLabelBounds(
            point,
            overlay.attributes.label,
            overlay.styleOverrides.size,
            markerLabelFontSize(overlay.styleOverrides.size),
          ),
        )
      : markerBounds;
  }
  if (
    overlay.elementId === "tessera.basic:text" &&
    typeof overlay.styleOverrides.fontSize === "number" &&
    typeof overlay.attributes.text === "string"
  ) {
    const lines = overlay.attributes.text.split(/\r\n|\r|\n/u);
    const segmenter = new Intl.Segmenter(undefined, {
      granularity: "grapheme",
    });
    const columns = Math.max(
      1,
      ...lines.map((line: string) => [...segmenter.segment(line)].length),
    );
    const width = columns * overlay.styleOverrides.fontSize * 0.6;
    const height =
      Math.max(1, lines.length) * overlay.styleOverrides.fontSize * 1.2;
    const rotationDegrees =
      typeof overlay.styleOverrides.rotation === "number"
        ? overlay.styleOverrides.rotation
        : 0;
    const rotation = (rotationDegrees * Math.PI) / 180;
    const cosine = Math.abs(Math.cos(rotation));
    const sine = Math.abs(Math.sin(rotation));
    const halfWidth = (width * cosine + height * sine) / 2;
    const halfHeight = (width * sine + height * cosine) / 2;
    return {
      minX: point.x - halfWidth,
      minY: point.y - halfHeight,
      maxX: point.x + halfWidth,
      maxY: point.y + halfHeight,
    };
  }
  return { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y };
}

/** 仅从持久事实重建导航摘要，不读取缓存或视口状态。 */
export function computeProjectContentBounds(
  project: Record<string, any>,
): ContentBounds | null {
  const grid: ProjectGrid = {
    type: project.grid.type,
    width: project.grid.width,
    height: project.grid.height,
    cellSize: project.grid.cellSize,
  };
  const edges = project.managers.edgeManager.edges as any[];
  const edgeById = new Map(edges.map((edge) => [edge.edgeId, edge]));
  let bounds: ContentBounds | null = null;

  for (const chunk of project.chunks as any[]) {
    for (const cell of chunk.cellOverrides as any[]) {
      const coordinate = parseCellId(cell.cellId);
      for (const point of cellPolygon(
        grid,
        coordinate.row,
        coordinate.column,
      )) {
        bounds = includePoint(bounds, point);
      }
    }
  }
  for (const edge of edges) {
    const segment = edgeSegment(grid, edge.edgeId, edge.adjacentCellIds);
    if (segment !== undefined) {
      bounds = includePoint(includePoint(bounds, segment[0]), segment[1]);
    }
  }
  for (const connection of project.managers.connectionManager
    .connections as any[]) {
    const start = documentEndpointPoint(grid, edgeById, connection.start);
    const end = documentEndpointPoint(grid, edgeById, connection.end);
    if (start !== undefined) bounds = includePoint(bounds, start);
    if (end !== undefined) bounds = includePoint(bounds, end);
  }
  for (const overlay of project.managers.overlayManager.overlays as any[]) {
    const point = documentOverlayAnchorPoint(grid, edgeById, overlay);
    if (point !== undefined) {
      bounds = includeRect(bounds, documentOverlayBounds(point, overlay));
    }
  }
  for (const group of project.domainGroups as any[]) {
    for (const memberCellId of group.memberCellIds as string[]) {
      const coordinate = parseCellId(memberCellId);
      for (const point of cellPolygon(
        grid,
        coordinate.row,
        coordinate.column,
      )) {
        bounds = includePoint(bounds, point);
      }
    }
  }
  return bounds;
}

export function contentBoundsEqual(
  left: ContentBounds | null,
  right: ContentBounds | null,
): boolean {
  if (left === null || right === null) return left === right;
  const tolerance = 1e-9;
  return (
    Math.abs(left.minX - right.minX) <= tolerance &&
    Math.abs(left.minY - right.minY) <= tolerance &&
    Math.abs(left.maxX - right.maxX) <= tolerance &&
    Math.abs(left.maxY - right.maxY) <= tolerance
  );
}
