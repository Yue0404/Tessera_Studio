import {
  Container,
  FillPattern,
  Graphics,
  Matrix,
  Sprite,
  Text,
  type Texture,
} from "pixi.js";
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
import {
  GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER,
  genericModuleCellPatternPlan,
  genericModuleMarkerImageSize,
} from "./generic-module-assets.js";

export interface PixiStrokeStyle {
  readonly color: string;
  readonly width: number;
  readonly opacity: number;
  readonly lineStyle: "solid" | "dashed";
  readonly dashPattern?: readonly number[];
  readonly lineCap?: "butt" | "round" | "square";
}

export function pixiStrokePlan(
  originalStart: Point,
  originalEnd: Point,
  visibleStart: Point,
  visibleEnd: Point,
  style: PixiStrokeStyle,
): {
  readonly cap: "butt" | "round" | "square";
  readonly segments: readonly { readonly start: Point; readonly end: Point }[];
} {
  return {
    cap: style.lineCap ?? "round",
    segments:
      style.lineStyle === "solid"
        ? [{ start: visibleStart, end: visibleEnd }]
        : dashedSegments(
            originalStart,
            originalEnd,
            visibleStart,
            visibleEnd,
            style.dashPattern ?? defaultDashPattern(style.width),
          ),
  };
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
  const plan = pixiStrokePlan(
    originalStart,
    originalEnd,
    visibleStart,
    visibleEnd,
    style,
  );
  const options = {
    color: stroke.color,
    alpha: stroke.alpha * style.opacity,
    width: style.width,
    cap: plan.cap,
  };
  if (style.lineStyle === "solid") {
    graphics
      .moveTo(visibleStart.x, visibleStart.y)
      .lineTo(visibleEnd.x, visibleEnd.y)
      .stroke(options);
    return;
  }
  for (const segment of plan.segments) {
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

/** 图片仅缩放最长边，保留原色与宽高比。 */
export function createPixiImageMarker(
  point: Point,
  texture: Texture,
  naturalWidth: number,
  naturalHeight: number,
  displaySize: number,
  rotationDegrees: number,
  opacity: number,
): Sprite {
  const size = genericModuleMarkerImageSize(
    naturalWidth,
    naturalHeight,
    displaySize,
  );
  const marker = new Sprite(texture);
  marker.anchor.set(0.5);
  marker.position.set(point.x, point.y);
  marker.width = size.width;
  marker.height = size.height;
  marker.rotation = degreesToRadians(rotationDegrees);
  marker.alpha = opacity;
  return marker;
}

/** 全局纹理坐标使相邻方格与六边形共享固定地图原点相位，图形本身负责裁剪。 */
export function createPixiCellPattern(
  polygon: readonly Point[],
  texture: Texture,
  patternScale: number,
  opacity: number,
): Graphics {
  const plan = genericModuleCellPatternPlan(
    polygon,
    texture.width,
    texture.height,
    patternScale,
  );
  const pattern = new FillPattern({
    texture,
    repetition: "repeat",
    textureSpace: "global",
  });
  pattern.setTransform(new Matrix().scale(patternScale, patternScale));
  const graphics = new Graphics()
    .poly(plan.clipPolygon.flatMap((point) => [point.x, point.y]))
    .fill(pattern);
  graphics.alpha = opacity;
  return graphics;
}

/** 解码中、失败或已释放都使用同一高对比占位，避免静默退化为普通模块样式。 */
export function createPixiResourcePlaceholderCell(
  polygon: readonly Point[],
  opacity: number,
): Graphics {
  const primary = colorValue(
    GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER.primaryColor,
  );
  const secondary = colorValue(
    GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER.secondaryColor,
  );
  const graphics = new Graphics()
    .poly(polygon.flatMap((point) => [point.x, point.y]))
    .fill({ color: primary.color, alpha: primary.alpha * opacity });
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    if (start === undefined || end === undefined) continue;
    drawPixiStroke(graphics, start, end, start, end, {
      color: GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER.secondaryColor,
      width: GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER.strokeWidth,
      opacity: secondary.alpha,
      lineStyle: "dashed",
      dashPattern:
        GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER.strokeDashPattern,
      lineCap: "butt",
    });
  }
  return graphics;
}

export function createPixiResourcePlaceholderMarker(
  point: Point,
  displaySize: number,
  rotationDegrees: number,
  opacity: number,
): Graphics {
  const marker = createPixiMarker(
    point,
    "diamond",
    displaySize,
    rotationDegrees,
    GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER.primaryColor,
    opacity,
  );
  const secondary = colorValue(
    GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER.secondaryColor,
  );
  marker
    .moveTo(
      -displaySize *
        GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER.markerCrossRatio,
      -displaySize *
        GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER.markerCrossRatio,
    )
    .lineTo(
      displaySize *
        GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER.markerCrossRatio,
      displaySize *
        GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER.markerCrossRatio,
    )
    .moveTo(
      displaySize *
        GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER.markerCrossRatio,
      -displaySize *
        GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER.markerCrossRatio,
    )
    .lineTo(
      -displaySize *
        GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER.markerCrossRatio,
      displaySize *
        GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER.markerCrossRatio,
    )
    .stroke({
      color: secondary.color,
      alpha: secondary.alpha,
      width: GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER.strokeWidth,
    });
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
  const layout = textLayout(text, style.fontSize, style.wrapWidth);
  const renderedText = layout.lines.join("\n");
  const label = new Text({
    text: renderedText,
    style: {
      fill: fill.color,
      fontFamily: style.fontFamily ?? BASIC_EXPORT_FONT_FAMILY,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      align: style.align,
      lineHeight: style.fontSize * 1.2,
    },
  });
  label.anchor.set(0.5);
  label.alpha = fill.alpha * style.opacity;
  if (backgroundColor !== null) {
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
