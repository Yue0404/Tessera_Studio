import { cellId, cellNeighbors } from "./geometry.js";
import { assertGridCoordinate } from "./coordinates.js";
import {
  planBatchOperation,
  startBackgroundTask,
  type BackgroundTask,
  type BackgroundTaskDependencies,
} from "./background-task.js";
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
  const colors = new Map<string, string>();
  for (const cell of state.cells.values())
    colors.set(cell.cellId, cell.fillColor);
  return startBackgroundTask(
    plan,
    async (context) => {
      if (targetColor === fillColor) return [];
      const queue = [{ row, column }];
      const visited = new Set<string>();
      const matched: { row: number; column: number }[] = [];
      for (const current of queue) {
        const id = cellId(grid.type, current.row, current.column);
        if (visited.has(id)) continue;
        visited.add(id);
        const currentColor = colors.get(id) ?? defaultCellColor;
        if (currentColor === targetColor) {
          matched.push(current);
          queue.push(...cellNeighbors(grid, current));
        }
        if ((visited.size & 2047) === 0) {
          await context.checkpoint(Math.min(visited.size, estimatedCount));
        }
      }
      context.throwIfCancelled();
      return matched;
    },
    options.dependencies,
  );
}
