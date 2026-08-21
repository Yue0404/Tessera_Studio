import type { Point } from "@tessera/core";

export const BASIC_EXPORT_FONT_FAMILY =
  '"Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif';

export const TEXT_LINE_HEIGHT = 1.2;
export const TEXT_WIDTH_FACTOR = 0.6;
export const TEXT_BACKGROUND_PADDING_EM = 0.2;
export const TEXT_BACKGROUND_RADIUS_EM = 0.15;

export interface TextVisualStyle {
  readonly fontSize: number;
  readonly fontWeight: "normal" | "bold";
  readonly align: "left" | "center" | "right";
  readonly rotation: number;
  readonly color: string;
  readonly opacity: number;
  readonly backgroundVisible: boolean;
}

export interface TextLayout {
  readonly lines: readonly string[];
  readonly width: number;
  readonly height: number;
  readonly paddedWidth: number;
  readonly paddedHeight: number;
  readonly padding: number;
  readonly radius: number;
}

export interface TextVisualBoundsSize {
  readonly width: number;
  readonly height: number;
}

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});

function graphemeCount(value: string): number {
  return [...GRAPHEME_SEGMENTER.segment(value)].length;
}

function maxGraphemeColumns(lines: readonly string[]): number {
  let columns = 1;
  for (const line of lines) {
    // UTF-16 长度是字素数上界；短行不必重复调用分段器。
    if (line.length > columns) columns = Math.max(columns, graphemeCount(line));
  }
  return columns;
}

export function textLayout(text: string, fontSize: number): TextLayout {
  const lines = text.split(/\r\n|\r|\n/u);
  const columns = maxGraphemeColumns(lines);
  const width = columns * fontSize * TEXT_WIDTH_FACTOR;
  const height = Math.max(1, lines.length) * fontSize * TEXT_LINE_HEIGHT;
  const padding = fontSize * TEXT_BACKGROUND_PADDING_EM;
  return {
    lines,
    width,
    height,
    paddedWidth: width + padding * 2,
    paddedHeight: height + padding * 2,
    padding,
    radius: fontSize * TEXT_BACKGROUND_RADIUS_EM,
  };
}

/** 字体实际字形可能宽于估算背景；内容范围采用每字素 1em 的保守上界。 */
export function conservativeTextBoundsSize(
  text: string,
  fontSize: number,
  backgroundVisible: boolean,
): TextVisualBoundsSize {
  const layout = textLayout(text, fontSize);
  const columns = maxGraphemeColumns(layout.lines);
  return {
    width: Math.max(
      columns * fontSize,
      backgroundVisible ? layout.paddedWidth : layout.width,
    ),
    height: Math.max(
      layout.height,
      backgroundVisible ? layout.paddedHeight : layout.height,
    ),
  };
}

export function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function rotatedRectBounds(
  center: Point,
  width: number,
  height: number,
  rotationDegrees: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const radians = degreesToRadians(rotationDegrees);
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  const halfWidth = (width * cosine + height * sine) / 2;
  const halfHeight = (width * sine + height * cosine) / 2;
  return {
    minX: center.x - halfWidth,
    minY: center.y - halfHeight,
    maxX: center.x + halfWidth,
    maxY: center.y + halfHeight,
  };
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
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
  return [
    { x: tip.x, y: tip.y },
    {
      x: tip.x - size * Math.cos(angle - Math.PI / 6),
      y: tip.y - size * Math.sin(angle - Math.PI / 6),
    },
    {
      x: tip.x - size * Math.cos(angle + Math.PI / 6),
      y: tip.y - size * Math.sin(angle + Math.PI / 6),
    },
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
