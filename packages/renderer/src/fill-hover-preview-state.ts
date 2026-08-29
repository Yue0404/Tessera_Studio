import {
  cellId,
  type BackgroundTask,
  type CellCoordinate,
  type GridType,
} from "@tessera/core";

export type FillHoverPreviewStatus =
  "none" | "pending" | "valid" | "invalid" | "requires-confirmation";

export interface FillHoverPreviewSnapshot {
  readonly status: FillHoverPreviewStatus;
  /** 完整连续区域的格数，而非当前视口内绘制的格数。 */
  readonly count: number;
  /** 只保留当前视口内的结果，避免把百万格坐标长期留在渲染态。 */
  readonly visibleCellIds: ReadonlySet<string>;
}

const EMPTY_SNAPSHOT: FillHoverPreviewSnapshot = Object.freeze({
  status: "none",
  count: 0,
  visibleCellIds: new Set<string>(),
});

export interface FillHoverPreviewRequest {
  readonly task: BackgroundTask<readonly CellCoordinate[]>;
  readonly requiresConfirmation: boolean;
}

/**
 * 填充 hover 的异步世代门。任务结果只更新纯渲染快照，绝不接触工程状态。
 */
export class FillHoverPreviewState {
  #generation = 0;
  #task: BackgroundTask<readonly CellCoordinate[]> | null = null;
  #snapshot = EMPTY_SNAPSHOT;
  readonly #changed: () => void;

  constructor(changed: () => void = () => undefined) {
    this.#changed = changed;
  }

  get snapshot(): FillHoverPreviewSnapshot {
    return this.#snapshot;
  }

  begin(
    gridType: GridType,
    visibleCellIds: ReadonlySet<string>,
    request: FillHoverPreviewRequest,
  ): void {
    this.clear(false);
    const generation = this.#generation;
    this.#task = request.task;
    this.#snapshot = Object.freeze({
      status: "pending" as const,
      count: 0,
      visibleCellIds: new Set<string>(),
    });
    this.#changed();
    void request.task.result.then(
      (cells) => {
        if (generation !== this.#generation || this.#task !== request.task)
          return;
        const visible = new Set<string>();
        for (const coordinate of cells) {
          const id = cellId(gridType, coordinate.row, coordinate.column);
          if (visibleCellIds.has(id)) visible.add(id);
        }
        this.#task = null;
        this.#snapshot = Object.freeze({
          status: request.requiresConfirmation
            ? ("requires-confirmation" as const)
            : ("valid" as const),
          count: cells.length,
          visibleCellIds: visible,
        });
        this.#changed();
      },
      () => {
        if (generation !== this.#generation || this.#task !== request.task)
          return;
        this.#task = null;
        this.#snapshot = Object.freeze({
          status: "invalid" as const,
          count: 0,
          visibleCellIds: new Set<string>(),
        });
        this.#changed();
      },
    );
  }

  invalidate(): void {
    this.clear(false);
    this.#snapshot = Object.freeze({
      status: "invalid" as const,
      count: 0,
      visibleCellIds: new Set<string>(),
    });
    this.#changed();
  }

  clear(notify = true): void {
    this.#generation += 1;
    this.#task?.cancel();
    this.#task = null;
    const changed = this.#snapshot.status !== "none";
    this.#snapshot = EMPTY_SNAPSHOT;
    if (notify && changed) this.#changed();
  }
}
