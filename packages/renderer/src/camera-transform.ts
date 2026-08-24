import type { MapPoint } from "@tessera/core";

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;
export const ZOOM_STEP = 0.25;

/** 将奇数 CSS 像素描边对齐到设备像素中心，避免跨分块边界抗锯齿漂移。 */
export function strokeAlignmentOffsetMapUnits(
  zoom: number,
  resolution: number,
): number {
  const safeZoom = clampZoom(zoom);
  if (!Number.isFinite(resolution) || resolution <= 0) {
    throw new RangeError("renderer-resolution-invalid");
  }
  return 0.5 / (safeZoom * resolution);
}

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError("zoom-not-finite");
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

export function mapToScreen(
  point: Readonly<MapPoint>,
  camera: Readonly<MapPoint>,
  zoom: number,
): MapPoint {
  const safeZoom = clampZoom(zoom);
  return {
    x: point.x * safeZoom + camera.x,
    y: point.y * safeZoom + camera.y,
  };
}

export function screenToMap(
  point: Readonly<MapPoint>,
  camera: Readonly<MapPoint>,
  zoom: number,
): MapPoint {
  const safeZoom = clampZoom(zoom);
  return {
    x: (point.x - camera.x) / safeZoom,
    y: (point.y - camera.y) / safeZoom,
  };
}

/** 在指定屏幕锚点缩放，缩放前后的地图坐标保持完全相同。 */
export function zoomCameraAt(
  camera: Readonly<MapPoint>,
  oldZoom: number,
  requestedZoom: number,
  screenAnchor: Readonly<MapPoint>,
): { readonly camera: MapPoint; readonly zoom: number } {
  const nextZoom = clampZoom(requestedZoom);
  const mapAnchor = screenToMap(screenAnchor, camera, oldZoom);
  return {
    zoom: nextZoom,
    camera: {
      x: screenAnchor.x - mapAnchor.x * nextZoom,
      y: screenAnchor.y - mapAnchor.y * nextZoom,
    },
  };
}
