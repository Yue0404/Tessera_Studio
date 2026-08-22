export type RendererContextStatus = "available" | "lost";

export interface WebGlContextLifecycleCallbacks {
  readonly onLost: () => void;
  readonly onRestored: () => void;
}

/**
 * 将浏览器 WebGL 上下文事件收敛为可测试的两态生命周期。
 * Pixi 负责底层 GPU 系统恢复，本类负责 Tessera 的暂停和场景重建时机。
 */
export class WebGlContextLifecycle {
  readonly #target: EventTarget;
  readonly #callbacks: WebGlContextLifecycleCallbacks;
  #lost = false;
  #destroyed = false;

  constructor(target: EventTarget, callbacks: WebGlContextLifecycleCallbacks) {
    this.#target = target;
    this.#callbacks = callbacks;
    target.addEventListener("webglcontextlost", this.#onLost);
    target.addEventListener("webglcontextrestored", this.#onRestored);
  }

  get status(): RendererContextStatus {
    return this.#lost ? "lost" : "available";
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#target.removeEventListener("webglcontextlost", this.#onLost);
    this.#target.removeEventListener("webglcontextrestored", this.#onRestored);
  }

  readonly #onLost = (event: Event): void => {
    event.preventDefault();
    if (this.#destroyed || this.#lost) return;
    this.#lost = true;
    this.#callbacks.onLost();
  };

  readonly #onRestored = (): void => {
    if (this.#destroyed || !this.#lost) return;
    this.#lost = false;
    this.#callbacks.onRestored();
  };
}
