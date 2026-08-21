import type { ProjectState } from "@tessera/core";
import {
  captureVisualExportSnapshot,
  detectVisualExportCanvasCapabilities,
  planVisualExport,
  resolveVisualExportBounds,
  startVisualExport,
  VisualExportError,
  type StartVisualExportOptions,
  type VisualExportCanvasCapabilities,
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
}

export interface VisualExportWorkflowSession extends VisualExportTask {
  readonly plan: VisualExportPlan;
  readonly capabilities: VisualExportCanvasCapabilities;
}

export interface VisualExportWorkflowEngine {
  captureVisualExportSnapshot(
    state: Readonly<ProjectState>,
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
  resolveVisualExportBounds,
  detectVisualExportCanvasCapabilities,
  planVisualExport,
  startVisualExport,
};

/** 本函数同步捕获 snapshot；调用返回后编辑态变化不会进入本次产物。 */
export function startVisualExportWorkflow(
  state: Readonly<ProjectState>,
  request: VisualExportWorkflowRequest,
  engine: VisualExportWorkflowEngine = browserEngine,
): VisualExportWorkflowSession {
  const snapshot = engine.captureVisualExportSnapshot(state);
  const resolved = resolveVisualExportRangeFromSnapshot(
    snapshot,
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
