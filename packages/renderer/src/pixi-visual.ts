import { Container, Graphics, Text } from "pixi.js";
import type { Point } from "@tessera/core";
import {
  BASIC_EXPORT_FONT_FAMILY,
  arrowPolygon,
  dashedSegments,
  defaultDashPattern,
  degreesToRadians,
  markerPolygon,
  textLayout,
  type TextVisualStyle,
} from "./visual-style.js";
import { colorValue } from "./render-utils.js";

export interface PixiStrokeStyle {
  readonly color: string;
  readonly width: number;
  readonly opacity: number;
  readonly lineStyle: "solid" | "dashed";
}

export function drawPixiStroke(
  graphics: Graphics,
  originalStart: Point,
  originalEnd: Point,
  visibleStart: Point,
  visibleEnd: Point,
  style: PixiStrokeStyle,
): void {
  const stroke = colorValue(style.color);
  const options = {
    color: stroke.color,
    alpha: stroke.alpha * style.opacity,
    width: style.width,
    cap: "round" as const,
  };
  if (style.lineStyle === "solid") {
    graphics
      .moveTo(visibleStart.x, visibleStart.y)
      .lineTo(visibleEnd.x, visibleEnd.y)
      .stroke(options);
    return;
  }
  for (const segment of dashedSegments(
    originalStart,
    originalEnd,
    visibleStart,
    visibleEnd,
    defaultDashPattern(style.width),
  )) {
    graphics
      .moveTo(segment.start.x, segment.start.y)
      .lineTo(segment.end.x, segment.end.y)
      .stroke(options);
  }
}

export function drawPixiArrow(
  graphics: Graphics,
  from: Point,
  tip: Point,
  size: number,
  color: string,
  opacity: number,
): void {
  const fill = colorValue(color);
  graphics
    .poly(arrowPolygon(from, tip, size).flatMap((point) => [point.x, point.y]))
    .fill({ color: fill.color, alpha: fill.alpha * opacity });
}

export function createPixiMarker(
  point: Point,
  shape: "circle" | "diamond" | "pin",
  size: number,
  rotationDegrees: number,
  color: string,
  opacity: number,
): Graphics {
  const fill = colorValue(color);
  const marker = new Graphics();
  if (shape === "circle") marker.circle(0, 0, size / 2);
  else {
    marker.poly(
      markerPolygon(shape, size).flatMap((candidate) => [
        candidate.x,
        candidate.y,
      ]),
    );
  }
  marker.fill({ color: fill.color, alpha: fill.alpha * opacity });
  marker.position.set(point.x, point.y);
  marker.rotation = degreesToRadians(rotationDegrees);
  return marker;
}

export function createPixiText(
  point: Point,
  text: string,
  style: TextVisualStyle,
  backgroundColor: string | null,
): Container {
  const container = new Container();
  const fill = colorValue(style.color);
  const label = new Text({
    text,
    style: {
      fill: fill.color,
      fontFamily: BASIC_EXPORT_FONT_FAMILY,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      align: style.align,
      lineHeight: style.fontSize * 1.2,
    },
  });
  label.anchor.set(0.5);
  label.alpha = fill.alpha * style.opacity;
  if (backgroundColor !== null) {
    const layout = textLayout(text, style.fontSize);
    const background = colorValue(backgroundColor);
    container.addChild(
      new Graphics()
        .roundRect(
          -layout.paddedWidth / 2,
          -layout.paddedHeight / 2,
          layout.paddedWidth,
          layout.paddedHeight,
          layout.radius,
        )
        .fill({
          color: background.color,
          alpha: background.alpha * style.opacity,
        }),
    );
  }
  container.addChild(label);
  container.position.set(point.x, point.y);
  container.rotation = degreesToRadians(style.rotation);
  return container;
}
