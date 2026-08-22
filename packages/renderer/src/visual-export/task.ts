import {
  deserializeVisualExportError,
  VisualExportError,
  visualExportExecutionError,
} from "./error.js";
import {
  createMainThreadCanvasSurface,
  executeVisualExportPng,
  type VisualExportCanvasSurface,
} from "./png-executor.js";
import {
  executeVisualExportSvg,
  type SvgExecutionControl,
} from "./svg-executor.js";
import type {
  VisualExportSvgFragmentOptions,
  VisualExportSvgLimits,
} from "./svg.js";
import {
  PNG_MAX_PIXELS,
  PNG_MAX_SIDE,
  type VisualExportCanvasCapabilities,
  type VisualExportPlan,
  type VisualExportResult,
} from "./types.js";
import type {
  VisualExportWorkerRequest,
  VisualExportWorkerResponse,
} from "./worker-protocol.js";

export interface VisualExportProgress {
  readonly taskId: string;
  readonly progress: number;
}

export interface VisualExportTask {
  readonly taskId: string;
  subscribeProgress(
    listener: (event: VisualExportProgress) => void,
  ): () => void;
  cancel(): void;
  readonly result: Promise<VisualExportResult>;
}

export interface VisualExportWorkerLike {
  onmessage: ((event: MessageEvent<VisualExportWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: VisualExportWorkerRequest): void;
  terminate(): void;
}

export interface StartVisualExportOptions {
  readonly capabilities?: VisualExportCanvasCapabilities;
  readonly createWorker?: () => VisualExportWorkerLike;
  readonly createCanvasSurface?: (
    width: number,
    height: number,
  ) => VisualExportCanvasSurface;
  readonly createTaskId?: () => string;
  readonly now?: () => number;
  readonly yieldControl?: () => Promise<void>;
  readonly fallbackBatchSize?: number;
  readonly svgBatchNodes?: number;
  readonly svgLimits?: VisualExportSvgLimits;
  readonly svgFragmentOptions?: VisualExportSvgFragmentOptions;
  readonly createSvgBlob?: SvgExecutionControl["createBlob"];
}

class WorkerInfrastructureError extends Error {}

let fallbackTaskSequence = 0;

function defaultTaskId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  fallbackTaskSequence += 1;
  return `visual-export-${fallbackTaskSequence}`;
}

export function detectVisualExportCanvasCapabilities(): VisualExportCanvasCapabilities {
  const offscreen =
    typeof OffscreenCanvas !== "undefined" &&
    typeof OffscreenCanvas.prototype.getContext === "function";
  return {
    maxWidth: PNG_MAX_SIDE,
    maxHeight: PNG_MAX_SIDE,
    maxPixels: PNG_MAX_PIXELS,
    worker: typeof Worker !== "undefined",
    offscreenCanvas2d: offscreen,
    offscreenConvertToBlob:
      offscreen &&
      typeof OffscreenCanvas.prototype.convertToBlob === "function",
  };
}

function defaultWorkerFactory(): VisualExportWorkerLike {
  return new Worker(new URL("./png-worker.ts", import.meta.url), {
    type: "module",
  });
}

function defaultYieldControl(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

class ProgressPublisher {
  readonly #listeners = new Set<(event: VisualExportProgress) => void>();
  readonly #startedAt: number;
  readonly #taskId: string;
  readonly #now: () => number;
  #lastPublishedAt: number;
  #lastProgress = 0;

  constructor(taskId: string, now: () => number) {
    this.#taskId = taskId;
    this.#now = now;
    this.#startedAt = now();
    this.#lastPublishedAt = this.#startedAt;
  }

  subscribe(listener: (event: VisualExportProgress) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  publish(progress: number, complete = false): void {
    const normalized = Math.max(
      this.#lastProgress,
      Math.min(1, Math.max(0, progress)),
    );
    const now = this.#now();
    if (
      !complete &&
      (now - this.#startedAt < 100 || now - this.#lastPublishedAt < 100)
    ) {
      return;
    }
    this.#lastProgress = complete ? 1 : normalized;
    this.#lastPublishedAt = now;
    const event = { taskId: this.#taskId, progress: this.#lastProgress };
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch {
        // 单个 UI 监听器不得破坏导出任务。
      }
    }
  }
}

function runWorker(
  taskId: string,
  plan: VisualExportPlan,
  createWorker: () => VisualExportWorkerLike,
  onProgress: (progress: number) => void,
  setActiveCancel: (cancel: (() => void) | null) => void,
): Promise<VisualExportResult> {
  return new Promise((resolve, reject) => {
    let worker: VisualExportWorkerLike;
    try {
      worker = createWorker();
    } catch {
      reject(new WorkerInfrastructureError());
      return;
    }
    let settled = false;
    const finish = (action: () => void, terminate = true): void => {
      if (settled) return;
      settled = true;
      setActiveCancel(null);
      if (terminate) worker.terminate();
      action();
    };
    setActiveCancel(() =>
      finish(() =>
        reject(visualExportExecutionError("visual-export-cancelled")),
      ),
    );
    worker.onmessage = (event) => {
      const message = event.data;
      if (
        message === null ||
        typeof message !== "object" ||
        typeof message.taskId !== "string" ||
        !["progress", "result", "error"].includes(message.type)
      ) {
        finish(() => reject(new WorkerInfrastructureError()));
        return;
      }
      if (message.taskId !== taskId) return;
      if (message.type === "progress") {
        if (!Number.isFinite(message.progress)) {
          finish(() => reject(new WorkerInfrastructureError()));
          return;
        }
        onProgress(message.progress);
      } else if (message.type === "error") {
        finish(() => reject(deserializeVisualExportError(message.error)));
      } else if (
        message.result.format === "png" &&
        message.result.blob instanceof Blob &&
        message.result.blob.type === "image/png" &&
        message.result.blob.size > 0 &&
        message.result.mimeType === "image/png" &&
        message.result.width === plan.pixelWidth &&
        message.result.height === plan.pixelHeight
      ) {
        finish(() => resolve(message.result));
      } else {
        finish(() => reject(new WorkerInfrastructureError()));
      }
    };
    worker.onerror = () =>
      finish(() => reject(new WorkerInfrastructureError()));
    try {
      worker.postMessage({ type: "start", taskId, plan });
    } catch {
      finish(() => reject(new WorkerInfrastructureError()));
    }
  });
}

export function startVisualExport(
  plan: VisualExportPlan,
  options: StartVisualExportOptions = {},
): VisualExportTask {
  const taskId = (options.createTaskId ?? defaultTaskId)();
  const now = options.now ?? (() => performance.now());
  const publisher = new ProgressPublisher(taskId, now);
  let cancelled = false;
  let settled = false;
  let activeCancel: (() => void) | null = null;
  let resolveResult!: (result: VisualExportResult) => void;
  let rejectResult!: (error: unknown) => void;
  const result = new Promise<VisualExportResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const settleSuccess = (value: VisualExportResult): void => {
    if (settled || cancelled) return;
    settled = true;
    publisher.publish(1, true);
    resolveResult(value);
  };
  const settleFailure = (error: unknown): void => {
    if (settled) return;
    settled = true;
    rejectResult(
      error instanceof VisualExportError
        ? error
        : visualExportExecutionError("visual-export-execution-failed"),
    );
  };
  const setActiveCancel = (cancel: (() => void) | null): void => {
    activeCancel = cancel;
    if (cancelled) activeCancel?.();
  };

  const execute = async (): Promise<void> => {
    try {
      if (cancelled)
        throw visualExportExecutionError("visual-export-cancelled");
      if (plan.request.format === "svg") {
        const svgResult = await executeVisualExportSvg(plan, {
          isCancelled: () => cancelled,
          onProgress: (progress) => publisher.publish(progress),
          now,
          yieldControl: options.yieldControl ?? defaultYieldControl,
          batchNodes: options.svgBatchNodes ?? 128,
          ...(options.svgLimits === undefined
            ? {}
            : { limits: options.svgLimits }),
          ...(options.svgFragmentOptions === undefined
            ? {}
            : { fragmentOptions: options.svgFragmentOptions }),
          ...(options.createSvgBlob === undefined
            ? {}
            : { createBlob: options.createSvgBlob }),
        });
        settleSuccess(svgResult);
        return;
      }

      const capabilities =
        options.capabilities ?? detectVisualExportCanvasCapabilities();
      const canUseWorker =
        capabilities.worker &&
        capabilities.offscreenCanvas2d &&
        capabilities.offscreenConvertToBlob;
      if (canUseWorker) {
        try {
          const workerResult = await runWorker(
            taskId,
            plan,
            options.createWorker ?? defaultWorkerFactory,
            (progress) => publisher.publish(progress),
            setActiveCancel,
          );
          settleSuccess(workerResult);
          return;
        } catch (error) {
          if (!(error instanceof WorkerInfrastructureError)) throw error;
          if (cancelled)
            throw visualExportExecutionError("visual-export-cancelled");
        }
      }

      let surface: VisualExportCanvasSurface;
      try {
        surface = (
          options.createCanvasSurface ?? createMainThreadCanvasSurface
        )(plan.pixelWidth, plan.pixelHeight);
      } catch (error) {
        if (error instanceof VisualExportError) throw error;
        throw visualExportExecutionError(
          "visual-export-canvas-allocation-failed",
          "reduce-scale",
        );
      }
      const fallbackResult = await executeVisualExportPng(plan, surface, {
        isCancelled: () => cancelled,
        onProgress: (progress) => publisher.publish(progress),
        now,
        yieldControl: options.yieldControl ?? defaultYieldControl,
        batchSize: options.fallbackBatchSize ?? 128,
        executionMode: "fallback",
      });
      settleSuccess(fallbackResult);
    } catch (error) {
      settleFailure(error);
    }
  };
  queueMicrotask(() => void execute());

  return {
    taskId,
    subscribeProgress: (listener) => publisher.subscribe(listener),
    cancel: () => {
      if (settled || cancelled) return;
      cancelled = true;
      activeCancel?.();
      settleFailure(visualExportExecutionError("visual-export-cancelled"));
    },
    result,
  };
}
