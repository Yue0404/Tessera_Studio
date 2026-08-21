import type { EditorTool, MapPoint, ToolState } from "./types.js";

const DRAG_TOOLS: readonly EditorTool[] = ["pan", "brush", "edge"];

export class InvalidToolTransitionError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "InvalidToolTransitionError";
  }
}

/** 编辑工具的正式有限状态机；临时操作只通过显式提交进入领域模型。 */
export class ToolStateMachine {
  #state: ToolState = {
    tool: "select",
    phase: "ready",
    startPoint: null,
    previewPoint: null,
    startCellId: null,
  };

  get state(): Readonly<ToolState> {
    return this.#state;
  }

  selectTool(tool: EditorTool): void {
    this.cancel();
    this.#state = {
      tool,
      phase: tool === "connection" ? "choosing-start" : "ready",
      startPoint: null,
      previewPoint: null,
      startCellId: null,
    };
  }

  pointerDown(point: MapPoint, cellId: string | null): void {
    const { tool, phase } = this.#state;
    if (tool === "connection") {
      if (phase === "choosing-start" && cellId !== null) {
        this.#state = {
          ...this.#state,
          phase: "previewing-end",
          startPoint: point,
          previewPoint: point,
          startCellId: cellId,
        };
        return;
      }
      if (phase === "previewing-end" && cellId !== null) {
        if (cellId === this.#state.startCellId) {
          throw new InvalidToolTransitionError("connection-self-not-allowed");
        }
        this.#state = {
          ...this.#state,
          phase: "committing",
          previewPoint: point,
        };
        return;
      }
      throw new InvalidToolTransitionError("connection-pointer-down-invalid");
    }
    if (tool === "box-select") {
      this.#state = {
        ...this.#state,
        phase: "box-selecting",
        startPoint: point,
        previewPoint: point,
      };
      return;
    }
    if (DRAG_TOOLS.includes(tool)) {
      this.#state = {
        ...this.#state,
        phase: "dragging",
        startPoint: point,
        previewPoint: point,
      };
      return;
    }
    if (tool !== "select" && tool !== "marker") {
      throw new InvalidToolTransitionError("tool-pointer-down-invalid");
    }
  }

  pointerMove(point: MapPoint): void {
    if (
      this.#state.phase !== "dragging" &&
      this.#state.phase !== "box-selecting" &&
      this.#state.phase !== "previewing-end"
    ) {
      return;
    }
    this.#state = { ...this.#state, previewPoint: point };
  }

  pointerUp(point: MapPoint): void {
    if (
      this.#state.phase === "dragging" ||
      this.#state.phase === "box-selecting"
    ) {
      this.#state = {
        ...this.#state,
        phase: "ready",
        startPoint: null,
        previewPoint: point,
      };
    }
  }

  commitSucceeded(): void {
    if (
      this.#state.tool !== "connection" ||
      this.#state.phase !== "committing"
    ) {
      throw new InvalidToolTransitionError("connection-commit-success-invalid");
    }
    this.#state = {
      ...this.#state,
      phase: "choosing-start",
      startPoint: null,
      previewPoint: null,
      startCellId: null,
    };
  }

  commitFailed(): void {
    if (
      this.#state.tool !== "connection" ||
      this.#state.phase !== "committing"
    ) {
      throw new InvalidToolTransitionError("connection-commit-failure-invalid");
    }
    this.#state = { ...this.#state, phase: "previewing-end" };
  }

  cancel(): void {
    this.#state = {
      ...this.#state,
      phase: "idle",
      startPoint: null,
      previewPoint: null,
      startCellId: null,
    };
  }
}
