import {
  serializeVisualExportError,
  VisualExportError,
  visualExportExecutionError,
} from "./error.js";
import {
  createOffscreenCanvasSurface,
  executeVisualExportPng,
} from "./png-executor.js";
import type {
  VisualExportWorkerRequest,
  VisualExportWorkerResponse,
} from "./worker-protocol.js";

interface WorkerScope {
  onmessage: ((event: MessageEvent<VisualExportWorkerRequest>) => void) | null;
  postMessage(message: VisualExportWorkerResponse): void;
}

const workerScope = self as unknown as WorkerScope;

workerScope.onmessage = (event) => {
  if (event.data.type !== "start") return;
  const { taskId, plan } = event.data;
  void (async () => {
    try {
      const surface = createOffscreenCanvasSurface(
        plan.pixelWidth,
        plan.pixelHeight,
      );
      let lastProgressAt = performance.now();
      const result = await executeVisualExportPng(plan, surface, {
        isCancelled: () => false,
        onProgress: (progress) => {
          const now = performance.now();
          if (now - lastProgressAt < 50) return;
          lastProgressAt = now;
          workerScope.postMessage({ type: "progress", taskId, progress });
        },
        now: () => performance.now(),
        yieldControl: () => Promise.resolve(),
        batchSize: 256,
        executionMode: "worker",
      });
      workerScope.postMessage({ type: "result", taskId, result });
    } catch (error) {
      const stable =
        error instanceof VisualExportError
          ? error
          : visualExportExecutionError("visual-export-worker-execution-failed");
      workerScope.postMessage({
        type: "error",
        taskId,
        error: serializeVisualExportError(stable),
      });
    }
  })();
};
