import {
  canvasPrimitiveWorkUnits,
  drawVisualPrimitiveToCanvas,
  drawVisualTextToCanvasBatched,
  finishVisualExportCanvas,
  prepareVisualExportCanvas,
  type VisualExportCanvasResources,
  type VisualExportCanvasContext,
} from "./canvas-renderer.js";
import { VisualExportError, visualExportExecutionError } from "./error.js";
import { iterateVisualPrimitives } from "./scene.js";
import type {
  VisualExportPlan,
  VisualExportResourceSnapshot,
  VisualExportResult,
} from "./types.js";

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
  readonly resourceEnvironment?: VisualExportPngResourceEnvironment;
}

export interface VisualExportPngResourceEnvironment {
  decodeImage(
    resource: Extract<VisualExportResourceSnapshot, { kind: "image" }>,
  ): Promise<CanvasImageSource>;
  loadFont(
    resource: Extract<VisualExportResourceSnapshot, { kind: "font" }>,
    family: string,
  ): Promise<unknown>;
  releaseImage(handle: CanvasImageSource): void;
  releaseFont(handle: unknown): void;
}

interface LoadedPngResources {
  readonly canvas: VisualExportCanvasResources;
  release(): void;
}

function copiedBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function browserPngResourceEnvironment(): VisualExportPngResourceEnvironment {
  if (
    typeof document === "undefined" ||
    typeof createImageBitmap !== "function" ||
    typeof FontFace !== "function"
  ) {
    throw visualExportExecutionError(
      "visual-export-resource-capability-unavailable",
    );
  }
  return {
    decodeImage: (resource) =>
      createImageBitmap(
        new Blob([copiedBuffer(resource.bytes)], { type: resource.mimeType }),
      ),
    async loadFont(resource, family) {
      const face = await new FontFace(
        family,
        copiedBuffer(resource.bytes),
      ).load();
      document.fonts.add(face);
      return face;
    },
    releaseImage(handle) {
      if ("close" in handle && typeof handle.close === "function")
        handle.close();
    },
    releaseFont(handle) {
      if (handle instanceof FontFace) document.fonts.delete(handle);
    },
  };
}

async function loadPngResources(
  plan: VisualExportPlan,
  control: PngExecutionControl,
): Promise<LoadedPngResources> {
  if (plan.snapshot.resources.length === 0) {
    return {
      canvas: { images: new Map(), fonts: new Map() },
      release() {
        // 无资源句柄时保持统一的释放协议即可。
      },
    };
  }
  const environment =
    control.resourceEnvironment ?? browserPngResourceEnvironment();
  const images = new Map<
    string,
    Readonly<{ source: CanvasImageSource; width: number; height: number }>
  >();
  const fonts = new Map<string, string>();
  const imageHandles: CanvasImageSource[] = [];
  const fontHandles: unknown[] = [];
  const release = () => {
    for (const handle of imageHandles.splice(0))
      environment.releaseImage(handle);
    for (const handle of fontHandles.splice(0)) environment.releaseFont(handle);
  };
  try {
    for (const resource of plan.snapshot.resources) {
      throwIfCancelled(control);
      if (resource.kind === "image") {
        const handle = await environment.decodeImage(resource);
        imageHandles.push(handle);
        throwIfCancelled(control);
        images.set(resource.key, {
          source: handle,
          width: resource.width,
          height: resource.height,
        });
      } else {
        const family = `TesseraExport_${resource.key.replaceAll("-", "_")}`;
        const handle = await environment.loadFont(resource, family);
        fontHandles.push(handle);
        throwIfCancelled(control);
        fonts.set(resource.key, family);
      }
    }
  } catch (error) {
    release();
    if (error instanceof VisualExportError) throw error;
    throw visualExportExecutionError(
      "visual-export-resource-capability-unavailable",
    );
  }
  return { canvas: { images, fonts }, release };
}

function throwIfCancelled(control: PngExecutionControl): void {
  if (control.isCancelled()) {
    throw visualExportExecutionError("visual-export-cancelled");
  }
}

async function executeVisualExportPngLoaded(
  plan: VisualExportPlan,
  surface: VisualExportCanvasSurface,
  control: PngExecutionControl,
  resources: VisualExportCanvasResources,
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
          resources,
        );
      } else {
        drawVisualPrimitiveToCanvas(surface.context, primitive, resources);
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
  const resources = await loadPngResources(plan, control);
  try {
    return await executeVisualExportPngLoaded(
      plan,
      surface,
      control,
      resources.canvas,
    );
  } finally {
    resources.release();
  }
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
