import type { MapRect } from "@tessera/core";
import { VisualExportError } from "./error.js";
import {
  estimateVisualScene,
  iterateVisualPrimitives,
  mapVisualBounds,
  visibleContentBounds,
} from "./scene.js";
import {
  PNG_MAX_PIXELS,
  PNG_MAX_SIDE,
  SVG_MAX_PRIMITIVES,
  VISUAL_EXPORT_MAX_DERIVED_CELLS,
  VISUAL_EXPORT_MAX_PRIMITIVES,
  type VisualExportCanvasCapabilities,
  type VisualExportPlan,
  type VisualExportRequest,
  type VisualExportSnapshot,
} from "./types.js";

const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/u;
const SUGGESTED_ACTIONS = [
  "reduce-scale",
  "reduce-range",
  "tile-export",
] as const;

const DEFAULT_CAPABILITIES: VisualExportCanvasCapabilities = {
  maxWidth: PNG_MAX_SIDE,
  maxHeight: PNG_MAX_SIDE,
  maxPixels: PNG_MAX_PIXELS,
  worker: false,
  offscreenCanvas2d: false,
  offscreenConvertToBlob: false,
};

function assertFiniteRect(bounds: Readonly<MapRect>, pointer: string): void {
  if (
    !Number.isFinite(bounds.minX) ||
    !Number.isFinite(bounds.minY) ||
    !Number.isFinite(bounds.maxX) ||
    !Number.isFinite(bounds.maxY) ||
    bounds.minX >= bounds.maxX ||
    bounds.minY >= bounds.maxY
  ) {
    throw new VisualExportError("visual-export-range-invalid", { pointer });
  }
}

function intersectRect(
  left: Readonly<MapRect>,
  right: Readonly<MapRect>,
): MapRect {
  return {
    minX: Math.max(left.minX, right.minX),
    minY: Math.max(left.minY, right.minY),
    maxX: Math.min(left.maxX, right.maxX),
    maxY: Math.min(left.maxY, right.maxY),
  };
}

export function resolveVisualExportBounds(
  snapshot: VisualExportSnapshot,
  range: VisualExportRequest["range"],
): MapRect {
  const mapBounds = mapVisualBounds(snapshot.grid);
  assertFiniteRect(mapBounds, "map");
  let requested: Readonly<MapRect>;
  if (range.kind === "content-bounds") {
    const content = visibleContentBounds(snapshot);
    if (content === null) {
      throw new VisualExportError("visual-export-content-empty", {
        rangeKind: range.kind,
      });
    }
    requested = content;
  } else if (range.kind === "full-map") {
    requested = mapBounds;
  } else {
    requested = range.bounds;
    assertFiniteRect(requested, `range.${range.kind}`);
  }
  const clipped = intersectRect(requested, mapBounds);
  if (clipped.minX >= clipped.maxX || clipped.minY >= clipped.maxY) {
    throw new VisualExportError("visual-export-range-outside-map", {
      rangeKind: range.kind,
    });
  }
  return clipped;
}

function assertCapabilities(
  capabilities: VisualExportCanvasCapabilities,
): void {
  for (const [field, value] of Object.entries({
    maxWidth: capabilities.maxWidth,
    maxHeight: capabilities.maxHeight,
    maxPixels: capabilities.maxPixels,
  })) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new VisualExportError("visual-export-capability-invalid", {
        field,
      });
    }
  }
}

function copyAndFreezeRequest(
  request: VisualExportRequest,
): VisualExportRequest {
  const range =
    request.range.kind === "viewport" ||
    request.range.kind === "selection" ||
    request.range.kind === "custom"
      ? Object.freeze({
          kind: request.range.kind,
          bounds: Object.freeze({ ...request.range.bounds }),
        })
      : Object.freeze({ kind: request.range.kind });
  const background =
    request.background.kind === "color"
      ? Object.freeze({
          kind: request.background.kind,
          color: request.background.color,
        })
      : Object.freeze({ kind: request.background.kind });
  return request.format === "png"
    ? Object.freeze({
        format: request.format,
        range,
        background,
        showGrid: request.showGrid,
        scale: request.scale,
      })
    : Object.freeze({
        format: request.format,
        range,
        background,
        showGrid: request.showGrid,
      });
}

function limitError(
  code: string,
  details: Readonly<Record<string, unknown>>,
  action: "reduce-scale" | "reduce-range" | "tile-export",
): VisualExportError {
  return new VisualExportError(
    code,
    { ...details, suggestedActions: SUGGESTED_ACTIONS },
    action,
  );
}

export function assertSvgNodeLimit(estimatedNodeCount: number): void {
  if (estimatedNodeCount > SVG_MAX_PRIMITIVES) {
    throw limitError(
      "visual-export-svg-primitive-limit-exceeded",
      {
        estimatedPrimitiveCount: estimatedNodeCount,
        maxPrimitives: SVG_MAX_PRIMITIVES,
      },
      "reduce-range",
    );
  }
}

export function planVisualExport(
  snapshot: VisualExportSnapshot,
  request: VisualExportRequest,
  canvasCapabilities: VisualExportCanvasCapabilities = DEFAULT_CAPABILITIES,
): VisualExportPlan {
  if (
    request.format === "png" &&
    !([1, 2, 4] as readonly unknown[]).includes(request.scale)
  ) {
    throw new VisualExportError(
      "visual-export-scale-invalid",
      { scale: request.scale, allowedScales: [1, 2, 4] },
      "reduce-scale",
    );
  }
  if (
    request.background.kind === "color" &&
    !COLOR_PATTERN.test(request.background.color)
  ) {
    throw new VisualExportError("visual-export-background-color-invalid");
  }
  if (
    !Number.isFinite(snapshot.grid.cellSize) ||
    snapshot.grid.cellSize <= 0 ||
    !Number.isSafeInteger(snapshot.grid.width) ||
    snapshot.grid.width < 1 ||
    snapshot.grid.width > 40_000 ||
    !Number.isSafeInteger(snapshot.grid.height) ||
    snapshot.grid.height < 1 ||
    snapshot.grid.height > 40_000
  ) {
    throw new VisualExportError("visual-export-grid-invalid", {
      width: snapshot.grid.width,
      height: snapshot.grid.height,
      cellSize: snapshot.grid.cellSize,
      maxDimension: 40_000,
    });
  }
  const bounds = resolveVisualExportBounds(snapshot, request.range);
  const scale = request.format === "png" ? request.scale : 1;
  const widthValue = (bounds.maxX - bounds.minX) * scale;
  const heightValue = (bounds.maxY - bounds.minY) * scale;
  if (
    !Number.isFinite(widthValue) ||
    !Number.isFinite(heightValue) ||
    widthValue <= 0 ||
    heightValue <= 0 ||
    widthValue > Number.MAX_SAFE_INTEGER ||
    heightValue > Number.MAX_SAFE_INTEGER
  ) {
    throw limitError(
      "visual-export-dimensions-overflow",
      { widthValue, heightValue, scale },
      "reduce-scale",
    );
  }
  const pixelWidth = Math.ceil(widthValue);
  const pixelHeight = Math.ceil(heightValue);
  if (request.format === "png") {
    assertCapabilities(canvasCapabilities);
    const maxWidth = Math.min(PNG_MAX_SIDE, canvasCapabilities.maxWidth);
    const maxHeight = Math.min(PNG_MAX_SIDE, canvasCapabilities.maxHeight);
    const maxPixels = Math.min(PNG_MAX_PIXELS, canvasCapabilities.maxPixels);
    if (pixelWidth > maxWidth || pixelHeight > maxHeight) {
      throw limitError(
        "visual-export-png-side-limit-exceeded",
        { pixelWidth, pixelHeight, maxWidth, maxHeight },
        "reduce-scale",
      );
    }
    const pixels = pixelWidth * pixelHeight;
    if (!Number.isSafeInteger(pixels) || pixels > maxPixels) {
      throw limitError(
        "visual-export-png-pixel-limit-exceeded",
        { pixelWidth, pixelHeight, pixels, maxPixels },
        "reduce-scale",
      );
    }
  }
  const estimate = estimateVisualScene(snapshot, bounds, request);
  if (
    !Number.isSafeInteger(estimate.derivedCells) ||
    estimate.derivedCells > VISUAL_EXPORT_MAX_DERIVED_CELLS
  ) {
    throw limitError(
      "visual-export-derived-cell-limit-exceeded",
      {
        estimatedDerivedCells: estimate.derivedCells,
        maxDerivedCells: VISUAL_EXPORT_MAX_DERIVED_CELLS,
      },
      "reduce-range",
    );
  }
  if (
    !Number.isSafeInteger(estimate.primitives) ||
    estimate.primitives > VISUAL_EXPORT_MAX_PRIMITIVES
  ) {
    throw limitError(
      "visual-export-workload-limit-exceeded",
      {
        estimatedPrimitiveCount: estimate.primitives,
        maxPrimitives: VISUAL_EXPORT_MAX_PRIMITIVES,
      },
      "reduce-range",
    );
  }
  if (request.format === "svg") assertSvgNodeLimit(estimate.primitives);
  const frozenRequest = copyAndFreezeRequest(request);
  const draftPlan: VisualExportPlan = {
    snapshot,
    request: frozenRequest,
    bounds: Object.freeze({ ...bounds }),
    scale,
    pixelWidth,
    pixelHeight,
    estimatedDerivedCells: estimate.derivedCells,
    estimatedPrimitiveCount: estimate.primitives,
  };
  const referencedResourceKeys = new Set<string>();
  for (const primitive of iterateVisualPrimitives(draftPlan)) {
    if (primitive.kind === "polygon" && primitive.patternResourceKey)
      referencedResourceKeys.add(primitive.patternResourceKey);
    else if (primitive.kind === "marker" && primitive.imageResourceKey)
      referencedResourceKeys.add(primitive.imageResourceKey);
    else if (primitive.kind === "text" && primitive.fontResourceKey)
      referencedResourceKeys.add(primitive.fontResourceKey);
  }
  const scopedSnapshot = Object.freeze({
    ...snapshot,
    // 范围外或隐藏图元的包资源不得被带入视觉导出计划。
    resources: Object.freeze(
      snapshot.resources.filter((resource) =>
        referencedResourceKeys.has(resource.key),
      ),
    ),
  });
  return Object.freeze({ ...draftPlan, snapshot: scopedSnapshot });
}
