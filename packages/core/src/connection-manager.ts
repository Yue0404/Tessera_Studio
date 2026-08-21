import { assertFiniteMapPoint } from "./coordinates.js";
import type {
  ConnectionData,
  ConnectionEndpoint,
  ConnectionManagerContract,
} from "./types.js";

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
    return connection;
  }

  replace(connection: ConnectionData): ConnectionData {
    validateConnection(connection);
    if (!this.#connectionsById.has(connection.connectionId)) {
      throw new Error(`connection-not-found:${connection.connectionId}`);
    }
    this.#connectionsById.set(connection.connectionId, connection);
    return connection;
  }

  delete(connectionId: string): boolean {
    return this.#connectionsById.delete(connectionId);
  }
}
