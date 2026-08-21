import type { Point, ProjectState } from "@tessera/core";
import { VisualExportError } from "./error.js";
import type { VisualPrimitive } from "./types.js";

const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/u;

function invalid(
  elementId: string,
  descriptorIndex: number,
  field: string,
): never {
  throw new VisualExportError("visual-export-extension-primitive-invalid", {
    elementId,
    descriptorIndex,
    field,
  });
}

function finitePoint(value: Point): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y)
  );
}

function validColor(value: string): boolean {
  return typeof value === "string" && COLOR_PATTERN.test(value);
}

function validOpacity(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function validNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

/** 扩展 capture 的声明式图元在进入快照前必须满足 Worker 可安全消费的边界。 */
export function assertValidExtensionPrimitive(
  state: Readonly<ProjectState>,
  primitive: VisualPrimitive,
  elementId: string,
  descriptorIndex: number,
): void {
  if (
    primitive === null ||
    typeof primitive !== "object" ||
    typeof primitive.layerId !== "string" ||
    typeof primitive.stableId !== "string" ||
    !["polygon", "outline", "stroke", "marker", "text"].includes(primitive.kind)
  ) {
    invalid(elementId, descriptorIndex, "descriptor");
  }
  const layer = state.layers.get(primitive.layerId);
  if (
    primitive.layerId.length === 0 ||
    layer === undefined ||
    primitive.zIndex !== layer.zIndex
  ) {
    invalid(elementId, descriptorIndex, "layerId");
  }
  if (primitive.stableId.length === 0) {
    invalid(elementId, descriptorIndex, "stableId");
  }
  for (const [field, value] of [
    ["zIndex", primitive.zIndex],
    ["orderInLayer", primitive.orderInLayer],
    ["partRank", primitive.partRank],
  ] as const) {
    if (!Number.isSafeInteger(value))
      invalid(elementId, descriptorIndex, field);
  }

  switch (primitive.kind) {
    case "polygon":
      if (
        !Array.isArray(primitive.points) ||
        primitive.points.length === 0 ||
        !primitive.points.every(finitePoint)
      )
        invalid(elementId, descriptorIndex, "points");
      if (!validColor(primitive.fillColor))
        invalid(elementId, descriptorIndex, "fillColor");
      if (!validOpacity(primitive.opacity))
        invalid(elementId, descriptorIndex, "opacity");
      return;
    case "outline":
      if (
        !Array.isArray(primitive.points) ||
        primitive.points.length === 0 ||
        !primitive.points.every(finitePoint)
      )
        invalid(elementId, descriptorIndex, "points");
      if (!validColor(primitive.strokeColor))
        invalid(elementId, descriptorIndex, "strokeColor");
      if (!validNonNegative(primitive.strokeWidth))
        invalid(elementId, descriptorIndex, "strokeWidth");
      if (!validOpacity(primitive.opacity))
        invalid(elementId, descriptorIndex, "opacity");
      if (primitive.lineStyle !== "solid" && primitive.lineStyle !== "dashed")
        invalid(elementId, descriptorIndex, "lineStyle");
      return;
    case "stroke":
      for (const [field, point] of [
        ["originalStart", primitive.originalStart],
        ["originalEnd", primitive.originalEnd],
        ["start", primitive.start],
        ["end", primitive.end],
      ] as const) {
        if (!finitePoint(point)) invalid(elementId, descriptorIndex, field);
      }
      if (!validColor(primitive.strokeColor))
        invalid(elementId, descriptorIndex, "strokeColor");
      if (!validNonNegative(primitive.strokeWidth))
        invalid(elementId, descriptorIndex, "strokeWidth");
      if (!validOpacity(primitive.opacity))
        invalid(elementId, descriptorIndex, "opacity");
      if (primitive.lineStyle !== "solid" && primitive.lineStyle !== "dashed")
        invalid(elementId, descriptorIndex, "lineStyle");
      return;
    case "marker":
      if (!finitePoint(primitive.point))
        invalid(elementId, descriptorIndex, "point");
      if (!validNonNegative(primitive.size))
        invalid(elementId, descriptorIndex, "size");
      if (!Number.isFinite(primitive.rotation))
        invalid(elementId, descriptorIndex, "rotation");
      if (!validColor(primitive.color))
        invalid(elementId, descriptorIndex, "color");
      if (!validOpacity(primitive.opacity))
        invalid(elementId, descriptorIndex, "opacity");
      if (!["circle", "diamond", "pin"].includes(primitive.shape))
        invalid(elementId, descriptorIndex, "shape");
      return;
    case "text":
      if (!finitePoint(primitive.point))
        invalid(elementId, descriptorIndex, "point");
      if (!validNonNegative(primitive.fontSize))
        invalid(elementId, descriptorIndex, "fontSize");
      if (typeof primitive.text !== "string")
        invalid(elementId, descriptorIndex, "text");
      if (!Number.isFinite(primitive.rotation))
        invalid(elementId, descriptorIndex, "rotation");
      if (!validColor(primitive.color))
        invalid(elementId, descriptorIndex, "color");
      if (
        primitive.backgroundColor !== null &&
        !validColor(primitive.backgroundColor)
      )
        invalid(elementId, descriptorIndex, "backgroundColor");
      if (!validOpacity(primitive.opacity))
        invalid(elementId, descriptorIndex, "opacity");
      if (!["normal", "bold"].includes(primitive.fontWeight))
        invalid(elementId, descriptorIndex, "fontWeight");
      if (!["left", "center", "right"].includes(primitive.align))
        invalid(elementId, descriptorIndex, "align");
  }
}
