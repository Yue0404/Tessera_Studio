import type {
  ConnectionData,
  ConnectionEndpoint,
  OverlayData,
  ProjectState,
} from "@tessera/core";
import { VisualExportError } from "./error.js";
import { assertValidExtensionPrimitive } from "./primitive-validation.js";
import type {
  SnapshotConnection,
  SnapshotOverlay,
  VisualExportCaptureOptions,
  VisualExportSnapshot,
  VisualPrimitive,
} from "./types.js";

function compareCodePoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function copyEndpoint(endpoint: ConnectionEndpoint): ConnectionEndpoint {
  if (endpoint.kind === "map-point") {
    return { kind: endpoint.kind, point: { ...endpoint.point } };
  }
  return endpoint.kind === "cell-center"
    ? { kind: endpoint.kind, cellId: endpoint.cellId }
    : { kind: endpoint.kind, edgeId: endpoint.edgeId };
}

function copyConnection(connection: ConnectionData): SnapshotConnection {
  const common = {
    connectionId: connection.connectionId,
    layerId: connection.layerId,
    start: copyEndpoint(connection.start),
    end: copyEndpoint(connection.end),
    style: { ...connection.style },
    label: connection.label,
  };
  return connection.kind === "arrow"
    ? {
        ...common,
        kind: connection.kind,
        elementId: connection.elementId,
        arrowStart: connection.arrowStart,
        arrowEnd: connection.arrowEnd,
      }
    : {
        ...common,
        kind: connection.kind,
        elementId: connection.elementId,
      };
}

function copyOverlay(overlay: OverlayData): SnapshotOverlay {
  const location =
    overlay.kind === "free-overlay"
      ? { kind: overlay.kind, point: { ...overlay.point } }
      : {
          kind: overlay.kind,
          anchor:
            overlay.anchor.kind === "cell"
              ? { kind: overlay.anchor.kind, cellId: overlay.anchor.cellId }
              : { kind: overlay.anchor.kind, edgeId: overlay.anchor.edgeId },
        };
  return overlay.overlayType === "marker"
    ? {
        ...location,
        overlayId: overlay.overlayId,
        layerId: overlay.layerId,
        orderInLayer: overlay.orderInLayer,
        overlayType: overlay.overlayType,
        elementId: overlay.elementId,
        style: { ...overlay.style },
        text: null,
      }
    : {
        ...location,
        overlayId: overlay.overlayId,
        layerId: overlay.layerId,
        orderInLayer: overlay.orderInLayer,
        overlayType: overlay.overlayType,
        elementId: overlay.elementId,
        style: { ...overlay.style },
        text: overlay.text,
      };
}

function assertCloneable(value: unknown, elementId: string): void {
  try {
    structuredClone(value);
  } catch {
    throw new VisualExportError("visual-export-extension-not-cloneable", {
      elementId,
    });
  }
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object") return value;
  const object = value as object;
  if (seen.has(object)) return value;
  seen.add(object);
  for (const child of Object.values(object)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function captureExtensions(
  state: Readonly<ProjectState>,
  options: VisualExportCaptureOptions,
) {
  const renderers = new Map(
    (options.extensionRenderers ?? []).map((renderer) => [
      renderer.elementId,
      renderer,
    ]),
  );
  const required = [...new Set(options.requiredExtensionElementIds ?? [])].sort(
    compareCodePoint,
  );
  for (const elementId of required) {
    if (!renderers.has(elementId)) {
      throw new VisualExportError("visual-export-extension-renderer-missing", {
        elementId,
      });
    }
  }
  return [...renderers.values()]
    .sort((left, right) => compareCodePoint(left.elementId, right.elementId))
    .map((renderer) => {
      const descriptors = renderer.capture(state) ?? [];
      assertCloneable(descriptors, renderer.elementId);
      const cloned = structuredClone(descriptors) as readonly VisualPrimitive[];
      cloned.forEach((primitive, descriptorIndex) =>
        assertValidExtensionPrimitive(
          state,
          primitive,
          renderer.elementId,
          descriptorIndex,
        ),
      );
      return {
        elementId: renderer.elementId,
        descriptors: cloned,
      };
    });
}

/** 捕获后只包含可结构化克隆的普通数据，不保留任何 Manager 引用。 */
export function captureVisualExportSnapshot(
  state: Readonly<ProjectState>,
  options: VisualExportCaptureOptions = {},
): VisualExportSnapshot {
  const layers = [...state.layers.values()]
    .map((layer) => ({ ...layer, allowedKinds: [...layer.allowedKinds] }))
    .sort(
      (left, right) =>
        left.zIndex - right.zIndex ||
        compareCodePoint(left.layerId, right.layerId),
    );
  const cells = [...state.cells.values()]
    .map((cell) => ({
      ...cell,
      label: cell.label ?? null,
    }))
    .sort(
      (left, right) =>
        left.row - right.row ||
        left.column - right.column ||
        compareCodePoint(left.instanceId, right.instanceId),
    );
  const edges = [...state.edges.values()]
    .map((edge) => ({
      instanceId: edge.instanceId,
      edgeId: edge.edgeId,
      adjacentCellIds: [...edge.adjacentCellIds],
      strokeColor: edge.strokeColor,
      strokeWidth: edge.strokeWidth,
      strokeOpacity: edge.strokeOpacity,
      lineStyle: edge.lineStyle,
      persistence: edge.persistence,
    }))
    .sort((left, right) => compareCodePoint(left.edgeId, right.edgeId));
  const connections = [...state.connections.values()]
    .map(copyConnection)
    .sort((left, right) =>
      compareCodePoint(left.connectionId, right.connectionId),
    );
  const overlays = [...state.overlays.values()]
    .map(copyOverlay)
    .sort(
      (left, right) =>
        left.orderInLayer - right.orderInLayer ||
        compareCodePoint(left.overlayId, right.overlayId),
    );
  return deepFreeze({
    projectId: state.projectId,
    revision: state.revision,
    grid: { ...state.grid },
    style: { ...state.style },
    layers,
    cells,
    edges,
    connections,
    overlays,
    extensions: captureExtensions(state, options),
  });
}
