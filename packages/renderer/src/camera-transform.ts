import { PROJECT_MIN_ZOOM, type MapPoint } from "@tessera/core";

export const MIN_ZOOM = PROJECT_MIN_ZOOM;
export const MAX_ZOOM = 4;
export const ZOOM_STEP = 0.25;
export const MIN_ROTATION = -360;
export const MAX_ROTATION = 360;
export const ROTATION_STEP = 15;

export function clampRotation(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError("rotation-not-finite");
  return Math.min(MAX_ROTATION, Math.max(MIN_ROTATION, value));
}

function rotationComponents(rotation: number): {
  readonly cosine: number;
  readonly sine: number;
} {
  const radians = ((clampRotation(rotation) % 360) * Math.PI) / 180;
  return { cosine: Math.cos(radians), sine: Math.sin(radians) };
}

/** 围绕地图原点旋转向量，正角度在屏幕坐标系中表现为顺时针。 */
export function rotateMapVector(
  point: Readonly<MapPoint>,
  rotation: number,
): MapPoint {
  const { cosine, sine } = rotationComponents(rotation);
  return {
    x: point.x * cosine - point.y * sine,
    y: point.x * sine + point.y * cosine,
  };
}

/** 将同一摄像机变换应用到 Pixi 内容层或地图坐标预览层。 */
export function applyCameraViewTransform(
  target: {
    readonly position: { set(x: number, y: number): void };
    readonly scale: { set(value: number): void };
    rotation: number;
  },
  camera: Readonly<MapPoint>,
  zoom: number,
  rotation: number,
): void {
  target.position.set(camera.x, camera.y);
  target.scale.set(clampZoom(zoom));
  target.rotation = (clampRotation(rotation) * Math.PI) / 180;
}

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
  rotation = 0,
): MapPoint {
  const safeZoom = clampZoom(zoom);
  const rotated = rotateMapVector(point, rotation);
  return {
    x: rotated.x * safeZoom + camera.x,
    y: rotated.y * safeZoom + camera.y,
  };
}

export function screenToMap(
  point: Readonly<MapPoint>,
  camera: Readonly<MapPoint>,
  zoom: number,
  rotation = 0,
): MapPoint {
  const safeZoom = clampZoom(zoom);
  const translated = {
    x: (point.x - camera.x) / safeZoom,
    y: (point.y - camera.y) / safeZoom,
  };
  return rotateMapVector(translated, -rotation);
}

/** 在指定屏幕锚点缩放，缩放前后的地图坐标保持完全相同。 */
export function zoomCameraAt(
  camera: Readonly<MapPoint>,
  oldZoom: number,
  requestedZoom: number,
  screenAnchor: Readonly<MapPoint>,
  rotation = 0,
): { readonly camera: MapPoint; readonly zoom: number } {
  const nextZoom = clampZoom(requestedZoom);
  const mapAnchor = screenToMap(screenAnchor, camera, oldZoom, rotation);
  const rotatedAnchor = rotateMapVector(mapAnchor, rotation);
  return {
    zoom: nextZoom,
    camera: {
      x: screenAnchor.x - rotatedAnchor.x * nextZoom,
      y: screenAnchor.y - rotatedAnchor.y * nextZoom,
    },
  };
}

/** 在指定屏幕锚点旋转，旋转前后的锚点地图坐标保持不变。 */
export function rotateCameraAt(
  camera: Readonly<MapPoint>,
  zoom: number,
  oldRotation: number,
  requestedRotation: number,
  screenAnchor: Readonly<MapPoint>,
): { readonly camera: MapPoint; readonly rotation: number } {
  const rotation = clampRotation(requestedRotation);
  const mapAnchor = screenToMap(screenAnchor, camera, zoom, oldRotation);
  const rotatedAnchor = rotateMapVector(mapAnchor, rotation);
  return {
    rotation,
    camera: {
      x: screenAnchor.x - rotatedAnchor.x * clampZoom(zoom),
      y: screenAnchor.y - rotatedAnchor.y * clampZoom(zoom),
    },
  };
}
