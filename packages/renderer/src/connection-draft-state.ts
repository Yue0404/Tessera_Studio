import type { ConnectionEndpoint } from "@tessera/core";
import type { EdgePlacementTarget } from "./tessera-renderer.js";

/** 只保存渲染器临时连线；无论领域提交返回 false 还是抛错都必须释放。 */
export class ConnectionDraftState {
  #start: ConnectionEndpoint | null = null;
  #edges: readonly EdgePlacementTarget[] = [];

  get hasStart(): boolean {
    return this.#start !== null;
  }

  get start(): ConnectionEndpoint | null {
    return this.#start === null ? null : structuredClone(this.#start);
  }

  begin(start: ConnectionEndpoint, edge: EdgePlacementTarget | null): void {
    this.#start = start;
    this.#edges = edge === null ? [] : [edge];
  }

  commit(
    end: ConnectionEndpoint,
    edge: EdgePlacementTarget | null,
    submit: (
      start: ConnectionEndpoint,
      end: ConnectionEndpoint,
      edges: readonly EdgePlacementTarget[],
    ) => boolean,
  ): boolean {
    const start = this.#start;
    if (start === null) return false;
    try {
      return submit(start, end, [
        ...this.#edges,
        ...(edge === null ? [] : [edge]),
      ]);
    } finally {
      this.reset();
    }
  }

  reset(): void {
    this.#start = null;
    this.#edges = [];
  }
}
