import {
  axialToOddR,
  cellId,
  cellPolygon,
  edgeIdentity,
  oddRToAxial,
  parseCellId,
  type CellCoordinate,
  type GridType,
  type Point,
  type ProjectGrid,
} from "@tessera/core";
import { computeProjectContentBounds } from "./content-bounds.js";
import {
  compareCellId,
  compareLayerInstance,
  compareStableId,
} from "./deterministic-order.js";
import type { FragmentV1Document, ProjectV1Document } from "./format-types.js";
import { validateFragmentDocumentV1 } from "./fragment-format.js";
import { validateProjectDocumentV1 } from "./project-format.js";
import { isMapPointInsideGrid } from "./semantic-helpers.js";

type PrimitiveKind =
  | "cell"
  | "edge"
  | "marker-overlay"
  | "text-overlay"
  | "line"
  | "arrow"
  | "domain-group";
type AnchorKind = "cell" | "edge" | "map-point";
type EndpointKind = "cell-center" | "edge-midpoint" | "map-point";

export interface ResolvedElementContract {
  readonly elementId: string;
  readonly layerId: string;
  readonly primitive: PrimitiveKind;
  readonly supportedGrids: readonly GridType[];
  readonly anchors?: readonly AnchorKind[];
  readonly endpoints?: readonly EndpointKind[];
}

export interface ResolvedLayerContract {
  readonly layerId: string;
  readonly zIndex: number;
  readonly allowedPrimitives: readonly PrimitiveKind[];
  readonly allowedAnchors: readonly (AnchorKind | EndpointKind)[];
}

export interface ResolvedModuleContract {
  readonly moduleId: string;
  readonly version: string;
  readonly appVersionSupported: boolean;
  readonly supportedGrids: readonly GridType[];
  readonly layers: readonly ResolvedLayerContract[];
  readonly elements: readonly ResolvedElementContract[];
}

export interface FragmentModuleResolver {
  resolve(request: {
    readonly moduleId: string;
    readonly version: string;
    readonly appVersion: string;
    readonly gridType: GridType;
  }): ResolvedModuleContract | undefined;
}

export class FragmentMergeError extends Error {
  constructor(
    readonly code: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(code);
    this.name = "FragmentMergeError";
  }
}

export interface FragmentMergeIssue {
  readonly severity: "warning" | "hard";
  readonly code: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export type FragmentMergePreflight =
  | {
      readonly status: "ready";
      readonly warnings: readonly FragmentMergeIssue[];
    }
  | {
      readonly status: "install-required";
      readonly missingModules: readonly { moduleId: string; version: string }[];
    }
  | {
      readonly status: "blocked";
      readonly code: string;
      readonly details: Readonly<Record<string, unknown>>;
    };

export type FragmentTranslation =
  | {
      readonly kind: "square";
      readonly deltaRow: number;
      readonly deltaColumn: number;
    }
  | {
      readonly kind: "hex-pointy";
      readonly deltaQ: number;
      readonly deltaR: number;
    };

export interface FragmentMergeRuleContext {
  readonly target: ProjectV1Document;
  readonly fragment: FragmentV1Document;
  readonly translatedObjects: FragmentV1Document["objects"];
}

export interface FragmentMergeRule {
  evaluate(context: FragmentMergeRuleContext): readonly FragmentMergeIssue[];
}

export interface FragmentMergeOptions {
  readonly currentAppVersion: string;
  readonly resolver?: FragmentModuleResolver;
  readonly rules?: readonly FragmentMergeRule[];
}

export interface FragmentMergePreview {
  readonly sourceBounds: FragmentV1Document["fragmentBounds"];
  readonly transformedBounds: FragmentV1Document["fragmentBounds"];
  readonly targetMapBounds: FragmentV1Document["fragmentBounds"];
  readonly objectCounts: {
    readonly cells: number;
    readonly edges: number;
    readonly connections: number;
    readonly overlays: number;
    readonly domainGroups: number;
    readonly embeddedAssets: number;
  };
  readonly zeroTranslation: boolean;
}

export type FragmentMergePlan =
  | {
      readonly status: "ready";
      readonly translation: FragmentTranslation;
      readonly warnings: readonly FragmentMergeIssue[];
      readonly preview: FragmentMergePreview;
    }
  | {
      readonly status: "requires-translation";
      readonly translation: null;
      readonly warnings: readonly FragmentMergeIssue[];
      readonly preview: FragmentMergePreview;
    }
  | {
      readonly status: "blocked";
      readonly code: string;
      readonly details: Readonly<Record<string, unknown>>;
      readonly warnings: readonly FragmentMergeIssue[];
    }
  | {
      readonly status: "cancelled";
      readonly warnings: readonly FragmentMergeIssue[];
      readonly preview?: FragmentMergePreview;
    };

export interface FragmentIdRemap {
  readonly instances: Readonly<Record<string, string>>;
  readonly assets: Readonly<Record<string, string>>;
  readonly deduplicatedStructuralInstances: Readonly<
    Record<string, string | null>
  >;
}

export interface FragmentMergeResult {
  readonly project: ProjectV1Document;
  readonly transactionId: string;
  readonly historyIntent: {
    readonly kind: "fragment-merge";
    readonly transactionId: string;
    readonly fragmentId: string;
    readonly sourceProjectId: string;
    readonly affectedCollections: readonly [
      "project-metadata",
      "chunks",
      "edges",
      "connections",
      "overlays",
      "domainGroups",
      "embeddedAssets",
    ];
  };
  readonly idRemap: FragmentIdRemap;
  readonly warnings: readonly FragmentMergeIssue[];
}

export type FragmentMergeApplyStep =
  | "after-id-remap"
  | "after-cell-merge"
  | "after-edge-merge"
  | "before-validation";

export interface FragmentMergeApplyOptions extends FragmentMergeOptions {
  readonly uuidGenerator?: () => string;
  readonly now?: () => string;
  readonly failureHook?: (step: FragmentMergeApplyStep) => void;
}

const BASIC_LAYERS = [
  {
    layerId: "tessera.basic.cell-style",
    zIndex: 500,
    allowedPrimitives: ["cell"],
    allowedAnchors: ["cell"],
  },
  {
    layerId: "tessera.basic.edge-style",
    zIndex: 1500,
    allowedPrimitives: ["edge"],
    allowedAnchors: ["edge"],
  },
  {
    layerId: "tessera.basic.placed-object",
    zIndex: 3000,
    allowedPrimitives: ["marker-overlay"],
    allowedAnchors: ["cell", "edge", "map-point"],
  },
  {
    layerId: "tessera.basic.connection",
    zIndex: 4300,
    allowedPrimitives: ["line", "arrow"],
    allowedAnchors: ["cell-center", "edge-midpoint", "map-point"],
  },
  {
    layerId: "tessera.basic.annotation",
    zIndex: 4400,
    allowedPrimitives: ["text-overlay"],
    allowedAnchors: ["cell", "edge", "map-point"],
  },
] as const;

const BASIC_ELEMENTS: readonly ResolvedElementContract[] = [
  {
    elementId: "tessera.basic:cell.color",
    layerId: "tessera.basic.cell-style",
    primitive: "cell",
    supportedGrids: ["square", "hex-pointy"],
    anchors: ["cell"],
  },
  {
    elementId: "tessera.basic:edge.style",
    layerId: "tessera.basic.edge-style",
    primitive: "edge",
    supportedGrids: ["square", "hex-pointy"],
    anchors: ["edge"],
  },
  {
    elementId: "tessera.basic:marker",
    layerId: "tessera.basic.placed-object",
    primitive: "marker-overlay",
    supportedGrids: ["square", "hex-pointy"],
    anchors: ["cell", "edge", "map-point"],
  },
  {
    elementId: "tessera.basic:text",
    layerId: "tessera.basic.annotation",
    primitive: "text-overlay",
    supportedGrids: ["square", "hex-pointy"],
    anchors: ["cell", "edge", "map-point"],
  },
  {
    elementId: "tessera.basic:connection.line",
    layerId: "tessera.basic.connection",
    primitive: "line",
    supportedGrids: ["square", "hex-pointy"],
    endpoints: ["cell-center", "edge-midpoint", "map-point"],
  },
  {
    elementId: "tessera.basic:connection.arrow",
    layerId: "tessera.basic.connection",
    primitive: "arrow",
    supportedGrids: ["square", "hex-pointy"],
    endpoints: ["cell-center", "edge-midpoint", "map-point"],
  },
];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SEMVER_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isGridType(value: unknown): value is GridType {
  return value === "square" || value === "hex-pointy";
}

function validContract(value: unknown): value is ResolvedModuleContract {
  if (!isRecord(value)) return false;
  if (
    typeof value.moduleId !== "string" ||
    typeof value.version !== "string" ||
    typeof value.appVersionSupported !== "boolean" ||
    !Array.isArray(value.supportedGrids) ||
    !value.supportedGrids.every(isGridType) ||
    !Array.isArray(value.layers) ||
    !Array.isArray(value.elements)
  ) {
    return false;
  }
  const primitiveKinds = new Set<PrimitiveKind>([
    "cell",
    "edge",
    "marker-overlay",
    "text-overlay",
    "line",
    "arrow",
    "domain-group",
  ]);
  const anchorKinds = new Set<AnchorKind | EndpointKind>([
    "cell",
    "edge",
    "map-point",
    "cell-center",
    "edge-midpoint",
  ]);
  return (
    value.layers.every(
      (layer) =>
        isRecord(layer) &&
        typeof layer.layerId === "string" &&
        typeof layer.zIndex === "number" &&
        Number.isFinite(layer.zIndex) &&
        Array.isArray(layer.allowedPrimitives) &&
        layer.allowedPrimitives.every((primitive) =>
          primitiveKinds.has(primitive as PrimitiveKind),
        ) &&
        Array.isArray(layer.allowedAnchors) &&
        layer.allowedAnchors.every((anchor) =>
          anchorKinds.has(anchor as AnchorKind | EndpointKind),
        ),
    ) &&
    value.elements.every(
      (element) =>
        isRecord(element) &&
        typeof element.elementId === "string" &&
        typeof element.layerId === "string" &&
        primitiveKinds.has(element.primitive as PrimitiveKind) &&
        Array.isArray(element.supportedGrids) &&
        element.supportedGrids.every(isGridType) &&
        (element.anchors === undefined ||
          (Array.isArray(element.anchors) &&
            element.anchors.every((anchor) =>
              anchorKinds.has(anchor as AnchorKind),
            ))) &&
        (element.endpoints === undefined ||
          (Array.isArray(element.endpoints) &&
            element.endpoints.every((endpoint) =>
              anchorKinds.has(endpoint as EndpointKind),
            ))),
    )
  );
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

function blocked(
  code: string,
  details: Readonly<Record<string, unknown>> = {},
): FragmentMergePreflight {
  return { status: "blocked", code, details };
}

function resolveContract(
  moduleId: string,
  version: string,
  target: ProjectV1Document,
  currentAppVersion: string,
  resolver: FragmentModuleResolver | undefined,
): ResolvedModuleContract | undefined {
  if (moduleId === "tessera.basic" && version === "1.0.0") {
    return {
      moduleId,
      version,
      appVersionSupported: true,
      supportedGrids: ["square", "hex-pointy"],
      layers: BASIC_LAYERS,
      elements: BASIC_ELEMENTS,
    };
  }
  return resolver?.resolve({
    moduleId,
    version,
    appVersion: currentAppVersion,
    gridType: target.grid.type,
  });
}

function moduleIdOf(elementId: string): string {
  return elementId.slice(0, elementId.indexOf(":"));
}

function primitiveEntries(fragment: FragmentV1Document): readonly {
  elementId: string;
  layerId: string;
  primitive: PrimitiveKind;
  anchors: readonly (AnchorKind | EndpointKind)[];
}[] {
  const objects = fragment.objects as any;
  return [
    ...objects.cellOverrides.flatMap((cell: any) =>
      cell.layerInstances.map((instance: any) => ({
        ...instance,
        primitive: "cell" as const,
        anchors: ["cell" as const],
      })),
    ),
    ...objects.edges.flatMap((edge: any) =>
      edge.layerInstances.map((instance: any) => ({
        ...instance,
        primitive: "edge" as const,
        anchors: ["edge" as const],
      })),
    ),
    ...objects.overlays.map((overlay: any) => ({
      ...overlay,
      primitive: `${overlay.overlayType}-overlay` as PrimitiveKind,
      anchors: [
        overlay.kind === "free-overlay" ? "map-point" : overlay.anchor.kind,
      ],
    })),
    ...objects.connections.map((connection: any) => ({
      ...connection,
      primitive: connection.kind as PrimitiveKind,
      anchors: [connection.start.kind, connection.end.kind],
    })),
    ...objects.domainGroups.map((group: any) => ({
      ...group,
      primitive: "domain-group" as const,
      anchors: ["cell" as const],
    })),
  ];
}

/** 预检只读依赖和格式，不安装包，也不修改任一输入。 */
export function preflightFragmentMerge(
  target: ProjectV1Document,
  fragment: FragmentV1Document,
  options: FragmentMergeOptions,
): FragmentMergePreflight {
  if (!SEMVER_PATTERN.test(options.currentAppVersion)) {
    return blocked("current-app-version-invalid", {
      currentAppVersion: options.currentAppVersion,
    });
  }
  try {
    validateProjectDocumentV1(target);
    validateFragmentDocumentV1(fragment);
  } catch (error) {
    return blocked("fragment-merge-input-invalid", {
      causeCode:
        error !== null && typeof error === "object" && "code" in error
          ? String(error.code)
          : "unknown",
    });
  }
  if (target.grid.type !== fragment.sourceGrid.type) {
    return blocked("fragment-grid-type-incompatible");
  }
  if (target.grid.orientation !== fragment.sourceGrid.orientation) {
    return blocked("fragment-grid-orientation-incompatible");
  }
  if (
    target.grid.coordinateEncoding !== fragment.sourceGrid.coordinateEncoding
  ) {
    return blocked("fragment-coordinate-encoding-incompatible");
  }
  if (!Object.is(target.grid.cellSize, fragment.sourceGrid.cellSize)) {
    return blocked("fragment-cell-size-incompatible");
  }

  const targetModules = new Map(
    target.modules.map((module) => [module.moduleId, module]),
  );
  const missingModules: { moduleId: string; version: string }[] = [];
  const contracts = new Map<string, ResolvedModuleContract>();
  for (const required of fragment.requiredModules) {
    const enabled = targetModules.get(required.moduleId);
    if (enabled === undefined) {
      missingModules.push({
        moduleId: required.moduleId,
        version: required.version,
      });
      continue;
    }
    if (enabled.version !== required.version) {
      return blocked("migration-execution-not-supported", {
        moduleId: required.moduleId,
        requiredVersion: required.version,
        enabledVersion: enabled.version,
      });
    }
    let contract: ResolvedModuleContract | undefined;
    try {
      contract = resolveContract(
        required.moduleId,
        required.version,
        target,
        options.currentAppVersion,
        options.resolver,
      );
    } catch {
      return blocked("module-resolver-failed", {
        moduleId: required.moduleId,
        version: required.version,
      });
    }
    if (contract !== undefined && !validContract(contract)) {
      return blocked("module-contract-invalid", {
        moduleId: required.moduleId,
        version: required.version,
      });
    }
    if (contract === undefined) {
      return blocked("module-contract-unavailable", {
        moduleId: required.moduleId,
        version: required.version,
      });
    }
    if (
      contract.moduleId !== required.moduleId ||
      contract.version !== required.version
    ) {
      return blocked("module-contract-identity-mismatch", {
        moduleId: required.moduleId,
      });
    }
    if (!contract.appVersionSupported) {
      return blocked("module-app-version-incompatible", {
        moduleId: required.moduleId,
        appVersion: options.currentAppVersion,
      });
    }
    if (!contract.supportedGrids.includes(target.grid.type)) {
      return blocked("module-grid-incompatible", {
        moduleId: required.moduleId,
        gridType: target.grid.type,
      });
    }
    contracts.set(required.moduleId, contract);
  }
  if (missingModules.length > 0) {
    return {
      status: "install-required",
      missingModules: missingModules.sort((left, right) =>
        compareStableId(left.moduleId, right.moduleId),
      ),
    };
  }

  const targetLayers = new Map(
    target.layerStates.map((layer) => [layer.layerId, layer]),
  );
  for (const layerId of fragment.requiredLayerIds) {
    const targetLayer = targetLayers.get(layerId);
    if (targetLayer === undefined) {
      return blocked("fragment-layer-missing", { layerId });
    }
    if (
      target.exportScope === "partial" &&
      !target.lineage?.includedLayerIds.includes(layerId)
    ) {
      return blocked("fragment-target-scope-layer-omitted", { layerId });
    }
    const ownerModule = [...target.modules]
      .filter(
        (module) =>
          module.version === targetLayer.moduleVersion &&
          layerId.startsWith(`${module.moduleId}.`),
      )
      .sort((left, right) => right.moduleId.length - left.moduleId.length)[0];
    const contract =
      ownerModule === undefined
        ? undefined
        : contracts.get(ownerModule.moduleId);
    const contractLayer = contract?.layers.find(
      (layer) => layer.layerId === layerId,
    );
    if (
      contractLayer === undefined ||
      contractLayer.zIndex !== targetLayer.zIndex ||
      contract?.version !== targetLayer.moduleVersion
    ) {
      return blocked("fragment-layer-contract-incompatible", { layerId });
    }
  }

  for (const entry of primitiveEntries(fragment)) {
    const contract = contracts.get(moduleIdOf(entry.elementId));
    if (contract === undefined) {
      return blocked("fragment-element-contract-incompatible", {
        elementId: entry.elementId,
        primitive: entry.primitive,
      });
    }
    const element = contract?.elements.find(
      (candidate) =>
        candidate.elementId === entry.elementId &&
        candidate.primitive === entry.primitive,
    );
    if (
      element === undefined ||
      element.primitive !== entry.primitive ||
      element.layerId !== entry.layerId ||
      !element.supportedGrids.includes(target.grid.type)
    ) {
      return blocked("fragment-element-contract-incompatible", {
        elementId: entry.elementId,
        primitive: entry.primitive,
      });
    }
    const allowed =
      entry.primitive === "line" || entry.primitive === "arrow"
        ? element.endpoints
        : element.anchors;
    const layer = contract.layers.find(
      (candidate) => candidate.layerId === entry.layerId,
    );
    if (
      layer === undefined ||
      !layer.allowedPrimitives.includes(entry.primitive) ||
      entry.anchors.some(
        (anchor) =>
          !allowed?.some((candidate) => candidate === anchor) ||
          !layer.allowedAnchors.some((candidate) => candidate === anchor),
      )
    ) {
      return blocked("fragment-anchor-contract-incompatible", {
        elementId: entry.elementId,
      });
    }
  }
  return { status: "ready", warnings: [] };
}

function zeroTranslation(type: GridType): FragmentTranslation {
  return type === "square"
    ? { kind: "square", deltaRow: 0, deltaColumn: 0 }
    : { kind: "hex-pointy", deltaQ: 0, deltaR: 0 };
}

function validTranslation(
  type: GridType,
  translation: FragmentTranslation,
): boolean {
  if (translation.kind !== type) return false;
  return translation.kind === "square"
    ? Number.isSafeInteger(translation.deltaRow) &&
        Number.isSafeInteger(translation.deltaColumn)
    : Number.isSafeInteger(translation.deltaQ) &&
        Number.isSafeInteger(translation.deltaR);
}

function translateCoordinate(
  type: GridType,
  coordinate: CellCoordinate,
  translation: FragmentTranslation,
): CellCoordinate {
  if (type === "square" && translation.kind === "square") {
    return {
      row: coordinate.row + translation.deltaRow,
      column: coordinate.column + translation.deltaColumn,
    };
  }
  if (type === "hex-pointy" && translation.kind === "hex-pointy") {
    const axial = oddRToAxial(coordinate);
    return axialToOddR({
      q: axial.q + translation.deltaQ,
      r: axial.r + translation.deltaR,
    });
  }
  throw new FragmentMergeError("fragment-translation-kind-incompatible");
}

function pointDelta(
  grid: ProjectGrid,
  translation: FragmentTranslation,
): Point {
  if (translation.kind === "square") {
    return {
      x: translation.deltaColumn * grid.cellSize,
      y: translation.deltaRow * grid.cellSize,
    };
  }
  return {
    x:
      Math.sqrt(3) *
      grid.cellSize *
      (translation.deltaQ + translation.deltaR / 2),
    y: 1.5 * grid.cellSize * translation.deltaR,
  };
}

function translatePoint(point: Point, delta: Point): Point {
  return { x: point.x + delta.x, y: point.y + delta.y };
}

function coordinateInside(
  grid: ProjectGrid,
  coordinate: CellCoordinate,
): boolean {
  return (
    coordinate.row >= 0 &&
    coordinate.column >= 0 &&
    coordinate.row < grid.height &&
    coordinate.column < grid.width
  );
}

function translatedCellId(
  sourceType: GridType,
  value: string,
  translation: FragmentTranslation,
): string {
  const source = parseCellId(value);
  const translated = translateCoordinate(sourceType, source, translation);
  return cellId(sourceType, translated.row, translated.column);
}

const SQUARE_BOUNDARY_SIDES = ["top", "right", "bottom", "left"] as const;
const HEX_BOUNDARY_SIDES = [
  "upper-right",
  "right",
  "lower-right",
  "lower-left",
  "left",
  "upper-left",
] as const;

function translatedEdgeIdentity(
  sourceGrid: ProjectGrid,
  targetGrid: ProjectGrid,
  edge: any,
  translation: FragmentTranslation,
): { edgeId: string; adjacentCellIds: string[] } {
  const translatedAdjacent = edge.adjacentCellIds.map((value: string) =>
    translatedCellId(sourceGrid.type, value, translation),
  );
  const first = parseCellId(translatedAdjacent[0]);
  if (edge.adjacentCellIds.length === 1) {
    const boundary = String(edge.edgeId).split("|boundary:")[1];
    const sides =
      sourceGrid.type === "square" ? SQUARE_BOUNDARY_SIDES : HEX_BOUNDARY_SIDES;
    const side = sides.findIndex((value) => value === boundary);
    if (side < 0) {
      throw new FragmentMergeError("fragment-edge-boundary-invalid", {
        edgeId: edge.edgeId,
      });
    }
    return edgeIdentity(targetGrid, first, side);
  }
  const expected = [...translatedAdjacent].sort(compareStableId);
  const sideCount = sourceGrid.type === "square" ? 4 : 6;
  for (let side = 0; side < sideCount; side += 1) {
    const identity = edgeIdentity(targetGrid, first, side);
    if (
      identity.adjacentCellIds.length === expected.length &&
      [...identity.adjacentCellIds]
        .sort(compareStableId)
        .every((value, index) => value === expected[index])
    ) {
      return identity;
    }
  }
  throw new FragmentMergeError("fragment-edge-translation-invalid", {
    edgeId: edge.edgeId,
  });
}

interface TranslatedObjects {
  readonly objects: any;
  readonly edgeIdMap: ReadonlyMap<string, string>;
}

function translateObjects(
  target: ProjectV1Document,
  fragment: FragmentV1Document,
  translation: FragmentTranslation,
): TranslatedObjects {
  const sourceGrid = fragment.sourceGrid as ProjectGrid;
  const targetGrid = target.grid as ProjectGrid;
  const delta = pointDelta(sourceGrid, translation);
  const edgeIdMap = new Map<string, string>();
  const edges = (fragment.objects.edges as any[]).map((edge) => {
    const identity = translatedEdgeIdentity(
      sourceGrid,
      targetGrid,
      edge,
      translation,
    );
    edgeIdMap.set(edge.edgeId, identity.edgeId);
    return {
      ...structuredClone(edge),
      edgeId: identity.edgeId,
      adjacentCellIds: identity.adjacentCellIds,
    };
  });
  const rewriteEndpoint = (endpoint: any): any => {
    if (endpoint.kind === "cell-center") {
      return {
        ...structuredClone(endpoint),
        cellId: translatedCellId(sourceGrid.type, endpoint.cellId, translation),
      };
    }
    if (endpoint.kind === "edge-midpoint") {
      return {
        ...structuredClone(endpoint),
        edgeId: edgeIdMap.get(endpoint.edgeId),
      };
    }
    return {
      ...structuredClone(endpoint),
      point: translatePoint(endpoint.point, delta),
    };
  };
  const cellOverrides = (fragment.objects.cellOverrides as any[]).map(
    (cell) => ({
      ...structuredClone(cell),
      cellId: translatedCellId(sourceGrid.type, cell.cellId, translation),
    }),
  );
  const overlays = (fragment.objects.overlays as any[]).map((overlay) => {
    if (overlay.kind === "free-overlay") {
      return {
        ...structuredClone(overlay),
        point: translatePoint(overlay.point, delta),
      };
    }
    return {
      ...structuredClone(overlay),
      anchor:
        overlay.anchor.kind === "cell"
          ? {
              ...structuredClone(overlay.anchor),
              cellId: translatedCellId(
                sourceGrid.type,
                overlay.anchor.cellId,
                translation,
              ),
            }
          : {
              ...structuredClone(overlay.anchor),
              edgeId: edgeIdMap.get(overlay.anchor.edgeId),
            },
    };
  });
  const connections = (fragment.objects.connections as any[]).map(
    (connection) => ({
      ...structuredClone(connection),
      start: rewriteEndpoint(connection.start),
      end: rewriteEndpoint(connection.end),
    }),
  );
  const domainGroups = (fragment.objects.domainGroups as any[]).map(
    (group) => ({
      ...structuredClone(group),
      memberCellIds: group.memberCellIds.map((value: string) =>
        translatedCellId(sourceGrid.type, value, translation),
      ),
    }),
  );
  return {
    objects: {
      cellOverrides,
      edges,
      connections,
      overlays,
      domainGroups,
      embeddedAssets: structuredClone(fragment.objects.embeddedAssets),
      extensions: structuredClone(fragment.objects.extensions),
    },
    edgeIdMap,
  };
}

function translatedObjectsFit(
  target: ProjectV1Document,
  translated: TranslatedObjects,
): boolean {
  const grid = target.grid as ProjectGrid;
  const objects = translated.objects;
  const cellIds = [
    ...objects.cellOverrides.map((cell: any) => cell.cellId),
    ...objects.edges.flatMap((edge: any) => edge.adjacentCellIds),
    ...objects.domainGroups.flatMap((group: any) => group.memberCellIds),
    ...objects.overlays.flatMap((overlay: any) =>
      overlay.kind === "anchored-overlay" && overlay.anchor.kind === "cell"
        ? [overlay.anchor.cellId]
        : [],
    ),
    ...objects.connections.flatMap((connection: any) =>
      [connection.start, connection.end].flatMap((endpoint: any) =>
        endpoint.kind === "cell-center" ? [endpoint.cellId] : [],
      ),
    ),
  ];
  if (cellIds.some((value) => !coordinateInside(grid, parseCellId(value)))) {
    return false;
  }
  const mapPoints = [
    ...objects.overlays.flatMap((overlay: any) =>
      overlay.kind === "free-overlay" ? [overlay.point] : [],
    ),
    ...objects.connections.flatMap((connection: any) =>
      [connection.start, connection.end].flatMap((endpoint: any) =>
        endpoint.kind === "map-point" ? [endpoint.point] : [],
      ),
    ),
  ];
  return mapPoints.every((point) => isMapPointInsideGrid(grid, point));
}

function sourceObjectsFitAfterTranslation(
  target: ProjectV1Document,
  fragment: FragmentV1Document,
  translation: FragmentTranslation,
): boolean {
  const grid = target.grid as ProjectGrid;
  const sourceType = fragment.sourceGrid.type;
  const objects = fragment.objects as any;
  const cellIds = [
    ...objects.cellOverrides.map((cell: any) => cell.cellId),
    ...objects.edges.flatMap((edge: any) => edge.adjacentCellIds),
    ...objects.domainGroups.flatMap((group: any) => group.memberCellIds),
    ...objects.overlays.flatMap((overlay: any) =>
      overlay.kind === "anchored-overlay" && overlay.anchor.kind === "cell"
        ? [overlay.anchor.cellId]
        : [],
    ),
    ...objects.connections.flatMap((connection: any) =>
      [connection.start, connection.end].flatMap((endpoint: any) =>
        endpoint.kind === "cell-center" ? [endpoint.cellId] : [],
      ),
    ),
  ];
  if (
    cellIds.some(
      (value) =>
        !coordinateInside(
          grid,
          translateCoordinate(sourceType, parseCellId(value), translation),
        ),
    )
  ) {
    return false;
  }
  const delta = pointDelta(fragment.sourceGrid as ProjectGrid, translation);
  const mapPoints = [
    ...objects.overlays.flatMap((overlay: any) =>
      overlay.kind === "free-overlay" ? [overlay.point] : [],
    ),
    ...objects.connections.flatMap((connection: any) =>
      [connection.start, connection.end].flatMap((endpoint: any) =>
        endpoint.kind === "map-point" ? [endpoint.point] : [],
      ),
    ),
  ];
  return mapPoints.every((point) =>
    isMapPointInsideGrid(grid, translatePoint(point, delta)),
  );
}

function mapBounds(grid: ProjectGrid): FragmentV1Document["fragmentBounds"] {
  const representativeRows = new Set([0, grid.height - 1]);
  if (grid.type === "hex-pointy" && grid.height > 1) representativeRows.add(1);
  const points = [...representativeRows].flatMap((row) => [
    ...cellPolygon(grid, row, 0),
    ...cellPolygon(grid, row, grid.width - 1),
  ]);
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

function createPreview(
  target: ProjectV1Document,
  fragment: FragmentV1Document,
  translation: FragmentTranslation,
): FragmentMergePreview {
  const delta = pointDelta(fragment.sourceGrid as ProjectGrid, translation);
  const sourceBounds = structuredClone(fragment.fragmentBounds);
  return {
    sourceBounds,
    transformedBounds: {
      minX: sourceBounds.minX + delta.x,
      minY: sourceBounds.minY + delta.y,
      maxX: sourceBounds.maxX + delta.x,
      maxY: sourceBounds.maxY + delta.y,
    },
    targetMapBounds: mapBounds(target.grid as ProjectGrid),
    objectCounts: {
      cells: fragment.objects.cellOverrides.length,
      edges: fragment.objects.edges.length,
      connections: fragment.objects.connections.length,
      overlays: fragment.objects.overlays.length,
      domainGroups: fragment.objects.domainGroups.length,
      embeddedAssets: fragment.objects.embeddedAssets.length,
    },
    zeroTranslation:
      translation.kind === "square"
        ? translation.deltaRow === 0 && translation.deltaColumn === 0
        : translation.deltaQ === 0 && translation.deltaR === 0,
  };
}

function defaultConflictIssues(
  target: ProjectV1Document,
  objects: any,
): FragmentMergeIssue[] {
  const targetCells = new Map<
    string,
    { readonly layers: Set<string>; readonly cell: any }
  >();
  for (const chunk of target.chunks as any[]) {
    for (const cell of chunk.cellOverrides) {
      targetCells.set(cell.cellId, {
        layers: new Set(
          cell.layerInstances.map((instance: any) => instance.layerId),
        ),
        cell,
      });
    }
  }
  const issues: FragmentMergeIssue[] = [];
  for (const cell of objects.cellOverrides) {
    const occupied = targetCells.get(cell.cellId);
    const targetCell = occupied?.cell;
    const extensionKey =
      targetCell === undefined
        ? undefined
        : firstExtensionConflictKey(targetCell.extensions, cell.extensions);
    if (extensionKey !== undefined) {
      issues.push({
        severity: "hard",
        code: "fragment-cell-extensions-conflict",
        details: { cellId: cell.cellId, extensionKey },
      });
    }
    if (
      occupied?.layers.has("tessera.basic.cell-style") &&
      cell.layerInstances.some(
        (instance: any) => instance.layerId === "tessera.basic.cell-style",
      )
    ) {
      issues.push({
        severity: "hard",
        code: "fragment-cell-layer-conflict",
        details: {
          cellId: cell.cellId,
          layerId: "tessera.basic.cell-style",
        },
      });
    }
  }
  const targetEdges = new Map(
    (target.managers.edgeManager.edges as any[]).map((edge) => [
      edge.edgeId,
      edge,
    ]),
  );
  for (const edge of objects.edges) {
    const existing = targetEdges.get(edge.edgeId);
    if (existing === undefined) continue;
    const extensionKey = firstExtensionConflictKey(
      existing.extensions,
      edge.extensions,
    );
    if (extensionKey !== undefined) {
      issues.push({
        severity: "hard",
        code: "fragment-edge-extensions-conflict",
        details: { edgeId: edge.edgeId, extensionKey },
      });
    }
    for (const incomingInstance of edge.layerInstances) {
      const existingInstance = existing.layerInstances.find(
        (instance: any) => instance.layerId === incomingInstance.layerId,
      );
      if (
        existingInstance !== undefined &&
        !isReferenceOnly(existingInstance) &&
        !isReferenceOnly(incomingInstance)
      ) {
        issues.push({
          severity: "hard",
          code: "fragment-edge-layer-conflict",
          details: {
            edgeId: edge.edgeId,
            layerId: incomingInstance.layerId,
          },
        });
      }
    }
  }
  return issues;
}

export function planFragmentMerge(
  target: ProjectV1Document,
  fragment: FragmentV1Document,
  request: FragmentMergeOptions & {
    readonly translation?: FragmentTranslation;
  },
): FragmentMergePlan {
  const preflight = preflightFragmentMerge(target, fragment, request);
  if (preflight.status !== "ready") {
    return preflight.status === "blocked"
      ? { ...preflight, warnings: [] }
      : {
          status: "blocked",
          code: "fragment-modules-install-required",
          details: { missingModules: preflight.missingModules },
          warnings: [],
        };
  }
  const translation = request.translation ?? zeroTranslation(target.grid.type);
  if (!validTranslation(target.grid.type, translation)) {
    return {
      status: "blocked",
      code: "fragment-translation-invalid",
      details: {},
      warnings: [],
    };
  }
  const preview = createPreview(target, fragment, translation);
  if (!sourceObjectsFitAfterTranslation(target, fragment, translation)) {
    return request.translation === undefined
      ? {
          status: "requires-translation",
          translation: null,
          warnings: [],
          preview,
        }
      : {
          status: "blocked",
          code: "fragment-translation-out-of-bounds",
          details: {},
          warnings: [],
        };
  }
  let translated: TranslatedObjects;
  try {
    translated = translateObjects(target, fragment, translation);
  } catch (error) {
    return {
      status: "blocked",
      code:
        error instanceof FragmentMergeError
          ? error.code
          : "fragment-translation-failed",
      details: error instanceof FragmentMergeError ? error.details : {},
      warnings: [],
    };
  }
  if (!translatedObjectsFit(target, translated)) {
    return request.translation === undefined
      ? {
          status: "requires-translation",
          translation: null,
          warnings: [],
          preview,
        }
      : {
          status: "blocked",
          code: "fragment-translation-out-of-bounds",
          details: {},
          warnings: [],
        };
  }
  const issues = defaultConflictIssues(target, translated.objects);
  const ruleContext: FragmentMergeRuleContext | undefined =
    (request.rules?.length ?? 0) === 0
      ? undefined
      : {
          target: deepFreeze(structuredClone(target)),
          fragment: deepFreeze(structuredClone(fragment)),
          translatedObjects: deepFreeze(
            structuredClone(translated.objects),
          ) as FragmentV1Document["objects"],
        };
  for (const [ruleIndex, rule] of (request.rules ?? []).entries()) {
    let evaluated: readonly FragmentMergeIssue[];
    try {
      if (ruleContext === undefined) {
        throw new FragmentMergeError("fragment-rule-context-missing");
      }
      evaluated = rule.evaluate(ruleContext);
    } catch {
      return {
        status: "blocked",
        code: "fragment-rule-evaluation-failed",
        details: { ruleIndex },
        warnings: [],
      };
    }
    if (
      !Array.isArray(evaluated) ||
      evaluated.some(
        (issue) =>
          issue === null ||
          typeof issue !== "object" ||
          (issue.severity !== "warning" && issue.severity !== "hard") ||
          typeof issue.code !== "string" ||
          issue.code.length === 0 ||
          (issue.details !== undefined &&
            (issue.details === null ||
              typeof issue.details !== "object" ||
              Array.isArray(issue.details))),
      )
    ) {
      return {
        status: "blocked",
        code: "fragment-rule-result-invalid",
        details: { ruleIndex },
        warnings: [],
      };
    }
    issues.push(...evaluated);
  }
  const hard = issues.find((issue) => issue.severity === "hard");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  return hard === undefined
    ? { status: "ready", translation, warnings, preview }
    : {
        status: "blocked",
        code: hard.code,
        details: hard.details ?? {},
        warnings,
      };
}

export function cancelFragmentMerge(
  plan: FragmentMergePlan,
): FragmentMergePlan {
  return {
    status: "cancelled",
    warnings: plan.warnings,
    ...("preview" in plan ? { preview: plan.preview } : {}),
  };
}

function rewriteAssetRefs(
  value: unknown,
  assetIds: ReadonlyMap<string, string>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => rewriteAssetRefs(item, assetIds));
  }
  if (value === null || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "extensions") {
      result[key] = structuredClone(item);
    } else if (key === "assetRef" && typeof item === "string") {
      result[key] = assetIds.get(item) ?? item;
    } else if (
      key === "assetRef" &&
      item !== null &&
      typeof item === "object" &&
      typeof (item as Record<string, unknown>).assetId === "string"
    ) {
      const assetId = (item as Record<string, unknown>).assetId as string;
      result[key] = {
        ...structuredClone(item),
        assetId: assetIds.get(assetId) ?? assetId,
      };
    } else {
      result[key] = rewriteAssetRefs(item, assetIds);
    }
  }
  return result;
}

function buildCanonicalChunks(target: any, merged: any): any[] {
  const sourceExtensions = new Map(
    target.chunks.map((chunk: any) => [
      `${chunk.chunkRow}:${chunk.chunkColumn}`,
      structuredClone(chunk.extensions),
    ]),
  );
  const chunks = new Map<string, any>();
  const ensure = (ownerCellId: string): any => {
    const owner = parseCellId(ownerCellId);
    const chunkRow = Math.floor(owner.row / 64);
    const chunkColumn = Math.floor(owner.column / 64);
    const key = `${chunkRow}:${chunkColumn}`;
    const existing = chunks.get(key);
    if (existing !== undefined) return existing;
    const chunk = {
      chunkRow,
      chunkColumn,
      cellOverrides: [],
      ownedEdgeIds: [],
      ownedOverlayIds: [],
      ownedDomainGroupIds: [],
      extensions: sourceExtensions.get(key) ?? {},
    };
    chunks.set(key, chunk);
    return chunk;
  };
  for (const cell of merged.cells) {
    ensure(cell.cellId).cellOverrides.push(cell);
  }
  const edgeById = new Map(
    merged.edges.map((edge: any) => [edge.edgeId, edge]),
  );
  for (const edge of merged.edges) {
    ensure(edge.adjacentCellIds[0]).ownedEdgeIds.push(edge.edgeId);
  }
  for (const overlay of merged.overlays) {
    if (overlay.kind !== "anchored-overlay") continue;
    const ownerCellId =
      overlay.anchor.kind === "cell"
        ? overlay.anchor.cellId
        : (edgeById.get(overlay.anchor.edgeId) as any)?.adjacentCellIds[0];
    if (ownerCellId === undefined) {
      throw new FragmentMergeError("fragment-overlay-owner-missing", {
        overlayId: overlay.overlayId,
      });
    }
    ensure(ownerCellId).ownedOverlayIds.push(overlay.overlayId);
  }
  for (const group of merged.groups) {
    ensure(group.memberCellIds[0]).ownedDomainGroupIds.push(group.groupId);
  }
  for (const chunk of chunks.values()) {
    chunk.cellOverrides.sort((left: any, right: any) =>
      compareCellId(left.cellId, right.cellId),
    );
    chunk.ownedEdgeIds.sort(compareStableId);
    chunk.ownedOverlayIds.sort(compareStableId);
    chunk.ownedDomainGroupIds.sort(compareStableId);
  }
  return [...chunks.values()].sort(
    (left, right) =>
      left.chunkRow - right.chunkRow || left.chunkColumn - right.chunkColumn,
  );
}

function jsonSemanticEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => jsonSemanticEqual(value, right[index]))
    );
  }
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort(compareStableId);
  const rightKeys = Object.keys(rightRecord).sort(compareStableId);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] &&
        jsonSemanticEqual(leftRecord[key], rightRecord[key]),
    )
  );
}

function mergeExtensions(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
  code: string,
  details: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const merged = structuredClone(left);
  for (const key of Object.keys(right).sort(compareStableId)) {
    if (
      Object.hasOwn(merged, key) &&
      !jsonSemanticEqual(merged[key], right[key])
    ) {
      throw new FragmentMergeError(code, { ...details, extensionKey: key });
    }
    if (!Object.hasOwn(merged, key)) merged[key] = structuredClone(right[key]);
  }
  return merged;
}

function firstExtensionConflictKey(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): string | undefined {
  return Object.keys(right)
    .sort(compareStableId)
    .find(
      (key) =>
        Object.hasOwn(left, key) && !jsonSemanticEqual(left[key], right[key]),
    );
}

function mergeCellOverrides(target: any[], incoming: any[]): any[] {
  const cells = new Map(
    target.map((cell) => [cell.cellId, structuredClone(cell)]),
  );
  for (const cell of incoming) {
    const existing = cells.get(cell.cellId);
    if (existing === undefined) {
      cells.set(cell.cellId, cell);
      continue;
    }
    existing.extensions = mergeExtensions(
      existing.extensions,
      cell.extensions,
      "fragment-cell-extensions-conflict",
      {
        cellId: cell.cellId,
      },
    );
    existing.layerInstances.push(...cell.layerInstances);
    existing.layerInstances.sort(compareLayerInstance);
  }
  return [...cells.values()].sort((left, right) =>
    compareCellId(left.cellId, right.cellId),
  );
}

function isReferenceOnly(instance: any): boolean {
  return (
    instance.elementId === "tessera.basic:edge.style" &&
    instance.layerId === "tessera.basic.edge-style" &&
    instance.attributes?.persistence === "reference-only"
  );
}

function mergeEdges(target: any[], incoming: any[]): any[] {
  const edges = new Map(
    target.map((edge) => [edge.edgeId, structuredClone(edge)]),
  );
  for (const edge of incoming) {
    const existing = edges.get(edge.edgeId);
    if (existing === undefined) {
      edges.set(edge.edgeId, edge);
      continue;
    }
    existing.extensions = mergeExtensions(
      existing.extensions,
      edge.extensions,
      "fragment-edge-extensions-conflict",
      { edgeId: edge.edgeId },
    );
    for (const incomingInstance of edge.layerInstances) {
      const existingIndex = existing.layerInstances.findIndex(
        (instance: any) => instance.layerId === incomingInstance.layerId,
      );
      if (existingIndex < 0) {
        if (!isReferenceOnly(incomingInstance)) {
          existing.layerInstances.push(incomingInstance);
        }
        continue;
      }
      const existingInstance = existing.layerInstances[existingIndex];
      const existingReference = isReferenceOnly(existingInstance);
      const incomingReference = isReferenceOnly(incomingInstance);
      if (existingReference && !incomingReference) {
        existing.layerInstances[existingIndex] = incomingInstance;
      } else if (!existingReference && !incomingReference) {
        throw new FragmentMergeError("fragment-edge-layer-conflict", {
          edgeId: edge.edgeId,
          layerId: incomingInstance.layerId,
        });
      }
    }
    existing.layerInstances.sort(compareLayerInstance);
  }
  return [...edges.values()].sort((left, right) =>
    compareStableId(left.edgeId, right.edgeId),
  );
}

/** apply 仅操作深拷贝；任意失败都不会给 target 或 fragment 留下半成品。 */
export function applyFragmentMerge(
  target: ProjectV1Document,
  fragment: FragmentV1Document,
  plan: FragmentMergePlan,
  options: FragmentMergeApplyOptions,
): FragmentMergeResult {
  if (plan.status !== "ready") {
    throw new FragmentMergeError("fragment-merge-plan-not-ready", {
      status: plan.status,
    });
  }
  const confirmed = planFragmentMerge(target, fragment, {
    currentAppVersion: options.currentAppVersion,
    ...(options.resolver === undefined ? {} : { resolver: options.resolver }),
    ...(options.rules === undefined ? {} : { rules: options.rules }),
    translation: plan.translation,
  });
  if (confirmed.status !== "ready") {
    throw new FragmentMergeError("fragment-merge-plan-stale", {
      status: confirmed.status,
    });
  }

  const targetRecord = target as any;
  const existingIds = new Set<string>();
  for (const chunk of targetRecord.chunks) {
    for (const cell of chunk.cellOverrides) {
      for (const instance of cell.layerInstances) {
        existingIds.add(instance.instanceId);
      }
    }
  }
  for (const edge of targetRecord.managers.edgeManager.edges) {
    for (const instance of edge.layerInstances) {
      existingIds.add(instance.instanceId);
    }
  }
  for (const connection of targetRecord.managers.connectionManager
    .connections) {
    existingIds.add(connection.connectionId);
  }
  for (const overlay of targetRecord.managers.overlayManager.overlays) {
    existingIds.add(overlay.overlayId);
  }
  for (const group of targetRecord.domainGroups) existingIds.add(group.groupId);
  for (const asset of targetRecord.embeddedAssets)
    existingIds.add(asset.assetId);
  existingIds.add(target.projectId);
  existingIds.add(fragment.fragmentId);
  existingIds.add(fragment.sourceProjectId);
  if (target.lineage !== null) {
    existingIds.add(target.lineage.sourceProjectId);
  }
  for (const cell of fragment.objects.cellOverrides) {
    for (const instance of cell.layerInstances) {
      existingIds.add(instance.instanceId);
    }
  }
  for (const edge of fragment.objects.edges) {
    for (const instance of edge.layerInstances) {
      existingIds.add(instance.instanceId);
    }
  }
  for (const connection of fragment.objects.connections) {
    existingIds.add(connection.connectionId);
  }
  for (const overlay of fragment.objects.overlays) {
    existingIds.add(overlay.overlayId);
  }
  for (const group of fragment.objects.domainGroups) {
    existingIds.add(group.groupId);
  }
  for (const asset of fragment.objects.embeddedAssets) {
    existingIds.add(asset.assetId);
  }

  const generate = options.uuidGenerator ?? (() => crypto.randomUUID());
  const allocated = new Set(existingIds);
  const nextUuid = (): string => {
    let value: string;
    try {
      value = generate();
    } catch {
      throw new FragmentMergeError("fragment-uuid-generation-failed");
    }
    if (!UUID_PATTERN.test(value) || allocated.has(value)) {
      throw new FragmentMergeError("fragment-uuid-generation-invalid", {
        value,
      });
    }
    allocated.add(value);
    return value;
  };

  const translated = translateObjects(target, fragment, plan.translation)
    .objects as any;
  const instanceIds = new Map<string, string>();
  const assetIds = new Map<string, string>();
  const deduplicatedStructuralInstances = new Map<string, string | null>();
  const mapInstance = (oldId: string): string => {
    const existing = instanceIds.get(oldId);
    if (existing !== undefined) return existing;
    const value = nextUuid();
    instanceIds.set(oldId, value);
    return value;
  };

  for (const asset of translated.embeddedAssets) {
    assetIds.set(asset.assetId, nextUuid());
  }
  for (const cell of translated.cellOverrides) {
    for (const instance of cell.layerInstances) {
      instance.instanceId = mapInstance(instance.instanceId);
    }
  }
  const targetEdges = new Map(
    targetRecord.managers.edgeManager.edges.map((edge: any) => [
      edge.edgeId,
      edge,
    ]),
  );
  for (const edge of translated.edges) {
    for (const instance of edge.layerInstances) {
      const oldInstanceId = instance.instanceId;
      const targetEdge = targetEdges.get(edge.edgeId) as any;
      if (targetEdge !== undefined && isReferenceOnly(instance)) {
        const targetInstance = targetEdge.layerInstances.find(
          (candidate: any) => candidate.layerId === instance.layerId,
        );
        deduplicatedStructuralInstances.set(
          oldInstanceId,
          targetInstance?.instanceId ?? null,
        );
      } else {
        instance.instanceId = mapInstance(oldInstanceId);
      }
    }
  }
  for (const connection of translated.connections) {
    connection.connectionId = mapInstance(connection.connectionId);
  }
  for (const overlay of translated.overlays) {
    overlay.overlayId = mapInstance(overlay.overlayId);
  }
  for (const group of translated.domainGroups) {
    group.groupId = mapInstance(group.groupId);
  }
  for (const asset of translated.embeddedAssets) {
    asset.assetId = assetIds.get(asset.assetId);
  }
  for (const collection of [
    translated.cellOverrides,
    translated.edges,
    translated.connections,
    translated.overlays,
    translated.domainGroups,
  ]) {
    for (let index = 0; index < collection.length; index += 1) {
      collection[index] = rewriteAssetRefs(collection[index], assetIds);
    }
  }
  options.failureHook?.("after-id-remap");

  const targetCells = targetRecord.chunks.flatMap(
    (chunk: any) => chunk.cellOverrides,
  );
  const cells = mergeCellOverrides(targetCells, translated.cellOverrides);
  options.failureHook?.("after-cell-merge");
  const edges = mergeEdges(
    targetRecord.managers.edgeManager.edges,
    translated.edges,
  );
  options.failureHook?.("after-edge-merge");
  const connections = [
    ...structuredClone(targetRecord.managers.connectionManager.connections),
    ...translated.connections,
  ].sort((left, right) =>
    compareStableId(left.connectionId, right.connectionId),
  );
  const overlays = [
    ...structuredClone(targetRecord.managers.overlayManager.overlays),
    ...translated.overlays,
  ].sort((left, right) => compareStableId(left.overlayId, right.overlayId));
  const groups = [
    ...structuredClone(targetRecord.domainGroups),
    ...translated.domainGroups,
  ].sort((left, right) => compareStableId(left.groupId, right.groupId));
  const assets = [
    ...structuredClone(targetRecord.embeddedAssets),
    ...translated.embeddedAssets,
  ].sort((left, right) => compareStableId(left.assetId, right.assetId));
  const transactionId = nextUuid();
  const project: any = structuredClone(targetRecord);
  try {
    project.updatedAt = (options.now ?? (() => new Date().toISOString()))();
  } catch {
    throw new FragmentMergeError("fragment-clock-failed");
  }
  project.managers.edgeManager.edges = edges;
  project.managers.connectionManager.connections = connections;
  project.managers.overlayManager.overlays = overlays;
  project.domainGroups = groups;
  project.embeddedAssets = assets;
  project.chunks = buildCanonicalChunks(targetRecord, {
    cells,
    edges,
    overlays,
    groups,
  });
  project.contentBounds = computeProjectContentBounds(project);
  options.failureHook?.("before-validation");
  try {
    validateProjectDocumentV1(project);
  } catch (error) {
    throw new FragmentMergeError("fragment-merge-result-invalid", {
      causeCode:
        error !== null && typeof error === "object" && "code" in error
          ? String(error.code)
          : "unknown",
    });
  }
  return {
    project,
    transactionId,
    historyIntent: {
      kind: "fragment-merge",
      transactionId,
      fragmentId: fragment.fragmentId,
      sourceProjectId: fragment.sourceProjectId,
      affectedCollections: [
        "project-metadata",
        "chunks",
        "edges",
        "connections",
        "overlays",
        "domainGroups",
        "embeddedAssets",
      ],
    },
    idRemap: {
      instances: Object.fromEntries(instanceIds),
      assets: Object.fromEntries(assetIds),
      deduplicatedStructuralInstances: Object.fromEntries(
        deduplicatedStructuralInstances,
      ),
    },
    warnings: confirmed.warnings,
  };
}
