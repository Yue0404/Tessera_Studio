import type {
  ConnectionData,
  FixedLayerState,
  MapRect,
  MapStyle,
  OverlayData,
  Point,
  ProjectGrid,
  ProjectState,
} from "@tessera/core";
import type {
  GenericModuleResourceIdentity,
  GenericModuleResourceState,
} from "../generic-module-assets.js";

export const PNG_MAX_SIDE = 8192;
export const PNG_MAX_PIXELS = 67_108_864;
export const SVG_MAX_PRIMITIVES = 250_000;
export const SVG_MAX_UTF8_BYTES = 50 * 1024 * 1024;
export const VISUAL_EXPORT_MAX_DERIVED_CELLS = 2_000_000;
export const VISUAL_EXPORT_MAX_PRIMITIVES = 2_000_000;
export const VISUAL_EXPORT_MAX_RESOURCE_BYTES = 32 * 1024 * 1024;

export interface VisualExportResourceReference {
  readonly identity: GenericModuleResourceIdentity;
}

export interface VisualExportPatternReference extends VisualExportResourceReference {
  readonly scale: number;
}

export type VisualExportResourceSnapshot =
  | {
      readonly key: string;
      readonly identity: GenericModuleResourceIdentity;
      readonly kind: "image";
      readonly mimeType: "image/png" | "image/webp";
      readonly bytes: Uint8Array;
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly key: string;
      readonly identity: GenericModuleResourceIdentity;
      readonly kind: "font";
      readonly mimeType: "font/woff2";
      readonly bytes: Uint8Array;
      readonly family: string;
    };

export type VisualExportUiAction =
  "reduce-scale" | "reduce-range" | "tile-export";

export type VisualExportRange =
  | {
      readonly kind: "viewport" | "selection" | "custom";
      readonly bounds: MapRect;
    }
  | { readonly kind: "content-bounds" }
  | { readonly kind: "full-map" };

export type VisualExportBackground =
  | { readonly kind: "transparent" }
  | { readonly kind: "color"; readonly color: string };

interface CommonVisualExportRequest {
  readonly range: VisualExportRange;
  readonly background: VisualExportBackground;
  readonly showGrid: boolean;
}

export type VisualExportRequest =
  | (CommonVisualExportRequest & {
      readonly format: "png";
      readonly scale: 1 | 2 | 4;
    })
  | (CommonVisualExportRequest & { readonly format: "svg" });

export interface VisualExportCanvasCapabilities {
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly maxPixels: number;
  readonly worker: boolean;
  readonly offscreenCanvas2d: boolean;
  readonly offscreenConvertToBlob: boolean;
}

export interface SnapshotCell {
  readonly instanceId: string;
  readonly cellId: string;
  readonly row: number;
  readonly column: number;
  readonly fillColor: string;
  readonly fillOpacity: number;
  readonly label: string | null;
}

export interface SnapshotEdge {
  readonly instanceId: string;
  readonly edgeId: string;
  readonly adjacentCellIds: readonly string[];
  readonly strokeColor: string;
  readonly strokeWidth: number;
  readonly strokeOpacity: number;
  readonly lineStyle: "solid" | "dashed";
  readonly dashPattern?: readonly number[];
  readonly lineCap?: "butt" | "round" | "square";
  readonly persistence: "explicit-style" | "reference-only";
}

export type SnapshotConnection = Readonly<ConnectionData>;
export type SnapshotOverlay = Readonly<OverlayData>;

export interface VisualPrimitiveBase {
  readonly layerId: string;
  readonly zIndex: number;
  readonly orderInLayer: number;
  readonly stableId: string;
  readonly partRank: number;
  readonly resourcePlaceholder?: "pattern" | "marker" | "text";
}

export interface PolygonPrimitive extends VisualPrimitiveBase {
  readonly kind: "polygon";
  readonly points: readonly Point[];
  readonly fillColor: string;
  readonly opacity: number;
  readonly patternResource?: VisualExportPatternReference;
  readonly patternResourceKey?: string;
  readonly patternScale?: number;
}

export interface StrokePrimitive extends VisualPrimitiveBase {
  readonly kind: "stroke";
  readonly originalStart: Point;
  readonly originalEnd: Point;
  readonly start: Point;
  readonly end: Point;
  readonly strokeColor: string;
  readonly strokeWidth: number;
  readonly opacity: number;
  readonly lineStyle: "solid" | "dashed";
  readonly dashPattern?: readonly number[];
  readonly lineCap?: "butt" | "round" | "square";
}

export interface OutlinePrimitive extends VisualPrimitiveBase {
  readonly kind: "outline";
  readonly points: readonly Point[];
  readonly closed: boolean;
  readonly strokeColor: string;
  readonly strokeWidth: number;
  readonly opacity: number;
  readonly lineStyle: "solid" | "dashed";
  readonly dashPattern?: readonly number[];
  readonly lineCap?: "butt" | "round" | "square";
}

export interface MarkerPrimitive extends VisualPrimitiveBase {
  readonly kind: "marker";
  readonly point: Point;
  readonly shape: "circle" | "diamond" | "pin";
  readonly size: number;
  readonly rotation: number;
  readonly color: string;
  readonly opacity: number;
  readonly imageResource?: GenericModuleResourceIdentity;
  readonly imageResourceKey?: string;
}

export interface TextPrimitive extends VisualPrimitiveBase {
  readonly kind: "text";
  readonly point: Point;
  readonly text: string;
  readonly fontSize: number;
  readonly fontWeight: "normal" | "bold";
  readonly align: "left" | "center" | "right";
  readonly rotation: number;
  readonly color: string;
  readonly opacity: number;
  readonly backgroundColor: string | null;
  readonly wrapWidth?: number;
  readonly fontResource?: GenericModuleResourceIdentity;
  readonly fontResourceKey?: string;
}

export type VisualPrimitive =
  | PolygonPrimitive
  | StrokePrimitive
  | OutlinePrimitive
  | MarkerPrimitive
  | TextPrimitive;

export interface VisualExportExtensionSnapshot {
  readonly elementId: string;
  readonly descriptors: readonly VisualPrimitive[];
}

export interface VisualExportExtensionCaptureRenderer {
  readonly elementId: string;
  capture(
    state: Readonly<ProjectState>,
  ): readonly VisualPrimitive[] | undefined;
}

export interface VisualExportCaptureOptions {
  readonly requiredExtensionElementIds?: readonly string[];
  readonly extensionRenderers?: readonly VisualExportExtensionCaptureRenderer[];
  /** 仅捕获精确资源 identity，稍后再按裁剪后的快照显式注入资源字节。 */
  readonly deferResourceCapture?: boolean;
  readonly resolveResource?: (
    identity: GenericModuleResourceIdentity,
  ) => GenericModuleResourceState<unknown, unknown> | undefined;
  readonly prepareResource?: (
    identity: GenericModuleResourceIdentity,
  ) => Promise<unknown>;
}

export interface VisualExportSnapshot {
  readonly projectId: string;
  readonly revision: number;
  readonly grid: Readonly<ProjectGrid>;
  readonly style: Readonly<MapStyle>;
  readonly layers: readonly Readonly<FixedLayerState>[];
  readonly cells: readonly SnapshotCell[];
  readonly edges: readonly SnapshotEdge[];
  readonly connections: readonly SnapshotConnection[];
  readonly overlays: readonly SnapshotOverlay[];
  readonly extensions: readonly VisualExportExtensionSnapshot[];
  readonly resources: readonly VisualExportResourceSnapshot[];
}

export interface VisualExportPlan {
  readonly snapshot: VisualExportSnapshot;
  readonly request: VisualExportRequest;
  readonly bounds: Readonly<MapRect>;
  readonly scale: 1 | 2 | 4;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly estimatedDerivedCells: number;
  readonly estimatedPrimitiveCount: number;
}

export interface VisualExportResult {
  readonly format: "png" | "svg";
  readonly mimeType: "image/png" | "image/svg+xml";
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
  readonly executionMode: "worker" | "fallback" | "svg";
}
