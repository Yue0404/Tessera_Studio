import { conservativeTextBoundsSize } from "./text-visual-bounds.js";
import type { Point } from "./types.js";
import type { MapRect } from "./viewport-clipping.js";

/** 标记附文从标记尺寸派生，保证编辑器、命中测试和导出使用同一套几何。 */
export function markerLabelFontSize(markerSize: number): number {
  return Math.max(10, markerSize * 0.45);
}

export function markerLabelPoint(
  anchor: Point,
  markerSize: number,
  fontSize = markerLabelFontSize(markerSize),
): Point {
  return {
    x: anchor.x,
    y: anchor.y + markerSize / 2 + fontSize * 0.75,
  };
}

export function markerLabelBounds(
  anchor: Point,
  label: string,
  markerSize: number,
  fontSize = markerLabelFontSize(markerSize),
): MapRect {
  const center = markerLabelPoint(anchor, markerSize, fontSize);
  const size = conservativeTextBoundsSize(label, fontSize, false);
  return {
    minX: center.x - size.width / 2,
    minY: center.y - size.height / 2,
    maxX: center.x + size.width / 2,
    maxY: center.y + size.height / 2,
  };
}

export function unionMapRects(left: MapRect, right: MapRect): MapRect {
  return {
    minX: Math.min(left.minX, right.minX),
    minY: Math.min(left.minY, right.minY),
    maxX: Math.max(left.maxX, right.maxX),
    maxY: Math.max(left.maxY, right.maxY),
  };
}
