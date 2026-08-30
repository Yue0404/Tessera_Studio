import {
  cellPolygon,
  edgeSegment,
  projectConnectionEndpointPoint,
  projectOverlayAnchorPoint,
  type MapPoint,
  type MapRect,
  type ProjectGrid,
  type ProjectState,
} from "@tessera/core";
import { clampZoom, rotateMapVector } from "./camera-transform.js";

export type ViewNavigationPlan =
  | {
      readonly status: "applied";
      readonly camera: MapPoint;
      readonly zoom: number;
    }
  | { readonly status: "limited"; readonly requiredZoom: number }
  | { readonly status: "empty" };

export interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ScreenInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export const EMPTY_SCREEN_INSETS: ScreenInsets = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
};

export function insetScreenRect(
  viewportWidth: number,
  viewportHeight: number,
  insets: Readonly<ScreenInsets> = EMPTY_SCREEN_INSETS,
): ScreenRect {
  const width = Math.max(1, viewportWidth);
  const height = Math.max(1, viewportHeight);
  const left = Math.max(0, Math.min(width, insets.left));
  const right = Math.max(0, Math.min(width - left, insets.right));
  const top = Math.max(0, Math.min(height, insets.top));
  const bottom = Math.max(0, Math.min(height - top, insets.bottom));
  return {
    x: left,
    y: top,
    width: Math.max(1, width - left - right),
    height: Math.max(1, height - top - bottom),
  };
}

function rotatedBoundsSize(
  bounds: Readonly<MapRect>,
  rotation: number,
): { readonly width: number; readonly height: number } {
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const xAxis = rotateMapVector({ x: width, y: 0 }, rotation);
  const yAxis = rotateMapVector({ x: 0, y: height }, rotation);
  return {
    width: Math.abs(xAxis.x) + Math.abs(yAxis.x),
    height: Math.abs(xAxis.y) + Math.abs(yAxis.y),
  };
}

function includePoint(
  bounds: MapRect | null,
  point: MapPoint,
  radius = 0,
): MapRect {
  const value = {
    minX: point.x - radius,
    minY: point.y - radius,
    maxX: point.x + radius,
    maxY: point.y + radius,
  };
  return bounds === null
    ? value
    : {
        minX: Math.min(bounds.minX, value.minX),
        minY: Math.min(bounds.minY, value.minY),
        maxX: Math.max(bounds.maxX, value.maxX),
        maxY: Math.max(bounds.maxY, value.maxY),
      };
}

export function gridMapBounds(grid: ProjectGrid): MapRect {
  const representativeRows =
    grid.type === "hex-pointy" && grid.height > 1
      ? [0, 1, grid.height - 1]
      : [0, grid.height - 1];
  const representativeColumns = [0, grid.width - 1];
  let bounds: MapRect | null = null;
  // odd-r 点顶六边形的奇数行向右偏移半列；常数个代表行同时覆盖两种行奇偶。
  for (const row of representativeRows) {
    for (const column of representativeColumns) {
      for (const point of cellPolygon(grid, row, column))
        bounds = includePoint(bounds, point);
    }
  }
  if (bounds === null) throw new Error("grid-bounds-empty");
  return bounds;
}

/** 只遍历稀疏已存在对象，不按地图总面积枚举。 */
export function projectContentBounds(
  state: Readonly<ProjectState>,
): MapRect | null {
  let bounds: MapRect | null = null;
  for (const cell of state.cells.values()) {
    for (const point of cellPolygon(state.grid, cell.row, cell.column))
      bounds = includePoint(bounds, point);
  }
  for (const edge of state.edges.values()) {
    const segment = edgeSegment(state.grid, edge.edgeId, edge.adjacentCellIds);
    if (segment === undefined) continue;
    bounds = includePoint(bounds, segment[0], edge.strokeWidth / 2);
    bounds = includePoint(bounds, segment[1], edge.strokeWidth / 2);
  }
  for (const overlay of state.overlays.values()) {
    const point = projectOverlayAnchorPoint(state, overlay);
    if (point === undefined) continue;
    const radius =
      overlay.overlayType === "marker"
        ? overlay.style.size * 1.5
        : overlay.style.fontSize * Math.max(1, overlay.text.length) * 0.75;
    bounds = includePoint(bounds, point, Math.max(1, radius));
  }
  for (const connection of state.connections.values()) {
    const start = projectConnectionEndpointPoint(state, connection.start);
    const end = projectConnectionEndpointPoint(state, connection.end);
    if (start !== undefined)
      bounds = includePoint(bounds, start, connection.style.strokeWidth);
    if (end !== undefined)
      bounds = includePoint(bounds, end, connection.style.strokeWidth);
  }
  return bounds;
}

export function fitBoundsPlan(
  bounds: Readonly<MapRect> | null,
  viewportWidth: number,
  viewportHeight: number,
  padding = 32,
  rotation = 0,
  insets: Readonly<ScreenInsets> = EMPTY_SCREEN_INSETS,
): ViewNavigationPlan {
  if (bounds === null) return { status: "empty" };
  const size = rotatedBoundsSize(bounds, rotation);
  const screen = insetScreenRect(viewportWidth, viewportHeight, insets);
  const availableWidth = Math.max(1, screen.width - padding * 2);
  const availableHeight = Math.max(1, screen.height - padding * 2);
  const requiredZoom = Math.min(
    availableWidth / size.width,
    availableHeight / size.height,
  );
  if (requiredZoom < 0.25) return { status: "limited", requiredZoom };
  const zoom = clampZoom(requiredZoom);
  const center = rotateMapVector(
    {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    },
    rotation,
  );
  return {
    status: "applied",
    zoom,
    camera: {
      x: screen.x + screen.width / 2 - center.x * zoom,
      y: screen.y + screen.height / 2 - center.y * zoom,
    },
  };
}

export function centerBoundsPlan(
  bounds: Readonly<MapRect>,
  viewportWidth: number,
  viewportHeight: number,
  zoom: number,
  insets: Readonly<ScreenInsets> = EMPTY_SCREEN_INSETS,
  rotation = 0,
): ViewNavigationPlan {
  const screen = insetScreenRect(viewportWidth, viewportHeight, insets);
  const availableCenterX = screen.x + screen.width / 2;
  const availableCenterY = screen.y + screen.height / 2;
  const safeZoom = clampZoom(zoom);
  const center = rotateMapVector(
    {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    },
    rotation,
  );
  return {
    status: "applied",
    zoom: safeZoom,
    camera: {
      x: availableCenterX - center.x * safeZoom,
      y: availableCenterY - center.y * safeZoom,
    },
  };
}
