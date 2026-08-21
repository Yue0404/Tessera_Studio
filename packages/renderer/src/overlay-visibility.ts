import type { MapRect, Point } from "@tessera/core";

export const OVERLAY_VIEWPORT_BUFFER_CSS_PX = 768;

export function anchorInsideBufferedViewport(
  point: Point,
  viewport: MapRect,
  buffer = OVERLAY_VIEWPORT_BUFFER_CSS_PX,
): boolean {
  return (
    point.x >= viewport.minX - buffer &&
    point.x <= viewport.maxX + buffer &&
    point.y >= viewport.minY - buffer &&
    point.y <= viewport.maxY + buffer
  );
}
