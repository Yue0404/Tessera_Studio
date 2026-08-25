import type { Point } from "./types.js";

export const TEXT_LINE_HEIGHT = 1.2;
export const TEXT_WIDTH_FACTOR = 0.6;
export const TEXT_BACKGROUND_PADDING_EM = 0.2;
export const TEXT_BACKGROUND_RADIUS_EM = 0.15;

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

function wrapTextLines(
  text: string,
  fontSize: number,
  wrapWidth: number | undefined,
): readonly string[] {
  const source = text.split(/\r\n|\r|\n/u);
  if (wrapWidth === undefined) return source;
  const columns = Math.max(
    1,
    Math.floor(wrapWidth / (fontSize * TEXT_WIDTH_FACTOR)),
  );
  return source.flatMap((line) => {
    const graphemes = [...GRAPHEME_SEGMENTER.segment(line)].map(
      (segment) => segment.segment,
    );
    if (graphemes.length === 0) return [""];
    const wrapped: string[] = [];
    for (let index = 0; index < graphemes.length; index += columns)
      wrapped.push(graphemes.slice(index, index + columns).join(""));
    return wrapped;
  });
}

function maxGraphemeColumns(lines: readonly string[]): number {
  let columns = 1;
  for (const line of lines) {
    // UTF-16 长度是字素数上界；短行不必重复调用分段器。
    if (line.length > columns) columns = Math.max(columns, graphemeCount(line));
  }
  return columns;
}

export function textLayout(
  text: string,
  fontSize: number,
  wrapWidth?: number,
): TextLayout {
  const lines = wrapTextLines(text, fontSize, wrapWidth);
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
  wrapWidth?: number,
): TextVisualBoundsSize {
  const layout = textLayout(text, fontSize, wrapWidth);
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

export function pointInRotatedBounds(
  point: Point,
  center: Point,
  width: number,
  height: number,
  rotationDegrees: number,
): boolean {
  const radians = -degreesToRadians(rotationDegrees);
  const deltaX = point.x - center.x;
  const deltaY = point.y - center.y;
  const localX = deltaX * Math.cos(radians) - deltaY * Math.sin(radians);
  const localY = deltaX * Math.sin(radians) + deltaY * Math.cos(radians);
  return Math.abs(localX) <= width / 2 && Math.abs(localY) <= height / 2;
}
