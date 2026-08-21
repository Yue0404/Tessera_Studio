import type { Point } from "@tessera/core";
import {
  BASIC_EXPORT_FONT_FAMILY,
  defaultDashPattern,
  markerPolygon,
  textLayout,
} from "../visual-style.js";
import { VisualExportError } from "./error.js";
import { iterateVisualPrimitives } from "./scene.js";
import {
  SVG_MAX_PRIMITIVES,
  SVG_MAX_UTF8_BYTES,
  type TextPrimitive,
  type VisualExportPlan,
  type VisualPrimitive,
} from "./types.js";

export interface VisualExportSvgFragment {
  readonly value: string;
  readonly nodes: number;
}

export interface VisualExportSvgLimits {
  readonly maxNodes: number;
  readonly maxUtf8Bytes: number;
}

export interface VisualExportSvgFragmentOptions {
  readonly iteratePrimitives?: () => Iterable<VisualPrimitive>;
}

export const DEFAULT_VISUAL_EXPORT_SVG_LIMITS: VisualExportSvgLimits = {
  maxNodes: SVG_MAX_PRIMITIVES,
  maxUtf8Bytes: SVG_MAX_UTF8_BYTES,
};

const encoder = new TextEncoder();
const SUGGESTED_ACTIONS = [
  "reduce-scale",
  "reduce-range",
  "tile-export",
] as const;

function hasInvalidXmlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint === undefined ||
      codePoint <= 0x08 ||
      codePoint === 0x0b ||
      codePoint === 0x0c ||
      (codePoint >= 0x0e && codePoint <= 0x1f) ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
      codePoint === 0xfffe ||
      codePoint === 0xffff
    ) {
      return true;
    }
  }
  return false;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new VisualExportError("visual-export-svg-number-invalid");
  }
  const normalized = Object.is(value, -0) ? 0 : value;
  return normalized.toFixed(6).replace(/(?:\.0+|(\.\d+?)0+)$/u, "$1");
}

function escapeXml(value: string): string {
  if (hasInvalidXmlCharacter(value)) {
    throw new VisualExportError("visual-export-svg-text-invalid");
  }
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function rgba(value: string, opacity: number) {
  const normalized = value.replace(/^#/u, "");
  if (!/^[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/u.test(normalized)) {
    throw new VisualExportError("visual-export-svg-color-invalid");
  }
  const alpha =
    normalized.length === 8
      ? Number.parseInt(normalized.slice(6), 16) / 255
      : 1;
  return {
    color: `#${normalized.slice(0, 6).toUpperCase()}`,
    opacity: Math.max(0, Math.min(1, alpha * opacity)),
  };
}

function points(value: readonly Point[]): string {
  return value
    .map((point) => `${formatNumber(point.x)},${formatNumber(point.y)}`)
    .join(" ");
}

function paintAttributes(
  name: "fill" | "stroke",
  colorValue: string,
  opacity: number,
): string {
  const color = rgba(colorValue, opacity);
  return `${name}="${color.color}" ${name}-opacity="${formatNumber(color.opacity)}"`;
}

function dashAttributes(
  primitive: Extract<VisualPrimitive, { kind: "stroke" | "outline" }>,
): string {
  if (primitive.lineStyle !== "dashed") return "";
  const pattern = defaultDashPattern(primitive.strokeWidth);
  let offset = 0;
  if (primitive.kind === "stroke") {
    const length = Math.hypot(
      primitive.originalEnd.x - primitive.originalStart.x,
      primitive.originalEnd.y - primitive.originalStart.y,
    );
    if (length > 0) {
      const unitX =
        (primitive.originalEnd.x - primitive.originalStart.x) / length;
      const unitY =
        (primitive.originalEnd.y - primitive.originalStart.y) / length;
      offset =
        (primitive.start.x - primitive.originalStart.x) * unitX +
        (primitive.start.y - primitive.originalStart.y) * unitY;
    }
  }
  return ` stroke-dasharray="${pattern.map(formatNumber).join(" ")}" stroke-dashoffset="${formatNumber(-offset)}"`;
}

function* renderTextFragments(
  primitive: TextPrimitive,
): Generator<VisualExportSvgFragment> {
  const layout = textLayout(primitive.text, primitive.fontSize);
  const fill = rgba(primitive.color, primitive.opacity);
  const anchor =
    primitive.align === "left"
      ? "start"
      : primitive.align === "right"
        ? "end"
        : "middle";
  const lineX =
    primitive.align === "left"
      ? -layout.width / 2
      : primitive.align === "right"
        ? layout.width / 2
        : 0;
  const firstBaseline = -layout.height / 2 + primitive.fontSize * 0.9;
  const transform = `translate(${formatNumber(primitive.point.x)} ${formatNumber(primitive.point.y)}) rotate(${formatNumber(primitive.rotation)})`;
  yield { value: `<g transform="${transform}">`, nodes: 1 };
  if (primitive.backgroundColor !== null) {
    const background = rgba(primitive.backgroundColor, primitive.opacity);
    yield {
      value: `<rect x="${formatNumber(-layout.paddedWidth / 2)}" y="${formatNumber(-layout.paddedHeight / 2)}" width="${formatNumber(layout.paddedWidth)}" height="${formatNumber(layout.paddedHeight)}" rx="${formatNumber(layout.radius)}" ry="${formatNumber(layout.radius)}" fill="${background.color}" fill-opacity="${formatNumber(background.opacity)}"/>`,
      nodes: 1,
    };
  }
  yield {
    value: `<text fill="${fill.color}" fill-opacity="${formatNumber(fill.opacity)}" font-family="${escapeXml(BASIC_EXPORT_FONT_FAMILY)}" font-size="${formatNumber(primitive.fontSize)}" font-weight="${primitive.fontWeight}" text-anchor="${anchor}">`,
    nodes: 1,
  };
  for (const [index, line] of layout.lines.entries()) {
    yield {
      value: `<tspan x="${formatNumber(lineX)}" y="${formatNumber(firstBaseline + index * primitive.fontSize * 1.2)}">${escapeXml(line)}</tspan>`,
      nodes: 1,
    };
  }
  yield { value: "</text></g>", nodes: 0 };
}

function* renderPrimitiveFragments(
  primitive: VisualPrimitive,
): Generator<VisualExportSvgFragment> {
  switch (primitive.kind) {
    case "polygon":
      yield {
        value: `<polygon points="${points(primitive.points)}" ${paintAttributes("fill", primitive.fillColor, primitive.opacity)}/>`,
        nodes: 1,
      };
      return;
    case "outline":
      yield {
        value: `<${primitive.closed ? "polygon" : "polyline"} points="${points(primitive.points)}" fill="none" ${paintAttributes("stroke", primitive.strokeColor, primitive.opacity)} stroke-width="${formatNumber(primitive.strokeWidth)}" stroke-linecap="round" stroke-linejoin="round"${dashAttributes(primitive)}/>`,
        nodes: 1,
      };
      return;
    case "stroke":
      yield {
        value: `<line x1="${formatNumber(primitive.start.x)}" y1="${formatNumber(primitive.start.y)}" x2="${formatNumber(primitive.end.x)}" y2="${formatNumber(primitive.end.y)}" ${paintAttributes("stroke", primitive.strokeColor, primitive.opacity)} stroke-width="${formatNumber(primitive.strokeWidth)}" stroke-linecap="round"${dashAttributes(primitive)}/>`,
        nodes: 1,
      };
      return;
    case "marker": {
      const fill = paintAttributes("fill", primitive.color, primitive.opacity);
      yield primitive.shape === "circle"
        ? {
            value: `<circle cx="${formatNumber(primitive.point.x)}" cy="${formatNumber(primitive.point.y)}" r="${formatNumber(primitive.size / 2)}" ${fill}/>`,
            nodes: 1,
          }
        : {
            value: `<polygon points="${points(markerPolygon(primitive.shape, primitive.size))}" transform="translate(${formatNumber(primitive.point.x)} ${formatNumber(primitive.point.y)}) rotate(${formatNumber(primitive.rotation)})" ${fill}/>`,
            nodes: 1,
          };
      return;
    }
    case "text":
      yield* renderTextFragments(primitive);
  }
}

export function* iterateVisualExportSvgFragments(
  plan: VisualExportPlan,
  options: VisualExportSvgFragmentOptions = {},
): Generator<VisualExportSvgFragment> {
  if (plan.request.format !== "svg") {
    throw new VisualExportError("visual-export-format-mismatch", {
      expected: "svg",
      actual: plan.request.format,
    });
  }
  const width = plan.bounds.maxX - plan.bounds.minX;
  const height = plan.bounds.maxY - plan.bounds.minY;
  yield {
    value: `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${plan.pixelWidth}" height="${plan.pixelHeight}" viewBox="${formatNumber(plan.bounds.minX)} ${formatNumber(plan.bounds.minY)} ${formatNumber(width)} ${formatNumber(height)}" shape-rendering="geometricPrecision"><defs><clipPath id="tessera-export-clip"><rect x="${formatNumber(plan.bounds.minX)}" y="${formatNumber(plan.bounds.minY)}" width="${formatNumber(width)}" height="${formatNumber(height)}"/></clipPath></defs><g clip-path="url(#tessera-export-clip)">`,
    nodes: 5,
  };
  if (plan.request.background.kind === "color") {
    yield {
      value: `<rect x="${formatNumber(plan.bounds.minX)}" y="${formatNumber(plan.bounds.minY)}" width="${formatNumber(width)}" height="${formatNumber(height)}" ${paintAttributes("fill", plan.request.background.color, 1)}/>`,
      nodes: 1,
    };
  }
  const primitives =
    options.iteratePrimitives?.() ?? iterateVisualPrimitives(plan);
  for (const primitive of primitives) {
    yield* renderPrimitiveFragments(primitive);
  }
  yield { value: "</g></svg>", nodes: 0 };
}

function limitError(
  code: string,
  details: Readonly<Record<string, unknown>>,
): VisualExportError {
  return new VisualExportError(
    code,
    { ...details, suggestedActions: SUGGESTED_ACTIONS },
    "reduce-range",
  );
}

export class VisualExportSvgAccumulator {
  readonly #chunks: string[] = [];
  readonly #limits: VisualExportSvgLimits;
  #bytes = 0;
  #nodes = 0;

  constructor(
    limits: VisualExportSvgLimits = DEFAULT_VISUAL_EXPORT_SVG_LIMITS,
  ) {
    this.#limits = limits;
  }

  get bytes(): number {
    return this.#bytes;
  }

  get nodes(): number {
    return this.#nodes;
  }

  append(fragment: VisualExportSvgFragment): void {
    const nextBytes = this.#bytes + encoder.encode(fragment.value).byteLength;
    const nextNodes = this.#nodes + fragment.nodes;
    if (nextNodes > this.#limits.maxNodes) {
      throw limitError("visual-export-svg-primitive-limit-exceeded", {
        actualPrimitives: nextNodes,
        maxPrimitives: this.#limits.maxNodes,
      });
    }
    if (nextBytes > this.#limits.maxUtf8Bytes) {
      throw limitError("visual-export-svg-byte-limit-exceeded", {
        actualBytes: nextBytes,
        maxBytes: this.#limits.maxUtf8Bytes,
      });
    }
    this.#chunks.push(fragment.value);
    this.#bytes = nextBytes;
    this.#nodes = nextNodes;
  }

  toString(): string {
    return this.#chunks.join("");
  }

  toBlob(): Blob {
    return new Blob(this.#chunks, { type: "image/svg+xml;charset=utf-8" });
  }
}

function accumulateSvg(
  plan: VisualExportPlan,
  limits: VisualExportSvgLimits,
  options: VisualExportSvgFragmentOptions = {},
): VisualExportSvgAccumulator {
  const accumulator = new VisualExportSvgAccumulator(limits);
  for (const fragment of iterateVisualExportSvgFragments(plan, options)) {
    accumulator.append(fragment);
  }
  return accumulator;
}

export function serializeVisualExportSvg(
  plan: VisualExportPlan,
  limits: VisualExportSvgLimits = DEFAULT_VISUAL_EXPORT_SVG_LIMITS,
  options: VisualExportSvgFragmentOptions = {},
): string {
  return accumulateSvg(plan, limits, options).toString();
}

export function createVisualExportSvgBlob(
  plan: VisualExportPlan,
  limits: VisualExportSvgLimits = DEFAULT_VISUAL_EXPORT_SVG_LIMITS,
): Blob {
  return accumulateSvg(plan, limits).toBlob();
}
