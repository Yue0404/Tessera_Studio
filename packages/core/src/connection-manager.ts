import { assertFiniteMapPoint } from "./coordinates.js";
import {
  SparseSpatialIndex,
  type SpatialBoundsResolver,
  type SpatialIndexStats,
} from "./sparse-spatial-index.js";
import type {
  ConnectionData,
  ConnectionEndpoint,
  ConnectionManagerContract,
} from "./types.js";
import type { MapRect } from "./viewport-clipping.js";

function validateEndpoint(endpoint: ConnectionEndpoint): void {
  if (endpoint.kind === "map-point") assertFiniteMapPoint(endpoint.point);
}

function validateConnection(connection: ConnectionData): void {
  validateEndpoint(connection.start);
  validateEndpoint(connection.end);
  if (connection.label !== null && connection.label.length > 2048) {
    throw new RangeError("connection-label-too-long");
  }
}

/** 连线对象的唯一所有者，不把对象复制到端点分块。 */
export class ConnectionManager implements ConnectionManagerContract {
  readonly #connectionsById = new Map<string, ConnectionData>();
  #spatialIndex: SparseSpatialIndex | undefined;
  #resolveBounds: SpatialBoundsResolver<ConnectionData> | undefined;

  constructor(connections: Iterable<ConnectionData> = []) {
    for (const connection of connections) this.add(connection);
  }

  get connectionsById(): ReadonlyMap<string, ConnectionData> {
    return this.#connectionsById;
  }

  get size(): number {
    return this.#connectionsById.size;
  }

  get(connectionId: string): ConnectionData | undefined {
    return this.#connectionsById.get(connectionId);
  }

  values(): IterableIterator<ConnectionData> {
    return this.#connectionsById.values();
  }

  add(connection: ConnectionData): ConnectionData {
    validateConnection(connection);
    if (this.#connectionsById.has(connection.connectionId)) {
      throw new Error(`duplicate-connection:${connection.connectionId}`);
    }
    this.#connectionsById.set(connection.connectionId, connection);
    this.#index(connection);
    return connection;
  }

  replace(connection: ConnectionData): ConnectionData {
    validateConnection(connection);
    if (!this.#connectionsById.has(connection.connectionId)) {
      throw new Error(`connection-not-found:${connection.connectionId}`);
    }
    this.#connectionsById.set(connection.connectionId, connection);
    this.#index(connection);
    return connection;
  }

  delete(connectionId: string): boolean {
    const deleted = this.#connectionsById.delete(connectionId);
    if (deleted) this.#spatialIndex?.delete(connectionId);
    return deleted;
  }

  configureSpatialIndex(
    bucketSize: number,
    resolveBounds: SpatialBoundsResolver<ConnectionData>,
  ): void {
    this.#spatialIndex = new SparseSpatialIndex(bucketSize);
    this.#resolveBounds = resolveBounds;
    for (const connection of this.#connectionsById.values()) {
      this.#index(connection);
    }
  }

  query(rect: MapRect): readonly ConnectionData[] {
    if (this.#spatialIndex === undefined) {
      throw new Error("connection-spatial-index-not-configured");
    }
    return this.#spatialIndex
      .query(rect)
      .map((id) => this.#connectionsById.get(id))
      .filter((value): value is ConnectionData => value !== undefined);
  }

  get spatialIndexStats(): SpatialIndexStats {
    return (
      this.#spatialIndex?.stats ?? {
        indexedCount: 0,
        bucketCount: 0,
        visitedBucketCount: 0,
        candidateCount: 0,
        resultCount: 0,
      }
    );
  }

  #index(connection: ConnectionData): void {
    this.#spatialIndex?.delete(connection.connectionId);
    const bounds = this.#resolveBounds?.(connection);
    if (bounds !== undefined) {
      this.#spatialIndex?.upsert(connection.connectionId, bounds);
    }
  }
}
