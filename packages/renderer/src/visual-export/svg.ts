import type { Point } from "@tessera/core";
import {
  BASIC_EXPORT_FONT_FAMILY,
  defaultDashPattern,
  markerPolygon,
  textLayout,
} from "../visual-style.js";
import {
  GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER,
  genericModuleMarkerImageSize,
  genericModulePatternTileSize,
} from "../generic-module-assets.js";
import { VisualExportError } from "./error.js";
import { iterateVisualPrimitives } from "./scene.js";
import {
  SVG_MAX_PRIMITIVES,
  SVG_MAX_UTF8_BYTES,
  type TextPrimitive,
  type VisualExportPlan,
  type VisualExportResourceSnapshot,
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
const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64Bytes(bytes: Uint8Array): string {
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const value = (first << 16) | (second << 8) | third;
    result += BASE64_ALPHABET[(value >> 18) & 63];
    result += BASE64_ALPHABET[(value >> 12) & 63];
    result +=
      index + 1 < bytes.length ? BASE64_ALPHABET[(value >> 6) & 63] : "=";
    result += index + 2 < bytes.length ? BASE64_ALPHABET[value & 63] : "=";
  }
  return result;
}

function resourceDataUri(resource: VisualExportResourceSnapshot): string {
  return `data:${resource.mimeType};base64,${base64Bytes(resource.bytes)}`;
}

function fontFamily(key: string): string {
  return `TesseraExportFont_${key.replaceAll("-", "_")}`;
}

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
  const pattern =
    primitive.dashPattern ?? defaultDashPattern(primitive.strokeWidth);
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
  resources: ReadonlyMap<string, VisualExportResourceSnapshot>,
): Generator<VisualExportSvgFragment> {
  const layout = textLayout(
    primitive.text,
    primitive.fontSize,
    primitive.wrapWidth,
  );
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
  const family =
    primitive.fontResourceKey !== undefined &&
    resources.get(primitive.fontResourceKey)?.kind === "font"
      ? fontFamily(primitive.fontResourceKey)
      : BASIC_EXPORT_FONT_FAMILY;
  yield { value: `<g transform="${transform}">`, nodes: 1 };
  if (primitive.backgroundColor !== null) {
    const background = rgba(primitive.backgroundColor, primitive.opacity);
    yield {
      value: `<rect x="${formatNumber(-layout.paddedWidth / 2)}" y="${formatNumber(-layout.paddedHeight / 2)}" width="${formatNumber(layout.paddedWidth)}" height="${formatNumber(layout.paddedHeight)}" rx="${formatNumber(layout.radius)}" ry="${formatNumber(layout.radius)}" fill="${background.color}" fill-opacity="${formatNumber(background.opacity)}"/>`,
      nodes: 1,
    };
  }
  yield {
    value: `<text fill="${fill.color}" fill-opacity="${formatNumber(fill.opacity)}" font-family="${escapeXml(family)}" font-size="${formatNumber(primitive.fontSize)}" font-weight="${primitive.fontWeight}" text-anchor="${anchor}">`,
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
  resources: ReadonlyMap<string, VisualExportResourceSnapshot>,
  patternIds: ReadonlyMap<string, string>,
): Generator<VisualExportSvgFragment> {
  switch (primitive.kind) {
    case "polygon":
      if (primitive.patternResourceKey !== undefined) {
        const token = `${primitive.patternResourceKey}:${formatNumber(primitive.patternScale ?? 1)}`;
        const patternId = patternIds.get(token);
        if (patternId !== undefined) {
          const fill = rgba(primitive.fillColor, primitive.opacity);
          yield {
            value: `<polygon points="${points(primitive.points)}" fill="url(#${patternId})" fill-opacity="${formatNumber(fill.opacity)}"/>`,
            nodes: 1,
          };
          return;
        }
      }
      yield {
        value:
          primitive.resourcePlaceholder === "pattern"
            ? `<polygon points="${points(primitive.points)}" ${paintAttributes("fill", primitive.fillColor, primitive.opacity)} ${paintAttributes("stroke", GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER.secondaryColor, 1)} stroke-width="${formatNumber(GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER.strokeWidth)}" stroke-dasharray="${GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER.strokeDashPattern.join(" ")}"/>`
            : `<polygon points="${points(primitive.points)}" ${paintAttributes("fill", primitive.fillColor, primitive.opacity)}/>`,
        nodes: 1,
      };
      return;
    case "outline":
      yield {
        value: `<${primitive.closed ? "polygon" : "polyline"} points="${points(primitive.points)}" fill="none" ${paintAttributes("stroke", primitive.strokeColor, primitive.opacity)} stroke-width="${formatNumber(primitive.strokeWidth)}" stroke-linecap="${primitive.lineCap ?? "round"}" stroke-linejoin="round"${dashAttributes(primitive)}/>`,
        nodes: 1,
      };
      return;
    case "stroke":
      yield {
        value: `<line x1="${formatNumber(primitive.start.x)}" y1="${formatNumber(primitive.start.y)}" x2="${formatNumber(primitive.end.x)}" y2="${formatNumber(primitive.end.y)}" ${paintAttributes("stroke", primitive.strokeColor, primitive.opacity)} stroke-width="${formatNumber(primitive.strokeWidth)}" stroke-linecap="${primitive.lineCap ?? "round"}"${dashAttributes(primitive)}/>`,
        nodes: 1,
      };
      return;
    case "marker": {
      const fill = paintAttributes("fill", primitive.color, primitive.opacity);
      const image =
        primitive.imageResourceKey === undefined
          ? undefined
          : resources.get(primitive.imageResourceKey);
      if (image?.kind === "image") {
        const size = genericModuleMarkerImageSize(
          image.width,
          image.height,
          primitive.size,
        );
        yield {
          value: `<use href="#asset-${image.key}" x="${formatNumber(-size.width / 2)}" y="${formatNumber(-size.height / 2)}" width="${formatNumber(size.width)}" height="${formatNumber(size.height)}" transform="translate(${formatNumber(primitive.point.x)} ${formatNumber(primitive.point.y)}) rotate(${formatNumber(primitive.rotation)})" opacity="${formatNumber(rgba(primitive.color, primitive.opacity).opacity)}"/>`,
          nodes: 1,
        };
        return;
      }
      if (primitive.resourcePlaceholder === "marker") {
        const cross =
          primitive.size *
          GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER.markerCrossRatio;
        yield {
          value: `<g transform="translate(${formatNumber(primitive.point.x)} ${formatNumber(primitive.point.y)}) rotate(${formatNumber(primitive.rotation)})"><polygon points="${points(markerPolygon("diamond", primitive.size))}" ${fill}/><path d="M ${formatNumber(-cross)} ${formatNumber(-cross)} L ${formatNumber(cross)} ${formatNumber(cross)} M ${formatNumber(cross)} ${formatNumber(-cross)} L ${formatNumber(-cross)} ${formatNumber(cross)}" fill="none" ${paintAttributes("stroke", GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER.secondaryColor, 1)} stroke-width="${formatNumber(GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER.strokeWidth)}"/></g>`,
          nodes: 3,
        };
        return;
      }
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
      yield* renderTextFragments(primitive, resources);
  }
}

function visualExportResourceDefinitions(plan: VisualExportPlan): {
  readonly fragments: readonly VisualExportSvgFragment[];
  readonly resources: ReadonlyMap<string, VisualExportResourceSnapshot>;
  readonly patternIds: ReadonlyMap<string, string>;
} {
  const resources = new Map(
    plan.snapshot.resources.map((resource) => [resource.key, resource]),
  );
  const patterns = new Map<string, Readonly<{ key: string; scale: number }>>();
  for (const primitive of iterateVisualPrimitives(plan)) {
    if (
      primitive.kind === "polygon" &&
      primitive.patternResourceKey !== undefined &&
      resources.get(primitive.patternResourceKey)?.kind === "image"
    ) {
      const scale = primitive.patternScale ?? 1;
      patterns.set(`${primitive.patternResourceKey}:${formatNumber(scale)}`, {
        key: primitive.patternResourceKey,
        scale,
      });
    }
  }
  const orderedPatterns = [...patterns.entries()].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  const patternIds = new Map(
    orderedPatterns.map(([token], index) => [token, `pattern-${index}`]),
  );
  const fragments: VisualExportSvgFragment[] = [];
  for (const resource of plan.snapshot.resources) {
    if (resource.kind === "image") {
      fragments.push({
        value: `<image id="asset-${resource.key}" href="${resourceDataUri(resource)}" width="${formatNumber(resource.width)}" height="${formatNumber(resource.height)}"/>`,
        nodes: 1,
      });
    } else {
      fragments.push({
        value: `<style>@font-face{font-family:${fontFamily(resource.key)};src:url(${resourceDataUri(resource)}) format("woff2")}</style>`,
        nodes: 1,
      });
    }
  }
  for (const [token, pattern] of orderedPatterns) {
    const resource = resources.get(pattern.key);
    if (resource?.kind !== "image") continue;
    const tile = genericModulePatternTileSize(
      resource.width,
      resource.height,
      pattern.scale,
    );
    fragments.push({
      value: `<pattern id="${patternIds.get(token) ?? "pattern-invalid"}" patternUnits="userSpaceOnUse" x="0" y="0" width="${formatNumber(tile.width)}" height="${formatNumber(tile.height)}"><use href="#asset-${resource.key}" width="${formatNumber(resource.width)}" height="${formatNumber(resource.height)}" transform="scale(${formatNumber(pattern.scale)})"/></pattern>`,
      nodes: 2,
    });
  }
  return { fragments, resources, patternIds };
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
  const resourceDefinitions = visualExportResourceDefinitions(plan);
  yield {
    value: `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${plan.pixelWidth}" height="${plan.pixelHeight}" viewBox="${formatNumber(plan.bounds.minX)} ${formatNumber(plan.bounds.minY)} ${formatNumber(width)} ${formatNumber(height)}" shape-rendering="geometricPrecision"><defs><clipPath id="tessera-export-clip"><rect x="${formatNumber(plan.bounds.minX)}" y="${formatNumber(plan.bounds.minY)}" width="${formatNumber(width)}" height="${formatNumber(height)}"/></clipPath>`,
    nodes: 4,
  };
  yield* resourceDefinitions.fragments;
  yield { value: `</defs><g clip-path="url(#tessera-export-clip)">`, nodes: 1 };
  if (plan.request.background.kind === "color") {
    yield {
      value: `<rect x="${formatNumber(plan.bounds.minX)}" y="${formatNumber(plan.bounds.minY)}" width="${formatNumber(width)}" height="${formatNumber(height)}" ${paintAttributes("fill", plan.request.background.color, 1)}/>`,
      nodes: 1,
    };
  }
  const primitives =
    options.iteratePrimitives?.() ?? iterateVisualPrimitives(plan);
  for (const primitive of primitives) {
    yield* renderPrimitiveFragments(
      primitive,
      resourceDefinitions.resources,
      resourceDefinitions.patternIds,
    );
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
