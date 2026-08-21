import { cellId, cellNeighbors } from "./geometry.js";
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
