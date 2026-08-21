import type { Point } from "./types.js";

export interface MapRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type ClippedSegment = readonly [Point, Point];

/** Liang–Barsky 参数裁切；返回仅用于渲染的端点，不修改模型。 */
export function clipSegmentToRect(
  start: Point,
  end: Point,
  rect: MapRect,
): ClippedSegment | null {
  if (
    ![
      start.x,
      start.y,
      end.x,
      end.y,
      rect.minX,
      rect.minY,
      rect.maxX,
      rect.maxY,
    ].every(Number.isFinite) ||
    rect.minX > rect.maxX ||
    rect.minY > rect.maxY
  ) {
    throw new RangeError("segment-or-viewport-invalid");
  }
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const p = [-dx, dx, -dy, dy];
  const q = [
    start.x - rect.minX,
    rect.maxX - start.x,
    start.y - rect.minY,
    rect.maxY - start.y,
  ];
  let lower = 0;
  let upper = 1;
  for (let index = 0; index < p.length; index += 1) {
    const denominator = p[index];
    const numerator = q[index];
    if (denominator === undefined || numerator === undefined) continue;
    if (denominator === 0) {
      if (numerator < 0) return null;
      continue;
    }
    const ratio = numerator / denominator;
    if (denominator < 0) lower = Math.max(lower, ratio);
    else upper = Math.min(upper, ratio);
    if (lower > upper) return null;
  }
  return [
    { x: start.x + lower * dx, y: start.y + lower * dy },
    { x: start.x + upper * dx, y: start.y + upper * dy },
  ];
}

export function pointInRect(point: Point, rect: MapRect): boolean {
  return (
    point.x >= rect.minX &&
    point.x <= rect.maxX &&
    point.y >= rect.minY &&
    point.y <= rect.maxY
  );
}
