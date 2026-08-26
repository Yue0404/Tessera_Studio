import type { Point } from "@tessera/core";
export {
  conservativeTextBoundsSize,
  degreesToRadians,
  rotatedRectBounds,
  textLayout,
  TEXT_BACKGROUND_PADDING_EM,
  TEXT_BACKGROUND_RADIUS_EM,
  TEXT_LINE_HEIGHT,
  TEXT_WIDTH_FACTOR,
  type TextLayout,
  type TextVisualBoundsSize,
} from "@tessera/core";

export const BASIC_EXPORT_FONT_FAMILY =
  '"Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif';

export interface TextVisualStyle {
  readonly fontFamily?: string;
  readonly fontSize: number;
  readonly fontWeight: "normal" | "bold";
  readonly align: "left" | "center" | "right";
  readonly rotation: number;
  readonly color: string;
  readonly opacity: number;
  readonly backgroundVisible: boolean;
  readonly wrapWidth?: number;
}

export function cellLabelStyle(cellSize: number): TextVisualStyle {
  return {
    fontSize: cellSize * 0.3,
    fontWeight: "normal",
    align: "center",
    rotation: 0,
    color: "#F4EFE4FF",
    opacity: 1,
    backgroundVisible: false,
  };
}

export function connectionLabelStyle(
  cellSize: number,
  strokeColor: string,
  opacity: number,
): TextVisualStyle {
  return {
    fontSize: cellSize * 0.35,
    fontWeight: "normal",
    align: "center",
    rotation: 0,
    color: strokeColor,
    opacity,
    backgroundVisible: false,
  };
}

export function textBackgroundColor(canvasBackground: string): string {
  const normalized = canvasBackground.replace(/^#/u, "").slice(0, 6);
  return `#${normalized.padEnd(6, "0")}CC`;
}

export function arrowSize(strokeWidth: number, cellSize: number): number {
  return Math.max(strokeWidth * 3, cellSize * 0.18);
}

export function arrowPolygon(
  from: Point,
  tip: Point,
  size: number,
): readonly Point[] {
  const length = Math.hypot(tip.x - from.x, tip.y - from.y);
  if (length === 0) return [tip, tip, tip];
  const unitX = (tip.x - from.x) / length;
  const unitY = (tip.y - from.y) / length;
  const baseX = tip.x - unitX * size;
  const baseY = tip.y - unitY * size;
  const halfWidth = size * 0.45;
  return [
    { x: tip.x, y: tip.y },
    {
      x: baseX - unitY * halfWidth,
      y: baseY + unitX * halfWidth,
    },
    {
      x: baseX + unitY * halfWidth,
      y: baseY - unitX * halfWidth,
    },
  ];
}

/** 把箭杆截到箭头三角形底边，避免粗线末端覆盖实心箭头。 */
export function arrowShaftSegment(
  start: Point,
  end: Point,
  arrowStart: boolean,
  arrowEnd: boolean,
  size: number,
): readonly [Point, Point] | null {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (length === 0) return null;
  const inset = size;
  const startInset = arrowStart ? inset : 0;
  const endInset = arrowEnd ? inset : 0;
  if (length <= startInset + endInset) return null;
  const unitX = (end.x - start.x) / length;
  const unitY = (end.y - start.y) / length;
  return [
    { x: start.x + unitX * startInset, y: start.y + unitY * startInset },
    { x: end.x - unitX * endInset, y: end.y - unitY * endInset },
  ];
}

export function markerPolygon(
  shape: "diamond" | "pin",
  size: number,
): readonly Point[] {
  const radius = size / 2;
  if (shape === "diamond") {
    return [
      { x: 0, y: -radius },
      { x: radius, y: 0 },
      { x: 0, y: radius },
      { x: -radius, y: 0 },
    ];
  }
  const headRadius = size * 0.31;
  return [
    { x: 0, y: radius },
    { x: -headRadius * 0.7, y: headRadius * 0.15 },
    { x: -headRadius, y: -headRadius * 0.25 },
    { x: -headRadius * 0.75, y: -headRadius * 0.8 },
    { x: 0, y: -headRadius },
    { x: headRadius * 0.75, y: -headRadius * 0.8 },
    { x: headRadius, y: -headRadius * 0.25 },
    { x: headRadius * 0.7, y: headRadius * 0.15 },
  ];
}

export function defaultDashPattern(strokeWidth: number): readonly number[] {
  return [strokeWidth * 4, strokeWidth * 3];
}

export interface DashedSegment {
  readonly start: Point;
  readonly end: Point;
}

/**
 * 从原始线段起点累计虚线相位；裁切后的局部线段不会重新起相。
 */
export function dashedSegments(
  originalStart: Point,
  originalEnd: Point,
  visibleStart: Point,
  visibleEnd: Point,
  pattern: readonly number[],
): readonly DashedSegment[] {
  const originalLength = Math.hypot(
    originalEnd.x - originalStart.x,
    originalEnd.y - originalStart.y,
  );
  const visibleLength = Math.hypot(
    visibleEnd.x - visibleStart.x,
    visibleEnd.y - visibleStart.y,
  );
  const period = pattern.reduce((sum, value) => sum + value, 0);
  if (
    originalLength === 0 ||
    visibleLength === 0 ||
    period <= 0 ||
    pattern.length === 0
  ) {
    return [];
  }
  const unitX = (originalEnd.x - originalStart.x) / originalLength;
  const unitY = (originalEnd.y - originalStart.y) / originalLength;
  const visibleOffset = Math.max(
    0,
    (visibleStart.x - originalStart.x) * unitX +
      (visibleStart.y - originalStart.y) * unitY,
  );
  let phase = visibleOffset % period;
  let patternIndex = 0;
  while (phase >= (pattern[patternIndex] ?? 0)) {
    phase -= pattern[patternIndex] ?? 0;
    patternIndex = (patternIndex + 1) % pattern.length;
  }
  let position = 0;
  const result: DashedSegment[] = [];
  while (position < visibleLength) {
    const remaining = (pattern[patternIndex] ?? 0) - phase;
    const next = Math.min(visibleLength, position + remaining);
    if (patternIndex % 2 === 0 && next > position) {
      result.push({
        start: {
          x: visibleStart.x + unitX * position,
          y: visibleStart.y + unitY * position,
        },
        end: {
          x: visibleStart.x + unitX * next,
          y: visibleStart.y + unitY * next,
        },
      });
    }
    position = next;
    phase = 0;
    patternIndex = (patternIndex + 1) % pattern.length;
  }
  return result;
}
