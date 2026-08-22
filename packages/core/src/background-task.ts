export const DIRECT_OPERATION_LIMIT = 10_000;
export const BACKGROUND_OPERATION_LIMIT = 250_000;
export const MAX_OPERATION_LIMIT = 2_000_000;
export const MAX_HISTORY_DIFF_BYTES = 64 * 1024 * 1024;

export type BackgroundTaskErrorCode =
  | "batch-work-invalid"
  | "batch-confirmation-required"
  | "batch-work-too-large"
  | "batch-history-too-large"
  | "batch-state-changed"
  | "batch-task-cancelled"
  | "batch-task-failed";

export class BackgroundTaskError extends Error {
  constructor(
    readonly code: BackgroundTaskErrorCode,
    readonly details: Readonly<Record<string, number | string | boolean>>,
    readonly uiAction: "confirm" | "reduce-range" | "retry" | "dismiss",
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "BackgroundTaskError";
  }
}

export interface BatchOperationPlan {
  readonly mode: "direct" | "background";
  readonly itemCount: number;
  readonly estimatedHistoryBytes: number;
}

export interface BackgroundTaskProgress {
  readonly taskId: string;
  readonly completed: number;
  readonly total: number;
  readonly progress: number;
}

export interface BackgroundTask<T> {
  readonly taskId: string;
  subscribeProgress(
    listener: (progress: BackgroundTaskProgress) => void,
  ): () => void;
  cancel(): void;
  readonly result: Promise<T>;
}

export interface BackgroundTaskContext {
  readonly taskId: string;
  checkpoint(completed: number): Promise<void>;
  throwIfCancelled(): void;
}

export interface BackgroundTaskDependencies {
  readonly createTaskId?: () => string;
  readonly now?: () => number;
  readonly yieldToEventLoop?: () => Promise<void>;
}

export function planBatchOperation(input: {
  readonly itemCount: number;
  readonly estimatedHistoryBytes: number;
  readonly confirmed?: boolean;
}): BatchOperationPlan {
  const { itemCount, estimatedHistoryBytes } = input;
  if (
    !Number.isSafeInteger(itemCount) ||
    itemCount < 0 ||
    !Number.isSafeInteger(estimatedHistoryBytes) ||
    estimatedHistoryBytes < 0
  ) {
    throw new BackgroundTaskError(
      "batch-work-invalid",
      { itemCount, estimatedHistoryBytes },
      "reduce-range",
    );
  }
  if (itemCount > MAX_OPERATION_LIMIT) {
    throw new BackgroundTaskError(
      "batch-work-too-large",
      { itemCount, maximum: MAX_OPERATION_LIMIT },
      "reduce-range",
    );
  }
  if (estimatedHistoryBytes > MAX_HISTORY_DIFF_BYTES) {
    throw new BackgroundTaskError(
      "batch-history-too-large",
      { estimatedHistoryBytes, maximum: MAX_HISTORY_DIFF_BYTES },
      "reduce-range",
    );
  }
  if (itemCount > BACKGROUND_OPERATION_LIMIT && input.confirmed !== true) {
    throw new BackgroundTaskError(
      "batch-confirmation-required",
      { itemCount, threshold: BACKGROUND_OPERATION_LIMIT },
      "confirm",
    );
  }
  return Object.freeze({
    mode: itemCount <= DIRECT_OPERATION_LIMIT ? "direct" : "background",
    itemCount,
    estimatedHistoryBytes,
  });
}

/** 可注入时钟与 yield，便于稳定验证节流和取消边界。 */
export function startBackgroundTask<T>(
  plan: BatchOperationPlan,
  execute: (context: BackgroundTaskContext) => Promise<T> | T,
  dependencies: BackgroundTaskDependencies = {},
): BackgroundTask<T> {
  const taskId = dependencies.createTaskId?.() ?? crypto.randomUUID();
  const now =
    dependencies.now ??
    (() =>
      typeof performance === "undefined" ? Date.now() : performance.now());
  const yieldToEventLoop =
    dependencies.yieldToEventLoop ??
    (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  const listeners = new Set<(progress: BackgroundTaskProgress) => void>();
  const startedAt = now();
  let lastProgressAt = startedAt;
  let lastCompleted = 0;
  let cancelled = false;
  let settled = false;

  const cancelledError = () =>
    new BackgroundTaskError("batch-task-cancelled", { taskId }, "dismiss");
  const publish = (completed: number, force = false): void => {
    const current = now();
    const normalized = Math.max(
      lastCompleted,
      Math.min(plan.itemCount, Math.floor(completed)),
    );
    if (
      !force &&
      (current - startedAt < 100 || current - lastProgressAt < 80)
    ) {
      return;
    }
    lastCompleted = normalized;
    lastProgressAt = current;
    const progress =
      plan.itemCount === 0 ? 1 : Math.min(1, normalized / plan.itemCount);
    for (const listener of listeners) {
      listener({
        taskId,
        completed: normalized,
        total: plan.itemCount,
        progress,
      });
    }
  };
  const throwIfCancelled = (): void => {
    if (cancelled) throw cancelledError();
  };
  const context: BackgroundTaskContext = {
    taskId,
    throwIfCancelled,
    checkpoint: async (completed) => {
      throwIfCancelled();
      publish(completed);
      if (plan.mode === "background") {
        await yieldToEventLoop();
        throwIfCancelled();
        publish(completed);
      }
    },
  };

  const result = Promise.resolve()
    .then(() => {
      throwIfCancelled();
      return execute(context);
    })
    .then(
      (value) => {
        throwIfCancelled();
        settled = true;
        publish(plan.itemCount, true);
        return value;
      },
      (error: unknown) => {
        settled = true;
        if (error instanceof BackgroundTaskError) throw error;
        throw new BackgroundTaskError(
          "batch-task-failed",
          { taskId },
          "dismiss",
          { cause: error },
        );
      },
    );

  return {
    taskId,
    subscribeProgress(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    cancel() {
      if (!settled) cancelled = true;
    },
    result,
  };
}
