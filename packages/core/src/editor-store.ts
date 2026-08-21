import { cellId } from "./geometry.js";
import { EdgeManager } from "./edge-manager.js";
import type {
  CellOverride,
  EdgeOverride,
  NewProjectInput,
  ProjectState,
} from "./types.js";

type Listener = () => void;

interface Change {
  apply(): void;
  revert(): void;
}

function newUuid(): string {
  return crypto.randomUUID();
}

export function createProject(input: NewProjectInput): ProjectState {
  const now = new Date().toISOString();
  return {
    projectId: newUuid(),
    name: input.name,
    createdAt: now,
    updatedAt: now,
    grid: { ...input.grid },
    style: { ...input.style },
    cells: new Map(),
    edges: new EdgeManager(),
    revision: 0,
  };
}

export class EditorStore {
  readonly #listeners = new Set<Listener>();
  readonly #undo: Change[] = [];
  readonly #redo: Change[] = [];
  #state: ProjectState;
  #version = 0;
  #batch: Change[] | undefined;

  constructor(state: ProjectState) {
    this.#state = state;
  }

  get state(): Readonly<ProjectState> {
    return this.#state;
  }

  get version(): number {
    return this.#version;
  }

  get canUndo(): boolean {
    return this.#undo.length > 0;
  }

  get canRedo(): boolean {
    return this.#redo.length > 0;
  }

  subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  replace(state: ProjectState): void {
    this.#state = state;
    this.#undo.length = 0;
    this.#redo.length = 0;
    this.#publish(false);
  }

  paintCell(row: number, column: number, fillColor: string): void {
    const id = cellId(this.#state.grid.type, row, column);
    const previous = this.#state.cells.get(id);
    if (previous?.fillColor === fillColor) return;
    const next: CellOverride = {
      instanceId: previous?.instanceId ?? newUuid(),
      cellId: id,
      row,
      column,
      fillColor,
    };
    this.#execute({
      apply: () => this.#state.cells.set(id, next),
      revert: () =>
        previous === undefined
          ? this.#state.cells.delete(id)
          : this.#state.cells.set(id, previous),
    });
  }

  paintEdge(
    edgeId: string,
    adjacentCellIds: readonly string[],
    strokeColor: string,
  ): void {
    const previous = this.#state.edges.get(edgeId);
    if (previous?.strokeColor === strokeColor) return;
    const next: EdgeOverride =
      previous === undefined
        ? {
            instanceId: newUuid(),
            edgeId,
            adjacentCellIds: [...adjacentCellIds],
            strokeColor,
            strokeWidth: Math.max(2, this.#state.style.gridWidth * 2),
          }
        : {
            instanceId: previous.instanceId,
            edgeId: previous.edgeId,
            adjacentCellIds: previous.adjacentCellIds,
            strokeColor: previous.strokeColor,
            strokeWidth: previous.strokeWidth,
          };
    const previousColor = previous?.strokeColor;
    const previousWidth = previous?.strokeWidth;
    this.#execute({
      apply: () => {
        const manager = this.#state.edges;
        manager.ensure(next);
        manager.updateStyle(
          edgeId,
          strokeColor,
          Math.max(2, this.#state.style.gridWidth * 2),
        );
      },
      revert: () => {
        if (previous === undefined) this.#state.edges.delete(edgeId);
        else
          this.#state.edges.updateStyle(
            edgeId,
            previousColor ?? previous.strokeColor,
            previousWidth ?? previous.strokeWidth,
          );
      },
    });
  }

  beginBatch(): void {
    if (this.#batch === undefined) this.#batch = [];
  }

  commitBatch(): void {
    const changes = this.#batch;
    this.#batch = undefined;
    if (changes === undefined || changes.length === 0) return;
    this.#undo.push({
      apply: () => {
        for (const change of changes) change.apply();
      },
      revert: () => {
        for (const change of [...changes].reverse()) change.revert();
      },
    });
    this.#redo.length = 0;
  }

  undo(): void {
    const change = this.#undo.pop();
    if (change === undefined) return;
    change.revert();
    this.#redo.push(change);
    this.#publish(true);
  }

  redo(): void {
    const change = this.#redo.pop();
    if (change === undefined) return;
    change.apply();
    this.#undo.push(change);
    this.#publish(true);
  }

  #execute(change: Change): void {
    change.apply();
    if (this.#batch !== undefined) this.#batch.push(change);
    else {
      this.#undo.push(change);
      this.#redo.length = 0;
    }
    this.#publish(true);
  }

  #publish(updateRevision: boolean): void {
    if (updateRevision) {
      this.#state.revision += 1;
      this.#state.updatedAt = new Date().toISOString();
    }
    this.#version += 1;
    for (const listener of this.#listeners) listener();
  }
}
