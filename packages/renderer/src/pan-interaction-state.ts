import type { EditorTool, MapPoint } from "@tessera/core";

interface ActivePan {
  readonly pointerId: number;
  readonly buttonsMask: number;
  readonly temporary: boolean;
  lastScreenPoint: MapPoint;
}

/** 平移手势状态与领域工具状态分离，临时空格和中键不会切换当前工具。 */
export class PanInteractionState {
  #active: ActivePan | null = null;

  begin(options: {
    readonly pointerId: number;
    readonly button: number;
    readonly screenPoint: MapPoint;
    readonly tool: EditorTool;
    readonly spacePressed: boolean;
  }): boolean {
    const middle = options.button === 1;
    const left = options.button === 0;
    if (
      !middle &&
      !(left && (options.tool === "pan" || options.spacePressed))
    ) {
      return false;
    }
    this.#active = {
      pointerId: options.pointerId,
      buttonsMask: middle ? 4 : 1,
      temporary: left && options.spacePressed && options.tool !== "pan",
      lastScreenPoint: { ...options.screenPoint },
    };
    return true;
  }

  move(
    pointerId: number,
    buttons: number,
    screenPoint: MapPoint,
  ): MapPoint | null {
    const active = this.#active;
    if (
      active === null ||
      active.pointerId !== pointerId ||
      (buttons & active.buttonsMask) === 0
    ) {
      return null;
    }
    const delta = {
      x: screenPoint.x - active.lastScreenPoint.x,
      y: screenPoint.y - active.lastScreenPoint.y,
    };
    active.lastScreenPoint = { ...screenPoint };
    return delta;
  }

  end(pointerId: number): boolean {
    if (this.#active?.pointerId !== pointerId) return false;
    this.#active = null;
    return true;
  }

  releaseSpace(): boolean {
    if (this.#active?.temporary !== true) return false;
    this.#active = null;
    return true;
  }

  cancel(): boolean {
    const active = this.#active !== null;
    this.#active = null;
    return active;
  }
}

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable) ||
    target.closest('[contenteditable="true"]') !== null ||
    target.closest('[role="dialog"]') !== null
  );
}
