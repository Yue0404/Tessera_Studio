import type {
  ConnectionData,
  ConnectionEndpoint,
  OverlayData,
  ProjectState,
} from "@tessera/core";
import { VisualExportError } from "./error.js";
import {
  GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER,
  genericModuleResourceKey,
  type GenericModuleResourceIdentity,
} from "../generic-module-assets.js";
import { assertValidExtensionPrimitive } from "./primitive-validation.js";
import type {
  SnapshotConnection,
  SnapshotOverlay,
  VisualExportCaptureOptions,
  VisualExportSnapshot,
  VisualPrimitive,
  VisualExportResourceSnapshot,
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
  if (ArrayBuffer.isView(value)) return value;
  const object = value as object;
  if (seen.has(object)) return value;
  seen.add(object);
  for (const child of Object.values(object)) deepFreeze(child, seen);
  return Object.freeze(value);
}

interface CapturedResourceCandidate {
  readonly exactKey: string;
  readonly snapshot:
    | Omit<Extract<VisualExportResourceSnapshot, { kind: "image" }>, "key">
    | Omit<Extract<VisualExportResourceSnapshot, { kind: "font" }>, "key">;
}

function resourceIdentityKey(identity: GenericModuleResourceIdentity): string {
  try {
    return genericModuleResourceKey(identity);
  } catch {
    throw new VisualExportError("visual-export-extension-resource-invalid");
  }
}

function failurePlaceholder(primitive: VisualPrimitive): VisualPrimitive {
  const color = GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER.primaryColor;
  if (primitive.kind === "polygon") {
    const { patternResource, ...rest } = primitive;
    void patternResource;
    return {
      ...rest,
      fillColor: color,
      opacity: Math.max(0.8, rest.opacity),
      resourcePlaceholder: "pattern",
    };
  }
  if (primitive.kind === "marker") {
    const { imageResource, ...rest } = primitive;
    void imageResource;
    return {
      ...rest,
      shape: "diamond",
      color,
      opacity: Math.max(0.8, rest.opacity),
      resourcePlaceholder: "marker",
    };
  }
  if (primitive.kind === "text") {
    const { fontResource, ...rest } = primitive;
    void fontResource;
    return {
      ...rest,
      color: GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER.secondaryColor,
      backgroundColor:
        GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER.textBackgroundColor,
      opacity: Math.max(0.8, rest.opacity),
      resourcePlaceholder: "text",
    };
  }
  return primitive;
}

function captureResourcePrimitive(
  primitive: VisualPrimitive,
  options: VisualExportCaptureOptions,
  candidates: Map<string, CapturedResourceCandidate>,
): VisualPrimitive {
  const identity =
    primitive.kind === "polygon"
      ? primitive.patternResource?.identity
      : primitive.kind === "marker"
        ? primitive.imageResource
        : primitive.kind === "text"
          ? primitive.fontResource
          : undefined;
  if (identity === undefined) return primitive;
  const exactKey = resourceIdentityKey(identity);
  if (options.deferResourceCapture === true) {
    return primitive;
  }
  let state;
  try {
    state = options.resolveResource?.(identity);
  } catch {
    return failurePlaceholder(primitive);
  }
  if (state?.status !== "ready" || state.resource.kind === "json") {
    return failurePlaceholder(primitive);
  }
  if (
    (primitive.kind === "text" && state.resource.kind !== "font") ||
    (primitive.kind !== "text" && state.resource.kind !== "image")
  ) {
    return failurePlaceholder(primitive);
  }
  if (!candidates.has(exactKey)) {
    const frozenResourceIdentity = Object.freeze({ ...identity });
    const bytes = new Uint8Array(state.resource.bytes);
    candidates.set(exactKey, {
      exactKey,
      snapshot:
        state.resource.kind === "image"
          ? {
              identity: frozenResourceIdentity,
              kind: "image",
              mimeType: state.resource.mimeType,
              bytes,
              width: state.resource.width,
              height: state.resource.height,
            }
          : {
              identity: frozenResourceIdentity,
              kind: "font",
              mimeType: state.resource.mimeType,
              bytes,
              family: state.resource.family,
            },
    });
  }
  if (primitive.kind === "polygon") {
    const patternScale = primitive.patternResource?.scale ?? 1;
    const { patternResource, ...rest } = primitive;
    void patternResource;
    return {
      ...rest,
      patternResourceKey: exactKey,
      patternScale,
    };
  }
  if (primitive.kind === "marker") {
    const { imageResource, ...rest } = primitive;
    void imageResource;
    return { ...rest, imageResourceKey: exactKey };
  }
  if (primitive.kind === "text") {
    const { fontResource, ...rest } = primitive;
    void fontResource;
    return { ...rest, fontResourceKey: exactKey };
  }
  return primitive;
}

function finalizeCapturedResources(
  extensions: readonly {
    elementId: string;
    descriptors: readonly VisualPrimitive[];
  }[],
  candidates: ReadonlyMap<string, CapturedResourceCandidate>,
) {
  const ordered = [...candidates.values()].sort((left, right) =>
    compareCodePoint(left.exactKey, right.exactKey),
  );
  const safeKeyByExact = new Map(
    ordered.map((candidate, index) => [
      candidate.exactKey,
      `resource-${index.toString().padStart(6, "0")}`,
    ]),
  );
  const resources: readonly VisualExportResourceSnapshot[] = ordered.map(
    (candidate): VisualExportResourceSnapshot =>
      candidate.snapshot.kind === "image"
        ? {
            ...candidate.snapshot,
            key: safeKeyByExact.get(candidate.exactKey) ?? "resource-invalid",
          }
        : {
            ...candidate.snapshot,
            key: safeKeyByExact.get(candidate.exactKey) ?? "resource-invalid",
          },
  );
  const totalBytes = resources.reduce(
    (total, resource) => total + resource.bytes.byteLength,
    0,
  );
  if (totalBytes > 32 * 1024 * 1024) {
    throw new VisualExportError("visual-export-resource-byte-limit-exceeded", {
      actualBytes: totalBytes,
      maxBytes: 32 * 1024 * 1024,
    });
  }
  return {
    resources,
    extensions: extensions.map((extension) => ({
      ...extension,
      descriptors: extension.descriptors.map((primitive) => {
        if (primitive.kind === "polygon" && primitive.patternResourceKey) {
          return {
            ...primitive,
            patternResourceKey:
              safeKeyByExact.get(primitive.patternResourceKey) ??
              "resource-invalid",
          };
        }
        if (primitive.kind === "marker" && primitive.imageResourceKey) {
          return {
            ...primitive,
            imageResourceKey:
              safeKeyByExact.get(primitive.imageResourceKey) ??
              "resource-invalid",
          };
        }
        if (primitive.kind === "text" && primitive.fontResourceKey) {
          return {
            ...primitive,
            fontResourceKey:
              safeKeyByExact.get(primitive.fontResourceKey) ??
              "resource-invalid",
          };
        }
        return primitive;
      }),
    })),
  };
}

/**
 * 在不再次读取可变 ProjectState 的前提下，为已裁剪的冻结快照注入资源。
 * 调用方必须先完成所需资源的异步预取；未就绪资源会得到统一占位描述符。
 */
export function hydrateVisualExportSnapshotResources(
  snapshot: VisualExportSnapshot,
  options: VisualExportCaptureOptions,
  identities: readonly GenericModuleResourceIdentity[],
): VisualExportSnapshot {
  if (snapshot.resources.length > 0) {
    throw new VisualExportError("visual-export-extension-resource-invalid", {
      reason: "snapshot-already-hydrated",
    });
  }
  const allowedExactKeys = new Set(identities.map(resourceIdentityKey));
  if (options.prepareResource !== undefined) {
    for (const identity of identities) {
      let state;
      try {
        state = options.resolveResource?.(identity);
      } catch {
        throw new VisualExportError(
          "visual-export-extension-resource-invalid",
          {
            reason: "resource-resolve-failed",
            resourceKey: resourceIdentityKey(identity),
          },
        );
      }
      if (state === undefined || state.status === "loading") {
        throw new VisualExportError(
          "visual-export-extension-resource-invalid",
          {
            reason: "resource-not-prepared",
            resourceKey: resourceIdentityKey(identity),
          },
        );
      }
    }
  }
  const candidates = new Map<string, CapturedResourceCandidate>();
  const extensions = snapshot.extensions.map((extension) => ({
    elementId: extension.elementId,
    descriptors: extension.descriptors.map((primitive) => {
      const identity =
        primitive.kind === "polygon"
          ? primitive.patternResource?.identity
          : primitive.kind === "marker"
            ? primitive.imageResource
            : primitive.kind === "text"
              ? primitive.fontResource
              : undefined;
      return identity !== undefined &&
        allowedExactKeys.has(resourceIdentityKey(identity))
        ? captureResourcePrimitive(
            primitive,
            { ...options, deferResourceCapture: false },
            candidates,
          )
        : primitive;
    }),
  }));
  const captured = finalizeCapturedResources(extensions, candidates);
  return deepFreeze({
    ...snapshot,
    extensions: captured.extensions,
    resources: captured.resources,
  });
}

function captureExtensions(
  state: Readonly<ProjectState>,
  options: VisualExportCaptureOptions,
) {
  const candidates = new Map<string, CapturedResourceCandidate>();
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
  const extensions = [...renderers.values()]
    .sort((left, right) => compareCodePoint(left.elementId, right.elementId))
    .map((renderer) => {
      const descriptors = (renderer.capture(state) ?? []).filter(
        (primitive) => state.layers.get(primitive.layerId)?.visible !== false,
      );
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
        descriptors: cloned.map((primitive) =>
          captureResourcePrimitive(primitive, options, candidates),
        ),
      };
    });
  return finalizeCapturedResources(extensions, candidates);
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
  const capturedExtensions = captureExtensions(state, options);
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
    extensions: capturedExtensions.extensions,
    resources: capturedExtensions.resources,
  });
}
