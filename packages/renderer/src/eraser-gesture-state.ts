import type { EraserMode } from "./tessera-renderer.js";

/** 管理滑动橡皮的一次批次边界；单击模式不创建批次。 */
export class EraserGestureState {
  #active = false;

  get active(): boolean {
    return this.#active;
  }

  begin(mode: EraserMode, beginBatch: () => void): void {
    if (mode !== "drag" || this.#active) return;
    beginBatch();
    this.#active = true;
  }

  finish(commitBatch: () => void): void {
    if (!this.#active) return;
    this.#active = false;
    commitBatch();
  }

  cancel(cancelBatch: () => void): void {
    if (!this.#active) return;
    this.#active = false;
    cancelBatch();
  }
}
