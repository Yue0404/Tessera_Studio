import type { ProjectState } from "@tessera/core";
import {
  captureVisualExportSnapshot,
  hydrateVisualExportSnapshotResources,
  detectVisualExportCanvasCapabilities,
  planVisualExport,
  resolveVisualExportBounds,
  startVisualExport,
  iterateVisualPrimitives,
  VisualExportError,
  type StartVisualExportOptions,
  type VisualExportCanvasCapabilities,
  type VisualExportCaptureOptions,
  type VisualExportPlan,
  type VisualExportRequest,
  type VisualExportResult,
  type VisualExportSnapshot,
  type VisualExportTask,
} from "@tessera/renderer/visual-export";
import {
  resolveVisualExportRangeFromSnapshot,
  type InteractionRangeSnapshot,
  type VisualExportRangeSource,
} from "./visual-export-range.js";

export interface VisualExportWorkflowRequest {
  readonly format: "png" | "svg";
  readonly range: VisualExportRangeSource;
  readonly interaction: InteractionRangeSnapshot;
  readonly background:
    | { readonly kind: "transparent" }
    | { readonly kind: "color"; readonly color: string };
  readonly showGrid: boolean;
  readonly scale: 1 | 2 | 4;
  readonly captureOptions?: VisualExportCaptureOptions;
  readonly signal?: AbortSignal;
}

export interface VisualExportWorkflowSession extends VisualExportTask {
  readonly plan: VisualExportPlan;
  readonly capabilities: VisualExportCanvasCapabilities;
}

export interface VisualExportWorkflowEngine {
  captureVisualExportSnapshot(
    state: Readonly<ProjectState>,
    options?: VisualExportCaptureOptions,
  ): VisualExportSnapshot;
  hydrateVisualExportSnapshotResources(
    snapshot: VisualExportSnapshot,
    options: VisualExportCaptureOptions,
    identities: readonly Parameters<
      NonNullable<VisualExportCaptureOptions["prepareResource"]>
    >[0][],
  ): VisualExportSnapshot;
  resolveVisualExportBounds: typeof resolveVisualExportBounds;
  detectVisualExportCanvasCapabilities(): VisualExportCanvasCapabilities;
  planVisualExport: typeof planVisualExport;
  startVisualExport(
    plan: VisualExportPlan,
    options?: StartVisualExportOptions,
  ): VisualExportTask;
}

const browserEngine: VisualExportWorkflowEngine = {
  captureVisualExportSnapshot,
  hydrateVisualExportSnapshotResources,
  resolveVisualExportBounds,
  detectVisualExportCanvasCapabilities,
  planVisualExport,
  startVisualExport,
};

/** 本函数同步捕获 snapshot；调用返回后编辑态变化不会进入本次产物。 */
export async function startVisualExportWorkflow(
  state: Readonly<ProjectState>,
  request: VisualExportWorkflowRequest,
  engine: VisualExportWorkflowEngine = browserEngine,
): Promise<VisualExportWorkflowSession> {
  const exportCancelled = () => request.signal?.aborted === true;
  if (exportCancelled()) {
    throw new VisualExportError("visual-export-cancelled");
  }
  const initialSnapshot = engine.captureVisualExportSnapshot(state, {
    ...request.captureOptions,
    deferResourceCapture: true,
  });
  const resolved = resolveVisualExportRangeFromSnapshot(
    initialSnapshot,
    request.range,
    request.interaction,
    engine,
  );
  const range: VisualExportRequest["range"] =
    resolved.kind === "viewport" ||
    resolved.kind === "selection" ||
    resolved.kind === "custom"
      ? { kind: resolved.kind, bounds: { ...resolved.bounds } }
      : { kind: resolved.kind };
  const visualRequest: VisualExportRequest =
    request.format === "png"
      ? {
          format: "png",
          range,
          background: request.background,
          showGrid: request.showGrid,
          scale: request.scale,
        }
      : {
          format: "svg",
          range,
          background: request.background,
          showGrid: request.showGrid,
        };
  const capabilities = engine.detectVisualExportCanvasCapabilities();
  const initialPlan = engine.planVisualExport(
    initialSnapshot,
    visualRequest,
    capabilities,
  );
  const pending = new Map<
    string,
    Parameters<NonNullable<VisualExportCaptureOptions["prepareResource"]>>[0]
  >();
  for (const primitive of iterateVisualPrimitives(initialPlan)) {
    const identity =
      primitive.kind === "polygon"
        ? primitive.patternResource?.identity
        : primitive.kind === "marker"
          ? primitive.imageResource
          : primitive.kind === "text"
            ? primitive.fontResource
            : undefined;
    if (identity !== undefined) {
      pending.set(
        `${identity.moduleId}@${identity.version}/${identity.resourceId}`,
        identity,
      );
    }
  }
  if (request.captureOptions?.prepareResource !== undefined) {
    const preparation = Promise.all(
      [...pending.values()].map((identity) =>
        request.captureOptions?.prepareResource?.(identity),
      ),
    );
    if (request.signal === undefined) {
      await preparation;
    } else {
      await new Promise<void>((resolve, reject) => {
        const abort = () =>
          reject(new VisualExportError("visual-export-cancelled"));
        request.signal?.addEventListener("abort", abort, { once: true });
        preparation.then(
          () => {
            request.signal?.removeEventListener("abort", abort);
            resolve();
          },
          (error: unknown) => {
            request.signal?.removeEventListener("abort", abort);
            reject(error);
          },
        );
      });
    }
  }
  if (exportCancelled()) {
    throw new VisualExportError("visual-export-cancelled");
  }
  const snapshot = engine.hydrateVisualExportSnapshotResources(
    initialPlan.snapshot,
    request.captureOptions ?? {},
    [...pending.values()],
  );
  const plan = engine.planVisualExport(snapshot, visualRequest, capabilities);
  const task = engine.startVisualExport(plan, { capabilities });
  return Object.freeze({ ...task, plan, capabilities });
}

export interface VisualExportDownloadDependencies {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  click(url: string, filename: string): void;
}

const browserDownload: VisualExportDownloadDependencies = {
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
  click: (url, filename) => {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
  },
};

function safeFilename(name: string): string {
  const safe = name.trim().replaceAll(/[\\/:*?"<>|]/g, "_");
  return safe.length === 0 ? "tessera-map" : safe;
}

export function downloadVisualExportResult(
  result: VisualExportResult,
  projectName: string,
  dependencies: VisualExportDownloadDependencies = browserDownload,
): void {
  let url: string;
  try {
    url = dependencies.createObjectURL(result.blob);
  } catch {
    throw new VisualExportError(
      "visual-export-download-failed",
      {},
      "reduce-range",
    );
  }
  try {
    dependencies.click(
      url,
      `${safeFilename(projectName)}.${result.format === "png" ? "png" : "svg"}`,
    );
  } catch {
    throw new VisualExportError(
      "visual-export-download-failed",
      {},
      "reduce-range",
    );
  } finally {
    dependencies.revokeObjectURL(url);
  }
}

export interface VisualExportErrorPresentation {
  readonly messageKey: string;
  readonly actionKey: string;
  readonly action:
    | "reduce-scale"
    | "reduce-range"
    | "tile-export"
    | "reset-background"
    | "switch-svg";
  readonly cancelled: boolean;
}

export function visualExportErrorPresentation(
  error: unknown,
): VisualExportErrorPresentation {
  const visualError =
    error instanceof VisualExportError
      ? error
      : new VisualExportError("visual-export-execution-failed");
  const cancelled = visualError.code === "visual-export-cancelled";
  if (visualError.code === "visual-export-background-color-invalid") {
    return {
      messageKey: "error.visualExportBackground",
      actionKey: "visualExport.action.resetBackground",
      action: "reset-background",
      cancelled: false,
    };
  }
  if (
    visualError.code === "visual-export-canvas-context-unavailable" ||
    visualError.code === "visual-export-png-encode-failed"
  ) {
    return {
      messageKey: "error.visualExportPngUnavailable",
      actionKey: "visualExport.action.switchSvg",
      action: "switch-svg",
      cancelled: false,
    };
  }
  return {
    messageKey: cancelled
      ? "visualExport.cancelled"
      : visualError.code.includes("range") ||
          visualError.code.includes("content-empty")
        ? "error.visualExportRange"
        : visualError.code.includes("scale") ||
            visualError.code.includes("pixel") ||
            visualError.code.includes("side") ||
            visualError.code.includes("canvas") ||
            visualError.code.includes("png")
          ? "error.visualExportCapacity"
          : "error.visualExportFailed",
    actionKey:
      visualError.uiAction === "reduce-scale"
        ? "visualExport.action.reduceScale"
        : visualError.uiAction === "tile-export"
          ? "visualExport.action.tileExport"
          : "visualExport.action.reduceRange",
    action: visualError.uiAction,
    cancelled,
  };
}
