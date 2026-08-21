import type { Point } from "@tessera/core";
import {
  BASIC_EXPORT_FONT_FAMILY,
  defaultDashPattern,
  markerPolygon,
  textLayout,
} from "../visual-style.js";
import type {
  TextPrimitive,
  VisualExportPlan,
  VisualPrimitive,
} from "./types.js";

export type VisualExportCanvasContext =
  CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function colorAndAlpha(
  color: string,
  opacity: number,
): { color: string; alpha: number } {
  const normalized = color.replace(/^#/u, "");
  const colorAlpha =
    normalized.length === 8
      ? Number.parseInt(normalized.slice(6), 16) / 255
      : 1;
  return {
    color: `#${normalized.slice(0, 6)}`,
    alpha: Math.max(0, Math.min(1, colorAlpha * opacity)),
  };
}

function pathPoints(
  context: VisualExportCanvasContext,
  points: readonly Point[],
  closed: boolean,
): void {
  const first = points[0];
  if (first === undefined) return;
  context.beginPath();
  context.moveTo(first.x, first.y);
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    if (point !== undefined) context.lineTo(point.x, point.y);
  }
  if (closed) context.closePath();
}

function dashOffset(primitive: Extract<VisualPrimitive, { kind: "stroke" }>) {
  const length = Math.hypot(
    primitive.originalEnd.x - primitive.originalStart.x,
    primitive.originalEnd.y - primitive.originalStart.y,
  );
  if (length === 0) return 0;
  const unitX = (primitive.originalEnd.x - primitive.originalStart.x) / length;
  const unitY = (primitive.originalEnd.y - primitive.originalStart.y) / length;
  return (
    (primitive.start.x - primitive.originalStart.x) * unitX +
    (primitive.start.y - primitive.originalStart.y) * unitY
  );
}

function configureStroke(
  context: VisualExportCanvasContext,
  primitive: Extract<VisualPrimitive, { kind: "stroke" | "outline" }>,
): void {
  const paint = colorAndAlpha(primitive.strokeColor, primitive.opacity);
  context.strokeStyle = paint.color;
  context.globalAlpha = paint.alpha;
  context.lineWidth = primitive.strokeWidth;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.setLineDash(
    primitive.lineStyle === "dashed"
      ? [...defaultDashPattern(primitive.strokeWidth)]
      : [],
  );
  context.lineDashOffset =
    primitive.kind === "stroke" && primitive.lineStyle === "dashed"
      ? -dashOffset(primitive)
      : 0;
}

function drawText(
  context: VisualExportCanvasContext,
  primitive: TextPrimitive,
): void {
  const layout = textLayout(primitive.text, primitive.fontSize);
  const fill = colorAndAlpha(primitive.color, primitive.opacity);
  const lineX =
    primitive.align === "left"
      ? -layout.width / 2
      : primitive.align === "right"
        ? layout.width / 2
        : 0;
  const firstBaseline = -layout.height / 2 + primitive.fontSize * 0.9;
  context.save();
  context.translate(primitive.point.x, primitive.point.y);
  context.rotate((primitive.rotation * Math.PI) / 180);
  if (primitive.backgroundColor !== null) {
    const background = colorAndAlpha(
      primitive.backgroundColor,
      primitive.opacity,
    );
    context.beginPath();
    context.roundRect(
      -layout.paddedWidth / 2,
      -layout.paddedHeight / 2,
      layout.paddedWidth,
      layout.paddedHeight,
      layout.radius,
    );
    context.fillStyle = background.color;
    context.globalAlpha = background.alpha;
    context.fill();
  }
  context.font = `${primitive.fontWeight} ${primitive.fontSize}px ${BASIC_EXPORT_FONT_FAMILY}`;
  context.textAlign = primitive.align;
  context.textBaseline = "alphabetic";
  context.fillStyle = fill.color;
  context.globalAlpha = fill.alpha;
  for (const [index, line] of layout.lines.entries()) {
    context.fillText(
      line,
      lineX,
      firstBaseline + index * primitive.fontSize * 1.2,
    );
  }
  context.restore();
}

export function canvasTextWorkUnits(
  text: string,
  fontSize: number,
  backgroundVisible: boolean,
): number {
  return textLayout(text, fontSize).lines.length + (backgroundVisible ? 1 : 0);
}

export function canvasPrimitiveWorkUnits(primitive: VisualPrimitive): number {
  return primitive.kind === "text"
    ? canvasTextWorkUnits(
        primitive.text,
        primitive.fontSize,
        primitive.backgroundColor !== null,
      )
    : 1;
}

/**
 * 病理性多行文字按行批次绘制；每批恢复 Canvas 状态后让出控制权，
 * 因此取消不必等待整个文字对象绘制完。
 */
export async function drawVisualTextToCanvasBatched(
  context: VisualExportCanvasContext,
  primitive: TextPrimitive,
  batchSize: number,
  checkpoint: (completedLines: number, totalLines: number) => Promise<void>,
): Promise<void> {
  const layout = textLayout(primitive.text, primitive.fontSize);
  const fill = colorAndAlpha(primitive.color, primitive.opacity);
  const lineX =
    primitive.align === "left"
      ? -layout.width / 2
      : primitive.align === "right"
        ? layout.width / 2
        : 0;
  const firstBaseline = -layout.height / 2 + primitive.fontSize * 0.9;
  if (primitive.backgroundColor !== null) {
    context.save();
    context.translate(primitive.point.x, primitive.point.y);
    context.rotate((primitive.rotation * Math.PI) / 180);
    const background = colorAndAlpha(
      primitive.backgroundColor,
      primitive.opacity,
    );
    context.beginPath();
    context.roundRect(
      -layout.paddedWidth / 2,
      -layout.paddedHeight / 2,
      layout.paddedWidth,
      layout.paddedHeight,
      layout.radius,
    );
    context.fillStyle = background.color;
    context.globalAlpha = background.alpha;
    context.fill();
    context.restore();
  }
  const safeBatchSize = Math.max(1, batchSize);
  for (let start = 0; start < layout.lines.length; start += safeBatchSize) {
    const end = Math.min(layout.lines.length, start + safeBatchSize);
    context.save();
    context.translate(primitive.point.x, primitive.point.y);
    context.rotate((primitive.rotation * Math.PI) / 180);
    context.font = `${primitive.fontWeight} ${primitive.fontSize}px ${BASIC_EXPORT_FONT_FAMILY}`;
    context.textAlign = primitive.align;
    context.textBaseline = "alphabetic";
    context.fillStyle = fill.color;
    context.globalAlpha = fill.alpha;
    for (let index = start; index < end; index += 1) {
      context.fillText(
        layout.lines[index] ?? "",
        lineX,
        firstBaseline + index * primitive.fontSize * 1.2,
      );
    }
    context.restore();
    if (end < layout.lines.length) await checkpoint(end, layout.lines.length);
  }
}

export function prepareVisualExportCanvas(
  context: VisualExportCanvasContext,
  plan: VisualExportPlan,
): void {
  context.save();
  context.setTransform(
    plan.scale,
    0,
    0,
    plan.scale,
    -plan.bounds.minX * plan.scale,
    -plan.bounds.minY * plan.scale,
  );
  context.beginPath();
  context.rect(
    plan.bounds.minX,
    plan.bounds.minY,
    plan.bounds.maxX - plan.bounds.minX,
    plan.bounds.maxY - plan.bounds.minY,
  );
  context.clip();
  if (plan.request.background.kind === "color") {
    const background = colorAndAlpha(plan.request.background.color, 1);
    context.fillStyle = background.color;
    context.globalAlpha = background.alpha;
    context.fillRect(
      plan.bounds.minX,
      plan.bounds.minY,
      plan.bounds.maxX - plan.bounds.minX,
      plan.bounds.maxY - plan.bounds.minY,
    );
  }
}

export function drawVisualPrimitiveToCanvas(
  context: VisualExportCanvasContext,
  primitive: VisualPrimitive,
): void {
  context.save();
  switch (primitive.kind) {
    case "polygon": {
      const paint = colorAndAlpha(primitive.fillColor, primitive.opacity);
      pathPoints(context, primitive.points, true);
      context.fillStyle = paint.color;
      context.globalAlpha = paint.alpha;
      context.fill();
      break;
    }
    case "outline":
      configureStroke(context, primitive);
      pathPoints(context, primitive.points, primitive.closed);
      context.stroke();
      break;
    case "stroke":
      configureStroke(context, primitive);
      context.beginPath();
      context.moveTo(primitive.start.x, primitive.start.y);
      context.lineTo(primitive.end.x, primitive.end.y);
      context.stroke();
      break;
    case "marker": {
      const paint = colorAndAlpha(primitive.color, primitive.opacity);
      context.translate(primitive.point.x, primitive.point.y);
      context.rotate((primitive.rotation * Math.PI) / 180);
      if (primitive.shape === "circle") {
        context.beginPath();
        context.arc(0, 0, primitive.size / 2, 0, Math.PI * 2);
      } else {
        pathPoints(
          context,
          markerPolygon(primitive.shape, primitive.size),
          true,
        );
      }
      context.fillStyle = paint.color;
      context.globalAlpha = paint.alpha;
      context.fill();
      break;
    }
    case "text":
      drawText(context, primitive);
      break;
  }
  context.restore();
}

export function finishVisualExportCanvas(
  context: VisualExportCanvasContext,
): void {
  context.restore();
}
