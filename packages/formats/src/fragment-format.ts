import { parseCellId, type ProjectGrid } from "@tessera/core";
import type { ErrorObject } from "ajv";
import {
  compareCellId,
  compareLayerInstance,
  compareStableId,
  isSortedUnique,
} from "./deterministic-order.js";
import { validateEmbeddedAssets } from "./embedded-asset-validation.js";
import type { FragmentV1Document } from "./format-types.js";
import validateFragment from "./fragment-validator.generated.js";
import { parseJsonWithSafetyLimits } from "./json-input.js";
import {
  assertCanonicalEdge,
  assertMapPointInsideGrid,
  assertTextLimits,
  compareCellIds,
  validateKnownBasicPlacement,
  validateKnownBasicInstance,
} from "./semantic-helpers.js";

const fragmentValidator = validateFragment as typeof validateFragment & {
  errors?: ErrorObject[] | null;
};

export class FragmentFormatError extends Error {
  constructor(
    readonly code: string,
    readonly details: Readonly<Record<string, unknown>> = {},
    readonly issues: readonly ErrorObject[] = [],
  ) {
    super(code);
    this.name = "FragmentFormatError";
  }
}

function assertBounds(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  pointer: string,
): void {
  if (bounds.minX > bounds.maxX || bounds.minY > bounds.maxY) {
    throw new FragmentFormatError("fragment-bounds-order-invalid", {
      pointer,
    });
  }
}

function assertCellInSource(
  cellId: string,
  sourceGrid: Record<string, any>,
  pointer: string,
): void {
  const coordinate = parseCellId(cellId);
  if (
    !cellId.startsWith(`cell:${sourceGrid.type}:`) ||
    coordinate.row >= sourceGrid.height ||
    coordinate.column >= sourceGrid.width
  ) {
    throw new FragmentFormatError("fragment-cell-out-of-bounds", {
      cellId,
      pointer,
    });
  }
}

function validateFragmentSemanticClosure(fragment: Record<string, any>): void {
  const sourceGrid = fragment.sourceGrid;
  if (
    (sourceGrid.type === "square" &&
      sourceGrid.orientation !== "axis-aligned") ||
    (sourceGrid.type === "hex-pointy" && sourceGrid.orientation !== "pointy")
  ) {
    throw new FragmentFormatError("fragment-grid-orientation-mismatch");
  }
  assertBounds(fragment.fragmentBounds, "/fragmentBounds");

  const moduleIds = new Set<string>();
  if (
    !isSortedUnique(fragment.requiredModules, (left: any, right: any) =>
      compareStableId(left.moduleId, right.moduleId),
    )
  ) {
    throw new FragmentFormatError("fragment-module-order-invalid");
  }
  for (const module of fragment.requiredModules as any[]) {
    if (moduleIds.has(module.moduleId)) {
      throw new FragmentFormatError("fragment-module-duplicate", {
        moduleId: module.moduleId,
      });
    }
    moduleIds.add(module.moduleId);
  }
  const requiredLayerIds = fragment.requiredLayerIds as string[];
  if (
    [...requiredLayerIds].sort().join("\u0000") !==
    requiredLayerIds.join("\u0000")
  ) {
    throw new FragmentFormatError("fragment-layer-order-invalid");
  }
  const layerIds = new Set(requiredLayerIds);
  const usedLayerIds = new Set<string>();
  const usedModuleIds = new Set<string>();
  const instanceIds = new Set<string>();
  const registerInstance = (
    instanceId: string,
    elementId: string,
    layerId: string,
    pointer: string,
    structuralReference = false,
  ): void => {
    if (instanceIds.has(instanceId)) {
      throw new FragmentFormatError("fragment-instance-id-duplicate", {
        instanceId,
        pointer,
      });
    }
    instanceIds.add(instanceId);
    if (!layerIds.has(layerId) && !structuralReference) {
      throw new FragmentFormatError("fragment-layer-reference-missing", {
        layerId,
        pointer,
      });
    }
    if (!structuralReference) usedLayerIds.add(layerId);
    const separator = elementId.indexOf(":");
    const moduleId = separator < 0 ? "" : elementId.slice(0, separator);
    if (!moduleIds.has(moduleId)) {
      throw new FragmentFormatError("fragment-module-reference-missing", {
        elementId,
        pointer,
      });
    }
    usedModuleIds.add(moduleId);
  };

  const cellIds = new Set<string>();
  if (
    !isSortedUnique(fragment.objects.cellOverrides, (left: any, right: any) =>
      compareCellId(left.cellId, right.cellId),
    ) ||
    !isSortedUnique(fragment.objects.edges, (left: any, right: any) =>
      compareStableId(left.edgeId, right.edgeId),
    ) ||
    !isSortedUnique(fragment.objects.connections, (left: any, right: any) =>
      compareStableId(left.connectionId, right.connectionId),
    ) ||
    !isSortedUnique(fragment.objects.overlays, (left: any, right: any) =>
      compareStableId(left.overlayId, right.overlayId),
    ) ||
    !isSortedUnique(fragment.objects.domainGroups, (left: any, right: any) =>
      compareStableId(left.groupId, right.groupId),
    ) ||
    !isSortedUnique(fragment.objects.embeddedAssets, (left: any, right: any) =>
      compareStableId(left.assetId, right.assetId),
    )
  ) {
    throw new FragmentFormatError("fragment-object-order-invalid");
  }
  for (const cell of fragment.objects.cellOverrides as any[]) {
    assertCellInSource(
      cell.cellId,
      sourceGrid,
      `/objects/cellOverrides/${cell.cellId}`,
    );
    if (cellIds.has(cell.cellId)) {
      throw new FragmentFormatError("fragment-cell-duplicate", {
        cellId: cell.cellId,
      });
    }
    cellIds.add(cell.cellId);
    if (!isSortedUnique(cell.layerInstances, compareLayerInstance)) {
      throw new FragmentFormatError("layer-instance-order-invalid", {
        cellId: cell.cellId,
      });
    }
    for (const instance of cell.layerInstances as any[]) {
      const pointer = `/objects/cellOverrides/${cell.cellId}/layerInstances/${instance.instanceId}`;
      registerInstance(
        instance.instanceId,
        instance.elementId,
        instance.layerId,
        pointer,
      );
      validateKnownBasicInstance(
        instance,
        pointer,
        (code, details) => new FragmentFormatError(code, details),
      );
      validateKnownBasicPlacement(
        instance.elementId,
        "cell",
        pointer,
        (code, details) => new FragmentFormatError(code, details),
      );
    }
  }

  const grid: ProjectGrid = {
    type: sourceGrid.type,
    width: sourceGrid.width,
    height: sourceGrid.height,
    cellSize: sourceGrid.cellSize,
  };
  const edgeIds = new Set<string>();
  for (const edge of fragment.objects.edges as any[]) {
    if (edgeIds.has(edge.edgeId)) {
      throw new FragmentFormatError("fragment-edge-duplicate", {
        edgeId: edge.edgeId,
      });
    }
    edgeIds.add(edge.edgeId);
    if (!isSortedUnique(edge.layerInstances, compareLayerInstance)) {
      throw new FragmentFormatError("layer-instance-order-invalid", {
        edgeId: edge.edgeId,
      });
    }
    for (const adjacentCellId of edge.adjacentCellIds as string[]) {
      assertCellInSource(
        adjacentCellId,
        sourceGrid,
        `/objects/edges/${edge.edgeId}/adjacentCellIds`,
      );
    }
    const edgePointer = `/objects/edges/${edge.edgeId}`;
    assertCanonicalEdge(
      grid,
      edge.edgeId,
      edge.adjacentCellIds,
      edgePointer,
      (code, details) => new FragmentFormatError(code, details),
    );
    for (const instance of edge.layerInstances as any[]) {
      const pointer = `${edgePointer}/layerInstances/${instance.instanceId}`;
      const structuralReference =
        instance.elementId === "tessera.basic:edge.style" &&
        instance.layerId === "tessera.basic.edge-style" &&
        instance.attributes?.persistence === "reference-only" &&
        !layerIds.has(instance.layerId);
      registerInstance(
        instance.instanceId,
        instance.elementId,
        instance.layerId,
        pointer,
        structuralReference,
      );
      validateKnownBasicInstance(
        instance,
        pointer,
        (code, details) => new FragmentFormatError(code, details),
      );
      validateKnownBasicPlacement(
        instance.elementId,
        "edge",
        pointer,
        (code, details) => new FragmentFormatError(code, details),
      );
    }
  }

  const referencedEdgeIds = new Set<string>();
  for (const overlay of fragment.objects.overlays as any[]) {
    registerInstance(
      overlay.overlayId,
      overlay.elementId,
      overlay.layerId,
      `/objects/overlays/${overlay.overlayId}`,
    );
    validateKnownBasicInstance(
      {
        elementId: overlay.elementId,
        layerId: overlay.layerId,
        styleOverrides: overlay.styleOverrides,
        attributes: overlay.attributes,
      },
      `/objects/overlays/${overlay.overlayId}`,
      (code, details) => new FragmentFormatError(code, details),
    );
    validateKnownBasicPlacement(
      overlay.elementId,
      overlay.overlayType === "marker" ? "marker-overlay" : "text-overlay",
      `/objects/overlays/${overlay.overlayId}`,
      (code, details) => new FragmentFormatError(code, details),
    );
    if (overlay.kind === "free-overlay") {
      assertMapPointInsideGrid(
        grid,
        overlay.point,
        `/objects/overlays/${overlay.overlayId}/point`,
        (code, details) => new FragmentFormatError(code, details),
      );
      continue;
    }
    if (overlay.anchor.kind === "cell") {
      assertCellInSource(
        overlay.anchor.cellId,
        sourceGrid,
        `/objects/overlays/${overlay.overlayId}/anchor`,
      );
    } else if (!edgeIds.has(overlay.anchor.edgeId)) {
      throw new FragmentFormatError("fragment-overlay-edge-reference-missing", {
        overlayId: overlay.overlayId,
        edgeId: overlay.anchor.edgeId,
      });
    } else {
      referencedEdgeIds.add(overlay.anchor.edgeId);
    }
  }

  for (const connection of fragment.objects.connections as any[]) {
    registerInstance(
      connection.connectionId,
      connection.elementId,
      connection.layerId,
      `/objects/connections/${connection.connectionId}`,
    );
    validateKnownBasicInstance(
      {
        elementId: connection.elementId,
        layerId: connection.layerId,
        styleOverrides: connection.styleOverrides,
        attributes: connection.attributes,
      },
      `/objects/connections/${connection.connectionId}`,
      (code, details) => new FragmentFormatError(code, details),
    );
    validateKnownBasicPlacement(
      connection.elementId,
      connection.kind,
      `/objects/connections/${connection.connectionId}`,
      (code, details) => new FragmentFormatError(code, details),
    );
    if (connection.label !== null) {
      assertTextLimits(
        connection.label,
        `/objects/connections/${connection.connectionId}/label`,
        (code, details) => new FragmentFormatError(code, details),
      );
    }
    for (const [endpointName, endpoint] of [
      ["start", connection.start],
      ["end", connection.end],
    ] as const) {
      if (endpoint.kind === "cell-center") {
        assertCellInSource(
          endpoint.cellId,
          sourceGrid,
          `/objects/connections/${connection.connectionId}`,
        );
      } else if (
        endpoint.kind === "edge-midpoint" &&
        !edgeIds.has(endpoint.edgeId)
      ) {
        throw new FragmentFormatError(
          "fragment-connection-edge-reference-missing",
          {
            connectionId: connection.connectionId,
            edgeId: endpoint.edgeId,
          },
        );
      } else if (endpoint.kind === "edge-midpoint") {
        referencedEdgeIds.add(endpoint.edgeId);
      } else {
        assertMapPointInsideGrid(
          grid,
          endpoint.point,
          `/objects/connections/${connection.connectionId}/${endpointName}/point`,
          (code, details) => new FragmentFormatError(code, details),
        );
      }
    }
  }
  for (const edge of fragment.objects.edges as any[]) {
    const basicInstance = edge.layerInstances.find(
      (instance: any) => instance.elementId === "tessera.basic:edge.style",
    );
    const onlyReferenceContent =
      edge.layerInstances.length === 0 ||
      (edge.layerInstances.length === 1 &&
        basicInstance?.attributes?.persistence === "reference-only");
    if (onlyReferenceContent && !referencedEdgeIds.has(edge.edgeId)) {
      throw new FragmentFormatError("reference-only-edge-orphan", {
        edgeId: edge.edgeId,
      });
    }
  }

  for (const group of fragment.objects.domainGroups as any[]) {
    registerInstance(
      group.groupId,
      group.elementId,
      group.layerId,
      `/objects/domainGroups/${group.groupId}`,
    );
    const pointer = `/objects/domainGroups/${group.groupId}`;
    validateKnownBasicInstance(
      group,
      pointer,
      (code, details) => new FragmentFormatError(code, details),
    );
    validateKnownBasicPlacement(
      group.elementId,
      "domain-group",
      pointer,
      (code, details) => new FragmentFormatError(code, details),
    );
    if (
      [...group.memberCellIds].sort(compareCellIds).join("\u0000") !==
      group.memberCellIds.join("\u0000")
    ) {
      throw new FragmentFormatError("domain-group-member-order-invalid", {
        groupId: group.groupId,
      });
    }
    for (const memberCellId of group.memberCellIds as string[]) {
      assertCellInSource(
        memberCellId,
        sourceGrid,
        `/objects/domainGroups/${group.groupId}/memberCellIds`,
      );
    }
  }

  validateEmbeddedAssets(
    fragment.objects.embeddedAssets,
    (code, details) => new FragmentFormatError(code, details),
    "/objects/embeddedAssets",
  );

  if (
    [...usedLayerIds].some((layerId) => !layerIds.has(layerId)) ||
    [...layerIds].some((layerId) => !usedLayerIds.has(layerId))
  ) {
    throw new FragmentFormatError("fragment-required-layer-set-invalid");
  }
  if (
    [...usedModuleIds].some((moduleId) => !moduleIds.has(moduleId)) ||
    [...moduleIds].some((moduleId) => !usedModuleIds.has(moduleId))
  ) {
    throw new FragmentFormatError("fragment-required-module-set-invalid");
  }
  if (instanceIds.size > 2_000_000) {
    throw new FragmentFormatError("fragment-instance-count-limit-exceeded", {
      actualInstances: instanceIds.size,
      maxInstances: 2_000_000,
    });
  }
}

export function validateFragmentDocumentV1(
  raw: unknown,
): asserts raw is FragmentV1Document {
  if (!fragmentValidator(raw)) {
    throw new FragmentFormatError(
      "fragment-schema-invalid",
      {},
      fragmentValidator.errors ?? [],
    );
  }
  validateFragmentSemanticClosure(raw as Record<string, any>);
}

export function parseFragmentV1(text: string): FragmentV1Document {
  const raw = parseJsonWithSafetyLimits(
    text,
    (code, details) =>
      new FragmentFormatError(code.replace(/^format-/, "fragment-"), details),
  );
  validateFragmentDocumentV1(raw);
  return raw;
}

export function stringifyFragmentV1(fragment: FragmentV1Document): string {
  validateFragmentDocumentV1(fragment);
  return `${JSON.stringify(fragment, null, 2)}\n`;
}
