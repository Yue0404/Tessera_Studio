import type { MapRect, Point } from "@tessera/core";

export const OVERLAY_VIEWPORT_BUFFER_CSS_PX = 768;
export const MARKER_MIN_CSS_PX = 8;
export const MARKER_MAX_CSS_PX = 256;
export const TEXT_MIN_CSS_PX = 8;
export const TEXT_MAX_CSS_PX = 96;
export const TEXT_WRAP_MAX_CSS_PX = 512;

/** 声明尺寸使用地图单位，最终屏幕尺寸必须保持在 CSS 可读范围内。 */
export function cssClampedMapSize(
  mapSize: number,
  zoom: number,
  minCssPx: number,
  maxCssPx: number,
): number {
  const safeZoom = Math.max(zoom, 0.01);
  return Math.min(maxCssPx, Math.max(minCssPx, mapSize * safeZoom)) / safeZoom;
}

export function markerMapSize(displaySize: number, zoom: number): number {
  return cssClampedMapSize(
    displaySize,
    zoom,
    MARKER_MIN_CSS_PX,
    MARKER_MAX_CSS_PX,
  );
}

export function textMapSize(fontSize: number, zoom: number): number {
  return cssClampedMapSize(fontSize, zoom, TEXT_MIN_CSS_PX, TEXT_MAX_CSS_PX);
}

export function overlayBufferedViewport(
  viewport: MapRect,
  zoom: number,
): MapRect {
  const bufferMapUnits = OVERLAY_VIEWPORT_BUFFER_CSS_PX / Math.max(zoom, 0.01);
  return {
    minX: viewport.minX - bufferMapUnits,
    minY: viewport.minY - bufferMapUnits,
    maxX: viewport.maxX + bufferMapUnits,
    maxY: viewport.maxY + bufferMapUnits,
  };
}

export function anchorInsideBufferedViewport(
  point: Point,
  viewport: MapRect,
  zoom = 1,
): boolean {
  const buffered = overlayBufferedViewport(viewport, zoom);
  return (
    point.x >= buffered.minX &&
    point.x <= buffered.maxX &&
    point.y >= buffered.minY &&
    point.y <= buffered.maxY
  );
}

export function textWrapMapSize(wrapWidth: number, zoom: number): number {
  const safeZoom = Math.max(zoom, 0.01);
  return Math.min(wrapWidth, TEXT_WRAP_MAX_CSS_PX / safeZoom);
}
