import type {
  EdgeLike,
  EdgeManagerContract,
  EdgeOverride,
  EdgeStyle,
} from "./types.js";

export class EdgeManagerError extends Error {
  constructor(
    readonly code: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(code);
    this.name = "EdgeManagerError";
  }
}

export class Edge implements EdgeLike {
  readonly instanceId: string;
  readonly edgeId: string;
  readonly adjacentCellIds: readonly string[];
  #persistence: "explicit-style" | "reference-only";
  #strokeColor: string;
  #strokeWidth: number;
  #strokeOpacity: number;
  #lineStyle: "solid" | "dashed";

  constructor(data: EdgeOverride) {
    if (
      data.adjacentCellIds.length < 1 ||
      data.adjacentCellIds.length > 2 ||
      new Set(data.adjacentCellIds).size !== data.adjacentCellIds.length
    ) {
      throw new EdgeManagerError("edge-adjacency-invalid", {
        edgeId: data.edgeId,
      });
    }
    this.instanceId = data.instanceId;
    this.edgeId = data.edgeId;
    this.adjacentCellIds = Object.freeze([...data.adjacentCellIds]);
    this.#persistence = data.persistence ?? "explicit-style";
    this.#strokeColor = data.strokeColor;
    this.#strokeWidth = data.strokeWidth;
    this.#strokeOpacity = data.strokeOpacity;
    this.#lineStyle = data.lineStyle;
  }

  get strokeColor(): string {
    return this.#strokeColor;
  }
  get strokeWidth(): number {
    return this.#strokeWidth;
  }
  get strokeOpacity(): number {
    return this.#strokeOpacity;
  }
  get lineStyle(): "solid" | "dashed" {
    return this.#lineStyle;
  }
  get persistence(): "explicit-style" | "reference-only" {
    return this.#persistence;
  }

  updateStyle(style: EdgeStyle): void {
    this.#strokeColor = style.strokeColor;
    this.#strokeWidth = style.strokeWidth;
    this.#strokeOpacity = style.strokeOpacity;
    this.#lineStyle = style.lineStyle;
  }

  setPersistence(persistence: "explicit-style" | "reference-only"): void {
    this.#persistence = persistence;
  }
}

/** Edge 的唯一运行时容器；同一规范 ID 始终复用同一 Edge 实例。 */
export class EdgeManager implements EdgeManagerContract {
  readonly #edgesById = new Map<string, Edge>();
  readonly #edgeIdsByInstanceId = new Map<string, string>();

  constructor(edges: Iterable<EdgeOverride> = []) {
    for (const edge of edges) {
      if (this.#edgesById.has(edge.edgeId))
        throw new EdgeManagerError("edge-duplicate", { edgeId: edge.edgeId });
      if (this.#edgeIdsByInstanceId.has(edge.instanceId))
        throw new EdgeManagerError("edge-instance-duplicate", {
          instanceId: edge.instanceId,
        });
      this.#edgesById.set(edge.edgeId, new Edge(edge));
      this.#edgeIdsByInstanceId.set(edge.instanceId, edge.edgeId);
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
  getByInstanceId(instanceId: string): Edge | undefined {
    const edgeId = this.#edgeIdsByInstanceId.get(instanceId);
    return edgeId === undefined ? undefined : this.#edgesById.get(edgeId);
  }
  values(): IterableIterator<Edge> {
    return this.#edgesById.values();
  }

  ensure(data: EdgeOverride): Edge {
    const existing = this.#edgesById.get(data.edgeId);
    if (existing !== undefined) {
      if (existing.adjacentCellIds.join("|") !== data.adjacentCellIds.join("|"))
        throw new EdgeManagerError("edge-adjacency-conflict", {
          edgeId: data.edgeId,
        });
      return existing;
    }
    const edge = new Edge(data);
    const duplicateEdgeId = this.#edgeIdsByInstanceId.get(edge.instanceId);
    if (duplicateEdgeId !== undefined && duplicateEdgeId !== edge.edgeId)
      throw new EdgeManagerError("edge-instance-duplicate", {
        instanceId: edge.instanceId,
      });
    this.#edgesById.set(edge.edgeId, edge);
    this.#edgeIdsByInstanceId.set(edge.instanceId, edge.edgeId);
    return edge;
  }

  replace(data: EdgeOverride): Edge {
    const existing = this.#edgesById.get(data.edgeId);
    if (existing === undefined)
      throw new EdgeManagerError("edge-not-found", { edgeId: data.edgeId });
    if (existing.adjacentCellIds.join("|") !== data.adjacentCellIds.join("|"))
      throw new EdgeManagerError("edge-adjacency-conflict", {
        edgeId: data.edgeId,
      });
    if (existing.instanceId === data.instanceId) {
      existing.updateStyle(data);
      existing.setPersistence(data.persistence ?? "explicit-style");
      return existing;
    }
    const duplicateEdgeId = this.#edgeIdsByInstanceId.get(data.instanceId);
    if (duplicateEdgeId !== undefined && duplicateEdgeId !== data.edgeId)
      throw new EdgeManagerError("edge-instance-duplicate", {
        instanceId: data.instanceId,
      });
    const edge = new Edge(data);
    this.#edgesById.set(edge.edgeId, edge);
    if (existing.instanceId !== edge.instanceId)
      this.#edgeIdsByInstanceId.delete(existing.instanceId);
    this.#edgeIdsByInstanceId.set(edge.instanceId, edge.edgeId);
    return edge;
  }

  updateStyle(edgeId: string, style: EdgeStyle): Edge {
    const edge = this.#edgesById.get(edgeId);
    if (edge === undefined)
      throw new EdgeManagerError("edge-not-found", { edgeId });
    edge.updateStyle(style);
    return edge;
  }

  setPersistence(
    edgeId: string,
    persistence: "explicit-style" | "reference-only",
  ): Edge {
    const edge = this.#edgesById.get(edgeId);
    if (edge === undefined)
      throw new EdgeManagerError("edge-not-found", { edgeId });
    edge.setPersistence(persistence);
    return edge;
  }

  delete(edgeId: string): boolean {
    const edge = this.#edgesById.get(edgeId);
    if (edge === undefined) return false;
    this.#edgesById.delete(edgeId);
    this.#edgeIdsByInstanceId.delete(edge.instanceId);
    return true;
  }
}
