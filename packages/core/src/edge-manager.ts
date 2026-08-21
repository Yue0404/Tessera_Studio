import type { EdgeLike, EdgeManagerContract, EdgeOverride } from "./types.js";

export class Edge implements EdgeLike {
  readonly instanceId: string;
  readonly edgeId: string;
  readonly adjacentCellIds: readonly string[];
  #strokeColor: string;
  #strokeWidth: number;

  constructor(data: EdgeOverride) {
    if (
      data.adjacentCellIds.length < 1 ||
      data.adjacentCellIds.length > 2 ||
      new Set(data.adjacentCellIds).size !== data.adjacentCellIds.length
    ) {
      throw new Error(`Edge 邻接地格无效: ${data.edgeId}`);
    }
    this.instanceId = data.instanceId;
    this.edgeId = data.edgeId;
    this.adjacentCellIds = Object.freeze([...data.adjacentCellIds]);
    this.#strokeColor = data.strokeColor;
    this.#strokeWidth = data.strokeWidth;
  }

  get strokeColor(): string {
    return this.#strokeColor;
  }
  get strokeWidth(): number {
    return this.#strokeWidth;
  }

  updateStyle(strokeColor: string, strokeWidth: number): void {
    this.#strokeColor = strokeColor;
    this.#strokeWidth = strokeWidth;
  }
}

/** Edge 的唯一运行时容器；同一规范 ID 始终复用同一 Edge 实例。 */
export class EdgeManager implements EdgeManagerContract {
  readonly #edgesById = new Map<string, Edge>();

  constructor(edges: Iterable<EdgeOverride> = []) {
    for (const edge of edges) {
      if (this.#edgesById.has(edge.edgeId))
        throw new Error(`重复 Edge: ${edge.edgeId}`);
      this.#edgesById.set(edge.edgeId, new Edge(edge));
    }
  }

  get edgesById(): ReadonlyMap<string, Edge> {
    return this.#edgesById;
  }
  get size(): number {
    return this.#edgesById.size;
  }
  get(edgeId: string): Edge | undefined {
    return this.#edgesById.get(edgeId);
  }
  values(): IterableIterator<Edge> {
    return this.#edgesById.values();
  }

  ensure(data: EdgeOverride): Edge {
    const existing = this.#edgesById.get(data.edgeId);
    if (existing !== undefined) {
      if (existing.adjacentCellIds.join("|") !== data.adjacentCellIds.join("|"))
        throw new Error(`Edge 邻接关系冲突: ${data.edgeId}`);
      return existing;
    }
    const edge = new Edge(data);
    this.#edgesById.set(edge.edgeId, edge);
    return edge;
  }

  updateStyle(edgeId: string, strokeColor: string, strokeWidth: number): Edge {
    const edge = this.#edgesById.get(edgeId);
    if (edge === undefined) throw new Error(`Edge 不存在: ${edgeId}`);
    edge.updateStyle(strokeColor, strokeWidth);
    return edge;
  }

  delete(edgeId: string): boolean {
    return this.#edgesById.delete(edgeId);
  }
}
