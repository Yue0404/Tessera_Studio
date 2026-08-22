import {
  ConnectionManager,
  EdgeManager,
  OverlayManager,
  SparseChunkStore,
  createFixedLayerMap,
  type CellOverride,
  type ConnectionData,
  type EdgeOverride,
  type OverlayData,
  type ProjectState,
} from "@tessera/core";
import type { ErrorObject } from "ajv";
import {
  computeProjectContentBounds,
  contentBoundsEqual,
} from "./content-bounds.js";
import {
  compareCellId,
  compareLayerInstance,
  compareStableId,
  isSortedUnique,
} from "./deterministic-order.js";
import { validateEmbeddedAssets } from "./embedded-asset-validation.js";
import type { ProjectV1Document } from "./format-types.js";
import { parseJsonWithSafetyLimits } from "./json-input.js";
import {
  ProjectReconcileError,
  type ProjectSerializationMode,
  reconcileProjectDocument,
} from "./project-reconcile.js";
import validateProject from "./project-validator.generated.js";
import {
  assertCanonicalEdge,
  assertMapPointInsideGrid,
  assertTextLimits,
  compareCellIds,
  validateKnownBasicPlacement,
  validateKnownBasicInstance,
} from "./semantic-helpers.js";

const projectValidator = validateProject as typeof validateProject & {
  errors?: ErrorObject[] | null;
};

const BASIC_VERSION = "1.0.0";
const layerStates = [
  ["tessera.basic.cell-style", 500],
  ["tessera.basic.edge-style", 1500],
  ["tessera.basic.placed-object", 3000],
  ["tessera.basic.connection", 4300],
  ["tessera.basic.annotation", 4400],
] as const;

export class ProjectFormatError extends Error {
  constructor(
    readonly code: string,
    readonly details: Readonly<Record<string, unknown>> = {},
    readonly issues: readonly ErrorObject[] = [],
  ) {
    super(code);
    this.name = "ProjectFormatError";
  }
}

interface ChunkRecord {
  chunkRow: number;
  chunkColumn: number;
  cellOverrides: unknown[];
  ownedEdgeIds: string[];
  ownedOverlayIds: string[];
  ownedDomainGroupIds: string[];
  extensions: Record<string, never>;
}

function chunkKey(row: number, column: number): string {
  return `${Math.floor(row / 64)}:${Math.floor(column / 64)}`;
}

function parseCellId(id: string): { row: number; column: number } {
  const parts = id.split(":");
  const row = Number(parts.at(-2));
  const column = Number(parts.at(-1));
  if (!Number.isInteger(row) || !Number.isInteger(column))
    throw new ProjectFormatError("cell-id-invalid", { cellId: id });
  return { row, column };
}

function serializeEndpoint(
  endpoint: ConnectionData["start"],
): Record<string, unknown> {
  if (endpoint.kind === "cell-center") {
    return { kind: endpoint.kind, cellId: endpoint.cellId, extensions: {} };
  }
  if (endpoint.kind === "edge-midpoint") {
    return { kind: endpoint.kind, edgeId: endpoint.edgeId, extensions: {} };
  }
  return {
    kind: endpoint.kind,
    point: { ...endpoint.point },
    extensions: {},
  };
}

function serializeConnection(
  connection: ConnectionData,
): Record<string, unknown> {
  const base = {
    kind: connection.kind,
    connectionId: connection.connectionId,
    elementId: connection.elementId,
    layerId: connection.layerId,
    start: serializeEndpoint(connection.start),
    end: serializeEndpoint(connection.end),
    styleOverrides: { ...connection.style },
    attributes: {},
    label: connection.label,
    extensions: {},
  };
  return connection.kind === "arrow"
    ? {
        ...base,
        arrowStart: connection.arrowStart,
        arrowEnd: connection.arrowEnd,
      }
    : base;
}

function serializeOverlay(overlay: OverlayData): Record<string, unknown> {
  const base = {
    kind: overlay.kind,
    overlayId: overlay.overlayId,
    elementId: overlay.elementId,
    layerId: overlay.layerId,
    overlayType: overlay.overlayType,
    styleOverrides: { ...overlay.style },
    attributes: overlay.overlayType === "text" ? { text: overlay.text } : {},
    orderInLayer: overlay.orderInLayer,
    extensions: {},
  };
  if (overlay.kind === "free-overlay") {
    return { ...base, point: { ...overlay.point } };
  }
  return {
    ...base,
    anchor:
      overlay.anchor.kind === "cell"
        ? { kind: "cell", cellId: overlay.anchor.cellId, extensions: {} }
        : { kind: "edge", edgeId: overlay.anchor.edgeId, extensions: {} },
  };
}

function parseEndpoint(endpoint: any): ConnectionData["start"] {
  if (endpoint.kind === "cell-center") {
    return { kind: endpoint.kind, cellId: endpoint.cellId };
  }
  if (endpoint.kind === "edge-midpoint") {
    return { kind: endpoint.kind, edgeId: endpoint.edgeId };
  }
  return { kind: "map-point", point: { ...endpoint.point } };
}

function parseConnection(connection: any): ConnectionData {
  const base = {
    connectionId: connection.connectionId,
    layerId: "tessera.basic.connection" as const,
    start: parseEndpoint(connection.start),
    end: parseEndpoint(connection.end),
    style: { ...connection.styleOverrides },
    label: connection.label,
  };
  return connection.kind === "arrow"
    ? {
        ...base,
        kind: "arrow",
        elementId: "tessera.basic:connection.arrow",
        arrowStart: connection.arrowStart,
        arrowEnd: connection.arrowEnd,
      }
    : {
        ...base,
        kind: "line",
        elementId: "tessera.basic:connection.line",
      };
}

function parseOverlay(overlay: any): OverlayData {
  const common = {
    overlayId: overlay.overlayId,
    layerId: overlay.layerId,
    orderInLayer: overlay.orderInLayer,
  };
  const location =
    overlay.kind === "free-overlay"
      ? { kind: "free-overlay" as const, point: { ...overlay.point } }
      : {
          kind: "anchored-overlay" as const,
          anchor:
            overlay.anchor.kind === "cell"
              ? { kind: "cell" as const, cellId: overlay.anchor.cellId }
              : { kind: "edge" as const, edgeId: overlay.anchor.edgeId },
        };
  if (overlay.overlayType === "text") {
    return {
      ...common,
      ...location,
      elementId: "tessera.basic:text",
      overlayType: "text",
      style: { ...overlay.styleOverrides },
      text: overlay.attributes.text,
    } as OverlayData;
  }
  return {
    ...common,
    ...location,
    elementId: "tessera.basic:marker",
    overlayType: "marker",
    style: { ...overlay.styleOverrides },
    text: null,
  } as OverlayData;
}

function validateSemanticClosure(project: Record<string, any>): void {
  if (
    (project.grid.type === "square" &&
      project.grid.orientation !== "axis-aligned") ||
    (project.grid.type === "hex-pointy" &&
      project.grid.orientation !== "pointy")
  ) {
    throw new ProjectFormatError("grid-orientation-mismatch");
  }
  const grid = {
    type: project.grid.type,
    width: project.grid.width,
    height: project.grid.height,
    cellSize: project.grid.cellSize,
  } as const;
  const moduleIds = new Set<string>();
  if (
    !isSortedUnique(project.modules, (left: any, right: any) =>
      compareStableId(left.moduleId, right.moduleId),
    )
  ) {
    throw new ProjectFormatError("module-order-invalid");
  }
  for (const module of project.modules as any[]) {
    if (moduleIds.has(module.moduleId)) {
      throw new ProjectFormatError("module-duplicate", {
        moduleId: module.moduleId,
      });
    }
    moduleIds.add(module.moduleId);
  }
  const basicModule = project.modules.find(
    (module: any) => module.moduleId === "tessera.basic",
  );
  if (
    basicModule?.version !== BASIC_VERSION ||
    basicModule?.packageSourceKind !== "built-in"
  ) {
    throw new ProjectFormatError("basic-module-contract-invalid", {
      requiredModuleId: "tessera.basic",
      requiredVersion: BASIC_VERSION,
    });
  }
  const layerIds = new Set<string>();
  let previousLayer: any;
  for (const layer of project.layerStates as any[]) {
    if (layerIds.has(layer.layerId)) {
      throw new ProjectFormatError("layer-duplicate", {
        layerId: layer.layerId,
      });
    }
    layerIds.add(layer.layerId);
    if (
      previousLayer !== undefined &&
      (previousLayer.zIndex > layer.zIndex ||
        (previousLayer.zIndex === layer.zIndex &&
          previousLayer.layerId.localeCompare(layer.layerId) >= 0))
    ) {
      throw new ProjectFormatError("layer-order-invalid", {
        layerId: layer.layerId,
      });
    }
    previousLayer = layer;
    const ownerModule = [...project.modules]
      .filter((module: any) => layer.layerId.startsWith(`${module.moduleId}.`))
      .sort(
        (left: any, right: any) => right.moduleId.length - left.moduleId.length,
      )[0];
    if (
      ownerModule === undefined ||
      ownerModule.version !== layer.moduleVersion
    ) {
      throw new ProjectFormatError("layer-module-version-mismatch", {
        layerId: layer.layerId,
        moduleVersion: layer.moduleVersion,
      });
    }
  }
  for (const [layerId, zIndex] of layerStates) {
    const layer = project.layerStates.find(
      (candidate: any) => candidate.layerId === layerId,
    );
    if (
      layer === undefined ||
      layer.zIndex !== zIndex ||
      layer.moduleVersion !== BASIC_VERSION
    ) {
      throw new ProjectFormatError("basic-layer-contract-invalid", {
        layerId,
      });
    }
  }
  if (project.exportScope === "partial") {
    const included = project.lineage.includedLayerIds as string[];
    const omitted = project.lineage.omittedLayerIds as string[];
    const combined = [...included, ...omitted];
    if (
      included.some((layerId) => omitted.includes(layerId)) ||
      [...included].sort().join("\u0000") !== included.join("\u0000") ||
      [...omitted].sort().join("\u0000") !== omitted.join("\u0000") ||
      combined.some((layerId, index) => combined.indexOf(layerId) !== index) ||
      combined.some((layerId) => !layerIds.has(layerId)) ||
      combined.length !== layerIds.size
    ) {
      throw new ProjectFormatError("partial-lineage-layer-set-invalid");
    }
  }
  const validateBounds = (
    bounds: { minX: number; minY: number; maxX: number; maxY: number } | null,
    pointer: string,
  ): void => {
    if (
      bounds !== null &&
      (bounds.minX > bounds.maxX || bounds.minY > bounds.maxY)
    ) {
      throw new ProjectFormatError("bounds-order-invalid", { pointer });
    }
  };
  validateBounds(project.contentBounds, "/contentBounds");
  if (project.lineage !== null) {
    validateBounds(project.lineage.selectionBounds, "/lineage/selectionBounds");
  }

  const instanceIds = new Set<string>();
  const registerInstance = (
    instanceId: string,
    elementId: string,
    layerId: string,
    pointer: string,
    structuralReference = false,
  ): void => {
    if (instanceIds.has(instanceId)) {
      throw new ProjectFormatError("instance-id-duplicate", {
        instanceId,
        pointer,
      });
    }
    instanceIds.add(instanceId);
    if (!layerIds.has(layerId)) {
      throw new ProjectFormatError("instance-layer-reference-missing", {
        layerId,
        pointer,
      });
    }
    const separator = elementId.indexOf(":");
    const moduleId = separator < 0 ? "" : elementId.slice(0, separator);
    if (!moduleIds.has(moduleId)) {
      throw new ProjectFormatError("instance-module-reference-missing", {
        elementId,
        pointer,
      });
    }
    if (
      project.exportScope === "partial" &&
      !project.lineage.includedLayerIds.includes(layerId) &&
      !structuralReference
    ) {
      throw new ProjectFormatError("partial-object-layer-omitted", {
        layerId,
        pointer,
      });
    }
  };
  const ownedEdges = new Set<string>();
  const ownedOverlays = new Set<string>();
  const ownedDomainGroups = new Map<string, string>();
  const ownedEdgeChunks = new Map<string, string>();
  const ownedOverlayChunks = new Map<string, string>();
  const cellIds = new Set<string>();
  const chunkKeys = new Set<string>();
  let previousChunk: { chunkRow: number; chunkColumn: number } | undefined;
  for (const chunk of project.chunks as any[]) {
    const key = `${String(chunk.chunkRow)}:${String(chunk.chunkColumn)}`;
    if (
      chunk.chunkRow > Math.floor((project.grid.height - 1) / 64) ||
      chunk.chunkColumn > Math.floor((project.grid.width - 1) / 64)
    ) {
      throw new ProjectFormatError("chunk-out-of-bounds", { chunkKey: key });
    }
    if (
      previousChunk !== undefined &&
      (previousChunk.chunkRow > chunk.chunkRow ||
        (previousChunk.chunkRow === chunk.chunkRow &&
          previousChunk.chunkColumn >= chunk.chunkColumn))
    ) {
      throw new ProjectFormatError("chunk-order-invalid", { chunkKey: key });
    }
    previousChunk = chunk;
    if (
      chunk.cellOverrides.length === 0 &&
      chunk.ownedEdgeIds.length === 0 &&
      chunk.ownedOverlayIds.length === 0 &&
      chunk.ownedDomainGroupIds.length === 0
    ) {
      throw new ProjectFormatError("chunk-empty-not-persistable", {
        chunkKey: key,
      });
    }
    if (
      !isSortedUnique(chunk.cellOverrides, (left: any, right: any) =>
        compareCellId(left.cellId, right.cellId),
      ) ||
      !isSortedUnique(chunk.ownedEdgeIds, compareStableId) ||
      !isSortedUnique(chunk.ownedOverlayIds, compareStableId) ||
      !isSortedUnique(chunk.ownedDomainGroupIds, compareStableId)
    ) {
      throw new ProjectFormatError("chunk-content-order-invalid", {
        chunkKey: key,
      });
    }
    if (chunkKeys.has(key))
      throw new ProjectFormatError("chunk-duplicate", { chunkKey: key });
    chunkKeys.add(key);
    for (const cell of chunk.cellOverrides as any[]) {
      if (!isSortedUnique(cell.layerInstances, compareLayerInstance)) {
        throw new ProjectFormatError("layer-instance-order-invalid", {
          cellId: cell.cellId,
        });
      }
      const coordinate = parseCellId(cell.cellId);
      if (
        coordinate.row >= project.grid.height ||
        coordinate.column >= project.grid.width ||
        !cell.cellId.startsWith(`cell:${project.grid.type}:`)
      )
        throw new ProjectFormatError("cell-out-of-bounds", {
          cellId: cell.cellId,
        });
      if (
        Math.floor(coordinate.row / 64) !== chunk.chunkRow ||
        Math.floor(coordinate.column / 64) !== chunk.chunkColumn ||
        cellIds.has(cell.cellId)
      )
        throw new ProjectFormatError("cell-chunk-ownership-conflict", {
          cellId: cell.cellId,
        });
      cellIds.add(cell.cellId);
      for (const instance of cell.layerInstances as any[]) {
        const pointer = `/chunks/${key}/cellOverrides/${cell.cellId}/layerInstances/${instance.instanceId}`;
        registerInstance(
          instance.instanceId,
          instance.elementId,
          instance.layerId,
          pointer,
        );
        validateKnownBasicInstance(
          instance,
          pointer,
          (code, details) => new ProjectFormatError(code, details),
        );
        validateKnownBasicPlacement(
          instance.elementId,
          "cell",
          pointer,
          (code, details) => new ProjectFormatError(code, details),
        );
      }
    }
    for (const edgeId of chunk.ownedEdgeIds as string[]) {
      if (ownedEdges.has(edgeId))
        throw new ProjectFormatError("edge-owned-by-multiple-chunks", {
          edgeId,
        });
      ownedEdges.add(edgeId);
      ownedEdgeChunks.set(edgeId, key);
    }
    for (const overlayId of chunk.ownedOverlayIds as string[]) {
      if (ownedOverlays.has(overlayId)) {
        throw new ProjectFormatError("overlay-owned-by-multiple-chunks", {
          overlayId,
        });
      }
      ownedOverlays.add(overlayId);
      ownedOverlayChunks.set(overlayId, key);
    }
    for (const groupId of chunk.ownedDomainGroupIds as string[]) {
      if (ownedDomainGroups.has(groupId)) {
        throw new ProjectFormatError("domain-group-owned-by-multiple-chunks", {
          groupId,
        });
      }
      ownedDomainGroups.set(groupId, key);
    }
  }
  if (
    !isSortedUnique(
      project.managers.edgeManager.edges,
      (left: any, right: any) => compareStableId(left.edgeId, right.edgeId),
    ) ||
    !isSortedUnique(
      project.managers.connectionManager.connections,
      (left: any, right: any) =>
        compareStableId(left.connectionId, right.connectionId),
    ) ||
    !isSortedUnique(
      project.managers.overlayManager.overlays,
      (left: any, right: any) =>
        compareStableId(left.overlayId, right.overlayId),
    ) ||
    !isSortedUnique(project.domainGroups, (left: any, right: any) =>
      compareStableId(left.groupId, right.groupId),
    ) ||
    !isSortedUnique(project.embeddedAssets, (left: any, right: any) =>
      compareStableId(left.assetId, right.assetId),
    )
  ) {
    throw new ProjectFormatError("manager-array-order-invalid");
  }
  const edgeIds = new Set<string>();
  for (const edge of project.managers.edgeManager.edges as any[]) {
    if (edgeIds.has(edge.edgeId) || !ownedEdges.has(edge.edgeId))
      throw new ProjectFormatError("edge-reference-closure-invalid", {
        edgeId: edge.edgeId,
      });
    edgeIds.add(edge.edgeId);
    for (const id of edge.adjacentCellIds as string[]) {
      const coordinate = parseCellId(id);
      if (
        !id.startsWith(`cell:${project.grid.type}:`) ||
        coordinate.row >= project.grid.height ||
        coordinate.column >= project.grid.width
      )
        throw new ProjectFormatError("edge-adjacent-cell-out-of-bounds", {
          cellId: id,
        });
    }
    if (!isSortedUnique(edge.layerInstances, compareLayerInstance)) {
      throw new ProjectFormatError("layer-instance-order-invalid", {
        edgeId: edge.edgeId,
      });
    }
    const edgePointer = `/managers/edgeManager/edges/${edge.edgeId}`;
    assertCanonicalEdge(
      grid,
      edge.edgeId,
      edge.adjacentCellIds,
      edgePointer,
      (code, details) => new ProjectFormatError(code, details),
    );
    const edgeOwner = parseCellId(edge.adjacentCellIds[0] as string);
    const expectedEdgeOwner = chunkKey(edgeOwner.row, edgeOwner.column);
    if (ownedEdgeChunks.get(edge.edgeId) !== expectedEdgeOwner) {
      throw new ProjectFormatError("edge-owner-chunk-invalid", {
        edgeId: edge.edgeId,
        expectedOwner: expectedEdgeOwner,
      });
    }
    for (const instance of edge.layerInstances as any[]) {
      const instancePointer = `${edgePointer}/layerInstances/${instance.instanceId}`;
      const structuralReference =
        instance.elementId === "tessera.basic:edge.style" &&
        instance.layerId === "tessera.basic.edge-style" &&
        instance.attributes?.persistence === "reference-only";
      registerInstance(
        instance.instanceId,
        instance.elementId,
        instance.layerId,
        instancePointer,
        structuralReference,
      );
      validateKnownBasicInstance(
        instance,
        instancePointer,
        (code, details) => new ProjectFormatError(code, details),
      );
      validateKnownBasicPlacement(
        instance.elementId,
        "edge",
        instancePointer,
        (code, details) => new ProjectFormatError(code, details),
      );
    }
  }
  if (edgeIds.size !== ownedEdges.size)
    throw new ProjectFormatError("chunk-edge-reference-missing");

  const overlayIds = new Set<string>();
  const anchoredOverlayIds = new Set<string>();
  const referencedEdgeIds = new Set<string>();
  for (const overlay of project.managers.overlayManager.overlays as any[]) {
    if (overlayIds.has(overlay.overlayId)) {
      throw new ProjectFormatError("overlay-duplicate", {
        overlayId: overlay.overlayId,
      });
    }
    overlayIds.add(overlay.overlayId);
    registerInstance(
      overlay.overlayId,
      overlay.elementId,
      overlay.layerId,
      `/managers/overlayManager/overlays/${overlay.overlayId}`,
    );
    validateKnownBasicInstance(
      {
        elementId: overlay.elementId,
        layerId: overlay.layerId,
        styleOverrides: overlay.styleOverrides,
        attributes: overlay.attributes,
      },
      `/managers/overlayManager/overlays/${overlay.overlayId}`,
      (code, details) => new ProjectFormatError(code, details),
    );
    validateKnownBasicPlacement(
      overlay.elementId,
      overlay.overlayType === "marker" ? "marker-overlay" : "text-overlay",
      `/managers/overlayManager/overlays/${overlay.overlayId}`,
      (code, details) => new ProjectFormatError(code, details),
    );
    if (overlay.kind === "free-overlay") {
      assertMapPointInsideGrid(
        grid,
        overlay.point,
        `/managers/overlayManager/overlays/${overlay.overlayId}/point`,
        (code, details) => new ProjectFormatError(code, details),
      );
      continue;
    }
    anchoredOverlayIds.add(overlay.overlayId);
    if (overlay.anchor.kind === "cell") {
      const coordinate = parseCellId(overlay.anchor.cellId);
      if (
        !overlay.anchor.cellId.startsWith(`cell:${project.grid.type}:`) ||
        coordinate.row >= project.grid.height ||
        coordinate.column >= project.grid.width
      ) {
        throw new ProjectFormatError("overlay-cell-anchor-out-of-bounds", {
          overlayId: overlay.overlayId,
        });
      }
      const owner = parseCellId(overlay.anchor.cellId);
      const expectedOwner = chunkKey(owner.row, owner.column);
      if (ownedOverlayChunks.get(overlay.overlayId) !== expectedOwner) {
        throw new ProjectFormatError("overlay-owner-chunk-invalid", {
          overlayId: overlay.overlayId,
          expectedOwner,
        });
      }
    } else if (!edgeIds.has(overlay.anchor.edgeId)) {
      throw new ProjectFormatError("overlay-edge-reference-missing", {
        overlayId: overlay.overlayId,
      });
    } else {
      referencedEdgeIds.add(overlay.anchor.edgeId);
      const edge = project.managers.edgeManager.edges.find(
        (candidate: any) => candidate.edgeId === overlay.anchor.edgeId,
      );
      const owner = parseCellId(edge.adjacentCellIds[0]);
      const expectedOwner = chunkKey(owner.row, owner.column);
      if (ownedOverlayChunks.get(overlay.overlayId) !== expectedOwner) {
        throw new ProjectFormatError("overlay-owner-chunk-invalid", {
          overlayId: overlay.overlayId,
          expectedOwner,
        });
      }
    }
  }
  if (
    anchoredOverlayIds.size !== ownedOverlays.size ||
    [...anchoredOverlayIds].some((overlayId) => !ownedOverlays.has(overlayId))
  ) {
    throw new ProjectFormatError("overlay-owner-closure-invalid");
  }

  const connectionIds = new Set<string>();
  for (const connection of project.managers.connectionManager
    .connections as any[]) {
    if (connectionIds.has(connection.connectionId)) {
      throw new ProjectFormatError("connection-duplicate", {
        connectionId: connection.connectionId,
      });
    }
    connectionIds.add(connection.connectionId);
    registerInstance(
      connection.connectionId,
      connection.elementId,
      connection.layerId,
      `/managers/connectionManager/connections/${connection.connectionId}`,
    );
    validateKnownBasicInstance(
      {
        elementId: connection.elementId,
        layerId: connection.layerId,
        styleOverrides: connection.styleOverrides,
        attributes: connection.attributes,
      },
      `/managers/connectionManager/connections/${connection.connectionId}`,
      (code, details) => new ProjectFormatError(code, details),
    );
    validateKnownBasicPlacement(
      connection.elementId,
      connection.kind,
      `/managers/connectionManager/connections/${connection.connectionId}`,
      (code, details) => new ProjectFormatError(code, details),
    );
    if (connection.label !== null) {
      assertTextLimits(
        connection.label,
        `/managers/connectionManager/connections/${connection.connectionId}/label`,
        (code, details) => new ProjectFormatError(code, details),
      );
    }
    for (const [endpointName, endpoint] of [
      ["start", connection.start],
      ["end", connection.end],
    ] as const) {
      if (endpoint.kind === "cell-center") {
        const coordinate = parseCellId(endpoint.cellId);
        if (
          !endpoint.cellId.startsWith(`cell:${project.grid.type}:`) ||
          coordinate.row >= project.grid.height ||
          coordinate.column >= project.grid.width
        ) {
          throw new ProjectFormatError(
            "connection-cell-endpoint-out-of-bounds",
            { connectionId: connection.connectionId },
          );
        }
      } else if (
        endpoint.kind === "edge-midpoint" &&
        !edgeIds.has(endpoint.edgeId)
      ) {
        throw new ProjectFormatError("connection-edge-reference-missing", {
          connectionId: connection.connectionId,
        });
      } else if (endpoint.kind === "edge-midpoint") {
        referencedEdgeIds.add(endpoint.edgeId);
      } else {
        assertMapPointInsideGrid(
          grid,
          endpoint.point,
          `/managers/connectionManager/connections/${connection.connectionId}/${endpointName}/point`,
          (code, details) => new ProjectFormatError(code, details),
        );
      }
    }
  }
  for (const edge of project.managers.edgeManager.edges as any[]) {
    const basicInstance = edge.layerInstances.find(
      (instance: any) => instance.elementId === "tessera.basic:edge.style",
    );
    const onlyReferenceContent =
      edge.layerInstances.length === 0 ||
      (edge.layerInstances.length === 1 &&
        basicInstance?.attributes?.persistence === "reference-only");
    if (onlyReferenceContent && !referencedEdgeIds.has(edge.edgeId)) {
      throw new ProjectFormatError("reference-only-edge-orphan", {
        edgeId: edge.edgeId,
      });
    }
  }

  const domainGroupIds = new Set<string>();
  for (const group of project.domainGroups as any[]) {
    if (domainGroupIds.has(group.groupId)) {
      throw new ProjectFormatError("domain-group-duplicate", {
        groupId: group.groupId,
      });
    }
    domainGroupIds.add(group.groupId);
    registerInstance(
      group.groupId,
      group.elementId,
      group.layerId,
      `/domainGroups/${group.groupId}`,
    );
    if (group.elementId.startsWith("tessera.basic:")) {
      throw new ProjectFormatError("basic-domain-group-not-supported", {
        groupId: group.groupId,
      });
    }
    if (
      [...group.memberCellIds].sort(compareCellIds).join("\u0000") !==
      group.memberCellIds.join("\u0000")
    ) {
      throw new ProjectFormatError("domain-group-member-order-invalid", {
        groupId: group.groupId,
      });
    }
    for (const memberCellId of group.memberCellIds as string[]) {
      const coordinate = parseCellId(memberCellId);
      if (
        !memberCellId.startsWith(`cell:${project.grid.type}:`) ||
        coordinate.row >= project.grid.height ||
        coordinate.column >= project.grid.width
      ) {
        throw new ProjectFormatError("domain-group-member-out-of-bounds", {
          groupId: group.groupId,
          cellId: memberCellId,
        });
      }
    }
    const ownerCellId = group.memberCellIds[0] as string | undefined;
    if (ownerCellId === undefined) {
      throw new ProjectFormatError("domain-group-members-empty", {
        groupId: group.groupId,
      });
    }
    const owner = parseCellId(ownerCellId);
    const expectedOwner = chunkKey(owner.row, owner.column);
    if (ownedDomainGroups.get(group.groupId) !== expectedOwner) {
      throw new ProjectFormatError("domain-group-owner-invalid", {
        groupId: group.groupId,
        expectedOwner,
      });
    }
  }
  if (
    ownedDomainGroups.size !== domainGroupIds.size ||
    [...domainGroupIds].some((groupId) => !ownedDomainGroups.has(groupId))
  ) {
    throw new ProjectFormatError("domain-group-owner-closure-invalid");
  }

  validateEmbeddedAssets(
    project.embeddedAssets,
    (code, details) => new ProjectFormatError(code, details),
    "/embeddedAssets",
  );
  if (instanceIds.size > 2_000_000) {
    throw new ProjectFormatError("instance-count-limit-exceeded", {
      actualInstances: instanceIds.size,
      maxInstances: 2_000_000,
    });
  }
  const computedBounds = computeProjectContentBounds(project);
  if (!contentBoundsEqual(project.contentBounds, computedBounds)) {
    throw new ProjectFormatError("content-bounds-mismatch", {
      declared: project.contentBounds,
      computed: computedBounds,
    });
  }
}

export function toProjectV1(
  state: Readonly<ProjectState>,
  options: { readonly mode: ProjectSerializationMode } = { mode: "preserve" },
): ProjectV1Document {
  const chunks = new Map<string, ChunkRecord>();
  const ensureChunk = (row: number, column: number): ChunkRecord => {
    const key = chunkKey(row, column);
    const existing = chunks.get(key);
    if (existing !== undefined) return existing;
    const created: ChunkRecord = {
      chunkRow: Math.floor(row / 64),
      chunkColumn: Math.floor(column / 64),
      cellOverrides: [],
      ownedEdgeIds: [],
      ownedOverlayIds: [],
      ownedDomainGroupIds: [],
      extensions: {},
    };
    chunks.set(key, created);
    return created;
  };

  for (const cell of [...state.cells.values()].sort(
    (a, b) => a.row - b.row || a.column - b.column,
  )) {
    ensureChunk(cell.row, cell.column).cellOverrides.push({
      cellId: cell.cellId,
      layerInstances: [
        {
          instanceId: cell.instanceId,
          elementId: "tessera.basic:cell.color",
          layerId: "tessera.basic.cell-style",
          styleOverrides: {
            fillColor: cell.fillColor,
            fillOpacity: cell.fillOpacity,
          },
          attributes: { label: cell.label ?? null },
          extensions: {},
        },
      ],
      extensions: {},
    });
  }
  for (const edge of [...state.edges.values()].sort((a, b) =>
    a.edgeId.localeCompare(b.edgeId),
  )) {
    const owner = parseCellId(edge.adjacentCellIds[0] ?? "");
    ensureChunk(owner.row, owner.column).ownedEdgeIds.push(edge.edgeId);
  }
  for (const bucket of state.cells.buckets()) {
    const chunk = ensureChunk(bucket.chunkRow * 64, bucket.chunkColumn * 64);
    for (const overlayId of bucket.ownedOverlayIds) {
      if (!chunk.ownedOverlayIds.includes(overlayId)) {
        chunk.ownedOverlayIds.push(overlayId);
      }
    }
  }
  for (const chunk of chunks.values()) {
    chunk.ownedEdgeIds.sort(compareStableId);
    chunk.ownedOverlayIds.sort(compareStableId);
    chunk.ownedDomainGroupIds.sort(compareStableId);
  }

  const serializedChunks = [...chunks.values()].sort(
    (a, b) => a.chunkRow - b.chunkRow || a.chunkColumn - b.chunkColumn,
  );
  const project: Record<string, any> = {
    kind: "tessera-project",
    formatVersion: "1",
    createdWithAppVersion: "0.1.0",
    projectId: state.projectId,
    name: state.name,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    exportScope: "full",
    isComplete: true,
    lineage: null,
    grid: {
      type: state.grid.type,
      orientation: state.grid.type === "square" ? "axis-aligned" : "pointy",
      width: state.grid.width,
      height: state.grid.height,
      cellSize: state.grid.cellSize,
      coordinateEncoding: "row-column-zero-based",
      chunkSizeCells: 64,
      extensions: {},
    },
    modules: [
      {
        moduleId: "tessera.basic",
        version: BASIC_VERSION,
        packageSourceKind: "built-in",
        extensions: {},
      },
    ],
    layerStates: layerStates.map(([layerId, zIndex]) => {
      const stateLayer = state.layers.get(layerId);
      return {
        layerId,
        moduleVersion: BASIC_VERSION,
        zIndex,
        visible: stateLayer?.visible ?? true,
        locked: stateLayer?.locked ?? false,
        opacity: stateLayer?.opacity ?? 1,
        extensions: {},
      };
    }),
    mapStyle: {
      canvasBackground: state.style.canvasBackground,
      gridLineStyle: {
        strokeColor: state.style.gridColor,
        strokeOpacity: state.style.gridOpacity,
        strokeWidth: state.style.gridWidth,
      },
      defaultCellStyle: {
        fillColor: state.style.defaultCellColor,
        fillOpacity: 1,
      },
      defaultEdgeStyle: {
        strokeColor: state.style.defaultEdgeColor,
        strokeOpacity: 1,
        strokeWidth: state.style.gridWidth,
        lineCap: "round",
      },
      extensions: {},
    },
    contentBounds: null,
    chunks: serializedChunks,
    managers: {
      edgeManager: {
        formatVersion: "1",
        edges: [...state.edges.values()]
          .sort((a, b) => compareStableId(a.edgeId, b.edgeId))
          .map((edge) => ({
            kind: "edge",
            edgeId: edge.edgeId,
            adjacentCellIds: [...edge.adjacentCellIds],
            layerInstances: [
              {
                instanceId: edge.instanceId,
                elementId: "tessera.basic:edge.style",
                layerId: "tessera.basic.edge-style",
                styleOverrides: {
                  strokeColor: edge.strokeColor,
                  strokeOpacity: edge.strokeOpacity,
                  strokeWidth: edge.strokeWidth,
                  lineCap: "round",
                  lineStyle: edge.lineStyle,
                },
                attributes: { persistence: edge.persistence },
                extensions: {},
              },
            ],
            extensions: {},
          })),
        extensions: {},
      },
      connectionManager: {
        formatVersion: "1",
        connections: [...state.connections.values()]
          .sort((a, b) => compareStableId(a.connectionId, b.connectionId))
          .map(serializeConnection),
        extensions: {},
      },
      overlayManager: {
        formatVersion: "1",
        overlays: [...state.overlays.values()]
          .sort((a, b) => compareStableId(a.overlayId, b.overlayId))
          .map(serializeOverlay),
        extensions: {},
      },
    },
    domainGroups: [],
    embeddedAssets: [],
    viewState: null,
    extensions: {},
  };
  project.contentBounds = computeProjectContentBounds(project);
  let reconciled: ProjectV1Document;
  try {
    reconciled = reconcileProjectDocument(state, project, options.mode);
  } catch (error) {
    if (error instanceof ProjectReconcileError) {
      throw new ProjectFormatError(error.code, error.details);
    }
    throw error;
  }
  validateProjectDocumentV1(reconciled);
  return reconciled;
}

export function stringifyProjectV1(
  state: Readonly<ProjectState>,
  options: { readonly mode: ProjectSerializationMode } = { mode: "preserve" },
): string {
  return `${JSON.stringify(toProjectV1(state, options), null, 2)}\n`;
}

export function validateProjectDocumentV1(
  raw: unknown,
): asserts raw is ProjectV1Document {
  if (!projectValidator(raw)) {
    throw new ProjectFormatError(
      "project-schema-invalid",
      {},
      projectValidator.errors ?? [],
    );
  }
  validateSemanticClosure(raw as Record<string, any>);
}

export function parseProjectDocumentV1(text: string): ProjectV1Document {
  const raw = parseJsonWithSafetyLimits(
    text,
    (code, details) =>
      new ProjectFormatError(code.replace(/^format-/, "project-"), details),
  );
  validateProjectDocumentV1(raw);
  return raw;
}

export function stringifyProjectDocumentV1(project: ProjectV1Document): string {
  validateProjectDocumentV1(project);
  return `${JSON.stringify(project, null, 2)}\n`;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return value;
}

function stateFromProjectDocument(
  projectInput: ProjectV1Document,
): ProjectState {
  const project = projectInput as Record<string, any>;
  const cells = new Map<string, CellOverride>();
  for (const chunk of project.chunks as any[]) {
    for (const cell of chunk.cellOverrides as any[]) {
      const instance = cell.layerInstances.find(
        (item: any) =>
          item.elementId === "tessera.basic:cell.color" &&
          item.layerId === "tessera.basic.cell-style",
      );
      if (instance !== undefined) {
        const coordinate = parseCellId(cell.cellId as string);
        cells.set(cell.cellId as string, {
          instanceId: instance.instanceId,
          cellId: cell.cellId,
          ...coordinate,
          fillColor: instance.styleOverrides.fillColor,
          fillOpacity: instance.styleOverrides.fillOpacity,
          ...(typeof instance.attributes.label === "string"
            ? { label: instance.attributes.label }
            : {}),
        });
      }
    }
  }
  const edgeValues: EdgeOverride[] = [];
  for (const edge of project.managers.edgeManager.edges as any[]) {
    const instance = edge.layerInstances.find(
      (item: any) =>
        item.elementId === "tessera.basic:edge.style" &&
        item.layerId === "tessera.basic.edge-style",
    );
    if (instance !== undefined)
      edgeValues.push({
        instanceId: instance.instanceId,
        edgeId: edge.edgeId,
        adjacentCellIds: edge.adjacentCellIds,
        strokeColor: instance.styleOverrides.strokeColor,
        strokeWidth: instance.styleOverrides.strokeWidth,
        strokeOpacity: instance.styleOverrides.strokeOpacity,
        lineStyle: instance.styleOverrides.lineStyle ?? "solid",
        persistence: instance.attributes.persistence ?? "explicit-style",
      });
  }
  const cellStore = new SparseChunkStore(cells.values());
  for (const chunk of project.chunks as any[]) {
    for (const edgeId of chunk.ownedEdgeIds as string[]) {
      const edge = project.managers.edgeManager.edges.find(
        (candidate: any) => candidate.edgeId === edgeId,
      );
      const ownerCellId = edge?.adjacentCellIds?.[0];
      if (typeof ownerCellId === "string")
        cellStore.assignEdge(edgeId, ownerCellId);
    }
    for (const overlayId of chunk.ownedOverlayIds as string[]) {
      const overlay = project.managers.overlayManager.overlays.find(
        (candidate: any) => candidate.overlayId === overlayId,
      );
      if (
        overlay?.kind === "anchored-overlay" &&
        overlay.anchor?.kind === "cell"
      ) {
        cellStore.assignOverlay(overlayId, overlay.anchor.cellId);
      } else if (
        overlay?.kind === "anchored-overlay" &&
        overlay.anchor?.kind === "edge"
      ) {
        const edge = project.managers.edgeManager.edges.find(
          (candidate: any) => candidate.edgeId === overlay.anchor.edgeId,
        );
        const ownerCellId = edge?.adjacentCellIds?.[0];
        if (typeof ownerCellId === "string") {
          cellStore.assignOverlay(overlayId, ownerCellId);
        }
      }
    }
  }
  const layers = createFixedLayerMap() as Map<string, any>;
  for (const layer of project.layerStates as any[]) {
    const current = layers.get(layer.layerId);
    if (current !== undefined) {
      layers.set(layer.layerId, {
        ...current,
        visible: layer.visible,
        locked: layer.locked,
        opacity: layer.opacity,
      });
    }
  }
  const state: ProjectState = {
    projectId: project.projectId,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    grid: {
      type: project.grid.type,
      width: project.grid.width,
      height: project.grid.height,
      cellSize: project.grid.cellSize,
    },
    style: {
      canvasBackground: project.mapStyle.canvasBackground,
      defaultCellColor: project.mapStyle.defaultCellStyle.fillColor,
      gridColor: project.mapStyle.gridLineStyle.strokeColor,
      gridOpacity: project.mapStyle.gridLineStyle.strokeOpacity,
      gridWidth: project.mapStyle.gridLineStyle.strokeWidth,
      defaultEdgeColor: project.mapStyle.defaultEdgeStyle.strokeColor,
    },
    cells: cellStore,
    edges: new EdgeManager(edgeValues),
    connections: new ConnectionManager(
      project.managers.connectionManager.connections
        .filter(
          (connection: any) =>
            connection.layerId === "tessera.basic.connection" &&
            [
              "tessera.basic:connection.line",
              "tessera.basic:connection.arrow",
            ].includes(connection.elementId),
        )
        .map(parseConnection),
    ),
    overlays: new OverlayManager(
      project.managers.overlayManager.overlays
        .filter(
          (overlay: any) =>
            (overlay.elementId === "tessera.basic:marker" &&
              overlay.layerId === "tessera.basic.placed-object") ||
            (overlay.elementId === "tessera.basic:text" &&
              overlay.layerId === "tessera.basic.annotation"),
        )
        .map(parseOverlay),
    ),
    layers,
    formatSource: deepFreeze({
      exportScope: project.exportScope,
      isComplete: project.isComplete,
      lineage: structuredClone(project.lineage),
      opaqueDocument: deepFreeze(structuredClone(projectInput)),
    }),
    revision: 0,
    lastTransactionId: null,
  };
  Object.defineProperty(state, "formatSource", {
    value: state.formatSource,
    writable: false,
    configurable: false,
    enumerable: true,
  });
  return state;
}

/** 内部修订恢复专用：严格保留 projectId 与 Project 范围身份。 */
export function restoreProjectV1(text: string): ProjectState {
  return stateFromProjectDocument(parseProjectDocumentV1(text));
}

export interface ExternalProjectImportOptions {
  readonly currentProjectId: string | null;
  readonly sameProjectIdPolicy: "copy" | "replace";
  readonly uuidGenerator?: () => string;
}

export interface PreparedExternalProjectV1 {
  readonly metadata: Readonly<{
    projectId: string;
    name: string;
    exportScope: ProjectV1Document["exportScope"];
  }>;
  toState(options: ExternalProjectImportOptions): ProjectState;
}

function stateFromExternalProjectDocument(
  parsed: ProjectV1Document,
  options: ExternalProjectImportOptions,
): ProjectState {
  if (!(["copy", "replace"] as const).includes(options.sameProjectIdPolicy)) {
    throw new ProjectFormatError("project-import-policy-invalid", {
      sameProjectIdPolicy: options.sameProjectIdPolicy,
    });
  }
  const mustCopy =
    parsed.exportScope === "partial" ||
    (options.currentProjectId === parsed.projectId &&
      options.sameProjectIdPolicy === "copy");
  if (!mustCopy) return stateFromProjectDocument(parsed);
  const nextProjectId = (
    options.uuidGenerator ?? (() => crypto.randomUUID())
  )();
  if (nextProjectId === parsed.projectId) {
    throw new ProjectFormatError("project-import-copy-id-collision", {
      projectId: parsed.projectId,
    });
  }
  // parsed 只存在于 prepared 闭包内；原地替换 ID 可避免大型文档再复制一份。
  const previousProjectId = parsed.projectId;
  parsed.projectId = nextProjectId;
  try {
    validateProjectDocumentV1(parsed);
    return stateFromProjectDocument(parsed);
  } catch (error) {
    parsed.projectId = previousProjectId;
    throw error;
  }
}

/**
 * 解析和校验外部 Project 一次，并以闭包封装已验证文档，避免调用方伪造
 * “已验证”类型或在确认身份策略后再次解析大型 JSON。
 */
export function prepareExternalProjectV1(
  text: string,
): PreparedExternalProjectV1 {
  const parsed = parseProjectDocumentV1(text);
  let consumed = false;
  return Object.freeze({
    metadata: Object.freeze({
      projectId: parsed.projectId,
      name: parsed.name,
      exportScope: parsed.exportScope,
    }),
    toState: (options: ExternalProjectImportOptions) => {
      if (consumed) {
        throw new ProjectFormatError("project-import-prepared-consumed");
      }
      const state = stateFromExternalProjectDocument(parsed, options);
      consumed = true;
      return state;
    },
  });
}

/**
 * 外部文件载入专用。partial 始终派生新工程；full 仅在同 ID 时应用显式策略。
 */
export function importExternalProjectV1(
  text: string,
  options: ExternalProjectImportOptions,
): ProjectState {
  return prepareExternalProjectV1(text).toState(options);
}

/** @deprecated 仅为旧调用保留；内部恢复请显式使用 restoreProjectV1。 */
export function parseProjectV1(text: string): ProjectState {
  return restoreProjectV1(text);
}
