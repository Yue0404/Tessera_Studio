import {
  BackgroundTaskError,
  executeFillRegionWorkerPayload,
  serializeBackgroundTaskError,
  type FillRegionWorkerRequest,
  type FillRegionWorkerResponse,
} from "@tessera/core";

interface FillWorkerScope {
  onmessage:
    ((event: { readonly data: FillRegionWorkerRequest }) => void) | null;
  postMessage(message: FillRegionWorkerResponse): void;
}

const workerScope = self as unknown as FillWorkerScope;

workerScope.onmessage = ({ data }) => {
  if (data.type !== "start") return;
  const { taskId, payload } = data;
  void executeFillRegionWorkerPayload(payload, {
    isCancelled: () => false,
    checkpoint: (completed) => {
      workerScope.postMessage({ type: "progress", taskId, completed });
    },
  }).then(
    (cells) => {
      workerScope.postMessage({ type: "result", taskId, cells });
    },
    (error: unknown) => {
      const stable =
        error instanceof BackgroundTaskError
          ? error
          : new BackgroundTaskError(
              "batch-task-failed",
              { taskId, reason: "worker-execution" },
              "retry",
            );
      workerScope.postMessage({
        type: "error",
        taskId,
        error: serializeBackgroundTaskError(stable),
      });
    },
  );
};
