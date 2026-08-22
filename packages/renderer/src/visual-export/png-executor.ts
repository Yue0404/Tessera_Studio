import {
  canvasPrimitiveWorkUnits,
  drawVisualPrimitiveToCanvas,
  drawVisualTextToCanvasBatched,
  finishVisualExportCanvas,
  prepareVisualExportCanvas,
  type VisualExportCanvasContext,
} from "./canvas-renderer.js";
import { VisualExportError, visualExportExecutionError } from "./error.js";
import { iterateVisualPrimitives } from "./scene.js";
import type { VisualExportPlan, VisualExportResult } from "./types.js";

export interface VisualExportCanvasSurface {
  readonly context: VisualExportCanvasContext;
  encodePng(): Promise<Blob>;
}

export interface PngExecutionControl {
  readonly isCancelled: () => boolean;
  readonly onProgress: (progress: number) => void;
  readonly now: () => number;
  readonly yieldControl: () => Promise<void>;
  readonly batchSize: number;
  readonly executionMode: "worker" | "fallback";
}

function throwIfCancelled(control: PngExecutionControl): void {
  if (control.isCancelled()) {
    throw visualExportExecutionError("visual-export-cancelled");
  }
}

export async function executeVisualExportPng(
  plan: VisualExportPlan,
  surface: VisualExportCanvasSurface,
  control: PngExecutionControl,
): Promise<VisualExportResult> {
  if (plan.request.format !== "png") {
    throw new VisualExportError("visual-export-format-mismatch", {
      expected: "png",
      actual: plan.request.format,
    });
  }
  throwIfCancelled(control);
  let prepared = false;
  let processed = 0;
  let batchStarted = control.now();
  try {
    prepareVisualExportCanvas(surface.context, plan);
    prepared = true;
    for (const primitive of iterateVisualPrimitives(plan)) {
      throwIfCancelled(control);
      const workUnits = canvasPrimitiveWorkUnits(primitive);
      if (primitive.kind === "text" && workUnits > control.batchSize) {
        const backgroundUnits = primitive.backgroundColor === null ? 0 : 1;
        await drawVisualTextToCanvasBatched(
          surface.context,
          primitive,
          control.batchSize,
          async (completedLines) => {
            control.onProgress(
              Math.min(
                0.95,
                (processed + backgroundUnits + completedLines) /
                  Math.max(1, plan.estimatedPrimitiveCount),
              ),
            );
            await control.yieldControl();
            throwIfCancelled(control);
            batchStarted = control.now();
          },
        );
      } else {
        drawVisualPrimitiveToCanvas(surface.context, primitive);
      }
      processed += workUnits;
      const now = control.now();
      if (
        processed % Math.max(1, control.batchSize) === 0 ||
        now - batchStarted >= 12
      ) {
        control.onProgress(
          Math.min(0.95, processed / Math.max(1, plan.estimatedPrimitiveCount)),
        );
        await control.yieldControl();
        throwIfCancelled(control);
        batchStarted = control.now();
      }
    }
    finishVisualExportCanvas(surface.context);
    prepared = false;
  } catch (error) {
    if (prepared) {
      try {
        finishVisualExportCanvas(surface.context);
      } catch {
        // 保留原始稳定错误，不泄露 Canvas 原生异常。
      }
    }
    if (error instanceof VisualExportError) throw error;
    throw visualExportExecutionError("visual-export-canvas-draw-failed");
  }
  throwIfCancelled(control);
  let blob: Blob;
  try {
    blob = await surface.encodePng();
  } catch (error) {
    if (error instanceof VisualExportError) throw error;
    throw visualExportExecutionError(
      "visual-export-png-encode-failed",
      "reduce-scale",
    );
  }
  throwIfCancelled(control);
  if (!(blob instanceof Blob) || blob.type !== "image/png" || blob.size === 0) {
    throw visualExportExecutionError(
      "visual-export-png-encode-failed",
      "reduce-scale",
    );
  }
  return {
    format: "png",
    mimeType: "image/png",
    blob,
    width: plan.pixelWidth,
    height: plan.pixelHeight,
    executionMode: control.executionMode,
  };
}

export function createMainThreadCanvasSurface(
  width: number,
  height: number,
): VisualExportCanvasSurface {
  let canvas: HTMLCanvasElement;
  try {
    canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
  } catch {
    throw visualExportExecutionError(
      "visual-export-canvas-allocation-failed",
      "reduce-scale",
    );
  }
  const context = canvas.getContext("2d");
  if (context === null) {
    throw visualExportExecutionError(
      "visual-export-canvas-context-unavailable",
      "reduce-scale",
    );
  }
  return {
    context,
    encodePng: () =>
      new Promise<Blob>((resolve, reject) => {
        try {
          canvas.toBlob((blob) => {
            if (blob === null) {
              reject(
                visualExportExecutionError(
                  "visual-export-png-encode-failed",
                  "reduce-scale",
                ),
              );
            } else {
              resolve(blob);
            }
          }, "image/png");
        } catch {
          reject(
            visualExportExecutionError(
              "visual-export-png-encode-failed",
              "reduce-scale",
            ),
          );
        }
      }),
  };
}

export function createOffscreenCanvasSurface(
  width: number,
  height: number,
): VisualExportCanvasSurface {
  let canvas: OffscreenCanvas;
  try {
    canvas = new OffscreenCanvas(width, height);
  } catch {
    throw visualExportExecutionError(
      "visual-export-canvas-allocation-failed",
      "reduce-scale",
    );
  }
  const context = canvas.getContext("2d");
  if (context === null) {
    throw visualExportExecutionError(
      "visual-export-canvas-context-unavailable",
      "reduce-scale",
    );
  }
  return {
    context,
    encodePng: async () => {
      try {
        return await canvas.convertToBlob({ type: "image/png" });
      } catch {
        throw visualExportExecutionError(
          "visual-export-png-encode-failed",
          "reduce-scale",
        );
      }
    },
  };
}
