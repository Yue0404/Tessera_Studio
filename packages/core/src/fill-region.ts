import { cellId, cellNeighbors } from "./geometry.js";
import { assertGridCoordinate } from "./coordinates.js";
import {
  BackgroundTaskError,
  MAX_OPERATION_LIMIT,
  deserializeBackgroundTaskError,
  planBatchOperation,
  startBackgroundTask,
  type BackgroundTask,
  type BackgroundTaskDependencies,
  type BatchOperationPlan,
} from "./background-task.js";
import {
  type FillRegionWorkerFactory,
  type FillRegionWorkerLike,
  type FillRegionWorkerPayload,
  type FillRegionWorkerResponse,
} from "./fill-region-worker-protocol.js";
import type { ProjectState } from "./types.js";

export class FillThresholdError extends Error {
  constructor(readonly estimatedCount: number) {
    super("fill-threshold-exceeded");
    this.name = "FillThresholdError";
  }
}

/** M1 临时安全门；M4 由 PERF-007 的四档确认策略替换。 */
export function planFillRegion(
  state: Readonly<ProjectState>,
  row: number,
  column: number,
  fillColor: string,
  limit: number,
): readonly { row: number; column: number }[] {
  const startId = cellId(state.grid.type, row, column);
  const targetColor =
    state.cells.get(startId)?.fillColor ?? state.style.defaultCellColor;
  if (targetColor === fillColor) return [];
  const mapArea = state.grid.width * state.grid.height;
  if (state.cells.get(startId) === undefined && mapArea > limit) {
    throw new FillThresholdError(mapArea);
  }
  const queue = [{ row, column }];
  const visited = new Set<string>();
  const matched: { row: number; column: number }[] = [];
  for (const current of queue) {
    const id = cellId(state.grid.type, current.row, current.column);
    if (visited.has(id)) continue;
    visited.add(id);
    const currentColor =
      state.cells.get(id)?.fillColor ?? state.style.defaultCellColor;
    if (currentColor !== targetColor) continue;
    matched.push(current);
    if (matched.length > limit) throw new FillThresholdError(matched.length);
    queue.push(...cellNeighbors(state.grid, current));
  }
  return matched;
}

export interface FillRegionTaskOptions {
  readonly confirmed?: boolean;
  readonly dependencies?: BackgroundTaskDependencies;
  readonly workerFactory?: FillRegionWorkerFactory;
}

/** 含前后 CellOverride、Map/数组引用及事务元数据的保守前置估算。 */
const CELL_FILL_HISTORY_DIFF_BYTES = 256;

function fillWorkEstimate(
  state: Readonly<ProjectState>,
  row: number,
  column: number,
): number {
  const start = state.cells.get(cellId(state.grid.type, row, column));
  return start === undefined || start.fillColor === state.style.defaultCellColor
    ? state.grid.width * state.grid.height
    : Math.max(1, state.cells.size);
}

export interface FillRegionExecutionControl {
  readonly checkpoint: (completed: number) => void | Promise<void>;
  readonly isCancelled: () => boolean;
}

function cancelledError(taskId = "fill-worker"): BackgroundTaskError {
  return new BackgroundTaskError("batch-task-cancelled", { taskId }, "dismiss");
}

/** Worker 与主线程 fallback 共用的纯区域规划器。 */
export async function executeFillRegionWorkerPayload(
  payload: FillRegionWorkerPayload,
  control: FillRegionExecutionControl,
): Promise<readonly { row: number; column: number }[]> {
  assertGridCoordinate(payload.grid, payload.start);
  if (
    !Number.isSafeInteger(payload.estimatedCount) ||
    payload.estimatedCount < 0 ||
    payload.estimatedCount > MAX_OPERATION_LIMIT
  ) {
    throw new BackgroundTaskError(
      "batch-work-invalid",
      { itemCount: payload.estimatedCount },
      "reduce-range",
    );
  }
  const colors = new Map<string, string>(payload.sparseColors);
  const queue = [{ ...payload.start }];
  const visited = new Set<string>();
  const matched: { row: number; column: number }[] = [];
  const visitedLimit = Math.min(
    MAX_OPERATION_LIMIT,
    Math.max(payload.estimatedCount * 8, 10_000),
  );
  for (const current of queue) {
    if (control.isCancelled()) throw cancelledError();
    const id = cellId(payload.grid.type, current.row, current.column);
    if (visited.has(id)) continue;
    visited.add(id);
    if (visited.size > visitedLimit) {
      throw new BackgroundTaskError(
        "batch-work-too-large",
        { itemCount: visited.size, maximum: visitedLimit },
        "reduce-range",
      );
    }
    const currentColor = colors.get(id) ?? payload.defaultCellColor;
    if (currentColor === payload.targetColor) {
      matched.push(current);
      if (matched.length > payload.estimatedCount) {
        throw new BackgroundTaskError(
          "batch-work-too-large",
          { itemCount: matched.length, maximum: payload.estimatedCount },
          "reduce-range",
        );
      }
      queue.push(...cellNeighbors(payload.grid, current));
    }
    if ((visited.size & 2047) === 0) {
      await control.checkpoint(Math.min(visited.size, payload.estimatedCount));
    }
  }
  if (control.isCancelled()) throw cancelledError();
  return matched;
}

function workerResultValid(
  cells: readonly { readonly row: number; readonly column: number }[],
  payload: FillRegionWorkerPayload,
): boolean {
  if (!Array.isArray(cells) || cells.length > payload.estimatedCount) {
    return false;
  }
  const seen = new Set<string>();
  const colors = new Map<string, string>(payload.sparseColors);
  for (const cell of cells) {
    if (
      !Number.isInteger(cell.row) ||
      !Number.isInteger(cell.column) ||
      cell.row < 0 ||
      cell.column < 0 ||
      cell.row >= payload.grid.height ||
      cell.column >= payload.grid.width
    ) {
      return false;
    }
    const id = cellId(payload.grid.type, cell.row, cell.column);
    if (seen.has(id)) return false;
    seen.add(id);
    if ((colors.get(id) ?? payload.defaultCellColor) !== payload.targetColor) {
      return false;
    }
  }
  return true;
}

function startFillRegionWorkerTask(
  plan: BatchOperationPlan,
  payload: FillRegionWorkerPayload,
  workerFactory: FillRegionWorkerFactory,
  dependencies: BackgroundTaskDependencies = {},
): BackgroundTask<readonly { row: number; column: number }[]> {
  const taskId = dependencies.createTaskId?.() ?? crypto.randomUUID();
  const now =
    dependencies.now ??
    (() =>
      typeof performance === "undefined" ? Date.now() : performance.now());
  const worker: FillRegionWorkerLike = workerFactory();
  const listeners = new Set<
    Parameters<BackgroundTask<unknown>["subscribeProgress"]>[0]
  >();
  const startedAt = now();
  let lastPublishedAt = startedAt;
  let lastCompleted = 0;
  let settled = false;
  let cancelled = false;
  let resolveResult!: (
    cells: readonly { row: number; column: number }[],
  ) => void;
  let rejectResult!: (error: unknown) => void;
  const result = new Promise<readonly { row: number; column: number }[]>(
    (resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    },
  );
  const publish = (completed: number, force = false): void => {
    const current = now();
    const normalized = Math.max(
      lastCompleted,
      Math.min(plan.itemCount, Math.floor(completed)),
    );
    if (
      !force &&
      (current - startedAt < 100 || current - lastPublishedAt < 80)
    ) {
      return;
    }
    lastCompleted = normalized;
    lastPublishedAt = current;
    const progress =
      plan.itemCount === 0 ? 1 : Math.min(1, normalized / plan.itemCount);
    for (const listener of listeners) {
      try {
        listener({
          taskId,
          completed: normalized,
          total: plan.itemCount,
          progress,
        });
      } catch {
        // 单个 UI 监听器不得破坏 Worker 任务。
      }
    }
  };
  const finish = (action: () => void): void => {
    if (settled) return;
    settled = true;
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
    action();
  };
  const failInfrastructure = (): void =>
    finish(() =>
      rejectResult(
        new BackgroundTaskError(
          "batch-task-failed",
          { taskId, reason: "worker-infrastructure" },
          "retry",
        ),
      ),
    );
  worker.onmessage = ({
    data,
  }: {
    readonly data: FillRegionWorkerResponse;
  }) => {
    if (
      data === null ||
      typeof data !== "object" ||
      typeof data.taskId !== "string" ||
      !["progress", "result", "error"].includes(data.type)
    ) {
      failInfrastructure();
      return;
    }
    if (data.taskId !== taskId) return;
    if (data.type === "progress") {
      if (!Number.isSafeInteger(data.completed) || data.completed < 0) {
        failInfrastructure();
        return;
      }
      publish(data.completed);
      return;
    }
    if (data.type === "error") {
      let error: BackgroundTaskError;
      try {
        error = deserializeBackgroundTaskError(data.error);
      } catch {
        failInfrastructure();
        return;
      }
      finish(() => rejectResult(error));
      return;
    }
    if (!workerResultValid(data.cells, payload)) {
      failInfrastructure();
      return;
    }
    finish(() => {
      publish(plan.itemCount, true);
      resolveResult(data.cells.map((cell) => ({ ...cell })));
    });
  };
  worker.onerror = () => failInfrastructure();
  queueMicrotask(() => {
    if (cancelled || settled) return;
    try {
      worker.postMessage({ type: "start", taskId, payload });
    } catch {
      failInfrastructure();
    }
  });

  return {
    taskId,
    subscribeProgress(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    cancel() {
      if (settled || cancelled) return;
      cancelled = true;
      finish(() => rejectResult(cancelledError(taskId)));
    },
    result,
  };
}

/**
 * 后台填充只构建不可变坐标计划；调用方在任务成功后一次提交，
 * 因此取消或失败不会把半成品写进工程。
 */
export function startFillRegionTask(
  state: Readonly<ProjectState>,
  row: number,
  column: number,
  fillColor: string,
  options: FillRegionTaskOptions = {},
): BackgroundTask<readonly { row: number; column: number }[]> {
  assertGridCoordinate(state.grid, { row, column });
  const grid = { ...state.grid };
  const defaultCellColor = state.style.defaultCellColor;
  const startId = cellId(grid.type, row, column);
  const targetColor = state.cells.get(startId)?.fillColor ?? defaultCellColor;
  const estimatedCount =
    targetColor === fillColor ? 0 : fillWorkEstimate(state, row, column);
  const plan = planBatchOperation({
    itemCount: estimatedCount,
    estimatedHistoryBytes: estimatedCount * CELL_FILL_HISTORY_DIFF_BYTES,
    ...(options.confirmed === undefined
      ? {}
      : { confirmed: options.confirmed }),
  });
  const sparseColors = [...state.cells.values()]
    .map((cell) => [cell.cellId, cell.fillColor] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  const payload: FillRegionWorkerPayload = {
    grid,
    start: { row, column },
    targetColor,
    fillColor,
    defaultCellColor,
    estimatedCount,
    sparseColors,
  };
  if (plan.mode === "background" && options.workerFactory !== undefined) {
    try {
      return startFillRegionWorkerTask(
        plan,
        payload,
        options.workerFactory,
        options.dependencies,
      );
    } catch {
      // Worker 创建失败时从头进入 fallback，此时尚未产生任何规划结果。
    }
  }
  return startBackgroundTask(
    plan,
    async (context) => {
      if (targetColor === fillColor) return [];
      return executeFillRegionWorkerPayload(payload, {
        checkpoint: (completed) => context.checkpoint(completed),
        isCancelled: () => {
          context.throwIfCancelled();
          return false;
        },
      });
    },
    options.dependencies,
  );
}
