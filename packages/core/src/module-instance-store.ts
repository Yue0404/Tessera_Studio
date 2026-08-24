import {
  SparseSpatialIndex,
  type SpatialBoundsResolver,
  type SpatialIndexStats,
} from "./sparse-spatial-index.js";
import type { MapPoint } from "./types.js";
import type { MapRect } from "./viewport-clipping.js";

export type ModuleInstanceRuntimeStatus = "available" | "missing";
export type ModuleJsonObject = Readonly<Record<string, unknown>>;

interface ModuleInstanceBase {
  readonly instanceId: string;
  readonly elementId: string;
  readonly layerId: string;
  readonly styleOverrides: ModuleJsonObject;
  readonly attributes: ModuleJsonObject;
  readonly extensions: ModuleJsonObject;
  readonly runtimeStatus: ModuleInstanceRuntimeStatus;
}

export interface ModuleCellInstance extends ModuleInstanceBase {
  readonly kind: "cell";
  readonly cellId: string;
}

export interface ModuleEdgeInstance extends ModuleInstanceBase {
  readonly kind: "edge";
  readonly edgeId: string;
  readonly adjacentCellIds: readonly string[];
}

export type ModuleOverlayAnchor =
  | {
      readonly kind: "cell";
      readonly cellId: string;
      readonly extensions: ModuleJsonObject;
    }
  | {
      readonly kind: "edge";
      readonly edgeId: string;
      readonly extensions: ModuleJsonObject;
    };

export interface ModuleOverlayInstance extends ModuleInstanceBase {
  readonly kind: "overlay";
  readonly objectKind: "anchored-overlay" | "free-overlay";
  readonly overlayType: "marker" | "text";
  readonly anchor?: ModuleOverlayAnchor;
  readonly point?: Readonly<MapPoint>;
  readonly orderInLayer: number;
}

export type ModuleConnectionEndpoint =
  | {
      readonly kind: "cell-center";
      readonly cellId: string;
      readonly extensions: ModuleJsonObject;
    }
  | {
      readonly kind: "edge-midpoint";
      readonly edgeId: string;
      readonly extensions: ModuleJsonObject;
    }
  | {
      readonly kind: "map-point";
      readonly point: Readonly<MapPoint>;
      readonly extensions: ModuleJsonObject;
    };

export interface ModuleConnectionInstance extends ModuleInstanceBase {
  readonly kind: "connection";
  readonly objectKind: "line" | "arrow";
  readonly start: ModuleConnectionEndpoint;
  readonly end: ModuleConnectionEndpoint;
  readonly label: string | null;
  readonly arrowStart?: boolean;
  readonly arrowEnd?: boolean;
}

export interface ModuleDomainGroupInstance extends ModuleInstanceBase {
  readonly kind: "domain-group";
  readonly memberCellIds: readonly string[];
}

export type ModuleRuntimeInstance =
  | ModuleCellInstance
  | ModuleEdgeInstance
  | ModuleOverlayInstance
  | ModuleConnectionInstance
  | ModuleDomainGroupInstance;

export interface ModuleInstanceStoreContract {
  readonly size: number;
  get(instanceId: string): ModuleRuntimeInstance | undefined;
  values(): IterableIterator<ModuleRuntimeInstance>;
  valuesForElement(elementId: string): readonly ModuleRuntimeInstance[];
  valuesForCarrier(
    kind: ModuleRuntimeInstance["kind"],
    carrierId: string,
  ): readonly ModuleRuntimeInstance[];
  valuesForOverlayAnchor(
    kind: ModuleOverlayAnchor["kind"],
    carrierId: string,
  ): readonly ModuleOverlayInstance[];
  queryFreeOverlays(rect: MapRect): readonly ModuleOverlayInstance[];
  configureConnectionSpatialIndex(
    bucketSize: number,
    resolveBounds: SpatialBoundsResolver<ModuleConnectionInstance>,
  ): void;
  queryConnections(rect: MapRect): readonly ModuleConnectionInstance[];
  readonly connectionSpatialIndexStats: SpatialIndexStats;
  configureDomainGroupSpatialIndex(
    bucketSize: number,
    resolveBounds: SpatialBoundsResolver<ModuleDomainGroupInstance>,
  ): void;
  queryDomainGroups(rect: MapRect): readonly ModuleDomainGroupInstance[];
  readonly domainGroupSpatialIndexStats: SpatialIndexStats;
  hasEdgeReference(edgeId: string, excludingInstanceId?: string): boolean;
  add(instance: ModuleRuntimeInstance): ModuleRuntimeInstance;
  replace(instance: ModuleRuntimeInstance): ModuleRuntimeInstance;
  delete(instanceId: string): boolean;
}

function carrierKey(instance: ModuleRuntimeInstance): string {
  switch (instance.kind) {
    case "cell":
      return `cell:${instance.cellId}`;
    case "edge":
      return `edge:${instance.edgeId}`;
    case "overlay":
      return instance.objectKind === "free-overlay"
        ? `overlay-free:${instance.instanceId}`
        : `overlay-${instance.anchor?.kind}:${
            instance.anchor?.kind === "cell"
              ? instance.anchor.cellId
              : instance.anchor?.edgeId
          }`;
    case "connection":
    case "domain-group":
      return `${instance.kind}:${instance.instanceId}`;
  }
}

function cloneInstance(instance: ModuleRuntimeInstance): ModuleRuntimeInstance {
  return structuredClone(instance);
}

function referencedEdgeIds(instance: ModuleRuntimeInstance): readonly string[] {
  if (instance.kind === "edge") return [instance.edgeId];
  if (instance.kind === "overlay")
    return instance.objectKind === "anchored-overlay" &&
      instance.anchor?.kind === "edge"
      ? [instance.anchor.edgeId]
      : [];
  if (instance.kind !== "connection") return [];
  return [
    ...(instance.start.kind === "edge-midpoint" ? [instance.start.edgeId] : []),
    ...(instance.end.kind === "edge-midpoint" ? [instance.end.edgeId] : []),
  ].filter((edgeId, index, values) => values.indexOf(edgeId) === index);
}

/**
 * 通用模块实例的稀疏运行时索引。单次增删改只触碰目标 ID 与载体桶，
 * 不扫描地图尺寸或无关分块；Project v1 仍是持久化协议。
 */
export class ModuleInstanceStore implements ModuleInstanceStoreContract {
  readonly #byId = new Map<string, ModuleRuntimeInstance>();
  readonly #byElement = new Map<string, Set<string>>();
  readonly #byCarrier = new Map<string, Set<string>>();
  readonly #freeOverlayIndex = new SparseSpatialIndex(1024);
  readonly #edgeReferences = new Map<string, Set<string>>();
  #connectionIndex: SparseSpatialIndex | undefined;
  #resolveConnectionBounds:
    SpatialBoundsResolver<ModuleConnectionInstance> | undefined;
  #domainGroupIndex: SparseSpatialIndex | undefined;
  #resolveDomainGroupBounds:
    SpatialBoundsResolver<ModuleDomainGroupInstance> | undefined;

  constructor(instances: Iterable<ModuleRuntimeInstance> = []) {
    for (const instance of instances) this.add(instance);
  }

  get size(): number {
    return this.#byId.size;
  }

  get(instanceId: string): ModuleRuntimeInstance | undefined {
    return this.#byId.get(instanceId);
  }

  values(): IterableIterator<ModuleRuntimeInstance> {
    return this.#byId.values();
  }

  valuesForElement(elementId: string): readonly ModuleRuntimeInstance[] {
    const ids = this.#byElement.get(elementId);
    return ids === undefined
      ? []
      : [...ids].flatMap((id) => {
          const value = this.#byId.get(id);
          return value === undefined ? [] : [value];
        });
  }

  valuesForCarrier(
    kind: ModuleRuntimeInstance["kind"],
    carrierId: string,
  ): readonly ModuleRuntimeInstance[] {
    const ids = this.#byCarrier.get(`${kind}:${carrierId}`);
    return ids === undefined
      ? []
      : [...ids].flatMap((id) => {
          const value = this.#byId.get(id);
          return value === undefined ? [] : [value];
        });
  }

  valuesForOverlayAnchor(
    kind: ModuleOverlayAnchor["kind"],
    carrierId: string,
  ): readonly ModuleOverlayInstance[] {
    const ids = this.#byCarrier.get(`overlay-${kind}:${carrierId}`);
    return ids === undefined
      ? []
      : [...ids].flatMap((id) => {
          const value = this.#byId.get(id);
          return value?.kind === "overlay" ? [value] : [];
        });
  }

  queryFreeOverlays(rect: MapRect): readonly ModuleOverlayInstance[] {
    return this.#freeOverlayIndex.query(rect).flatMap((id) => {
      const value = this.#byId.get(id);
      return value?.kind === "overlay" && value.objectKind === "free-overlay"
        ? [value]
        : [];
    });
  }

  configureConnectionSpatialIndex(
    bucketSize: number,
    resolveBounds: SpatialBoundsResolver<ModuleConnectionInstance>,
  ): void {
    this.#connectionIndex = new SparseSpatialIndex(bucketSize);
    this.#resolveConnectionBounds = resolveBounds;
    for (const instance of this.#byId.values()) this.#indexConnection(instance);
  }

  queryConnections(rect: MapRect): readonly ModuleConnectionInstance[] {
    if (this.#connectionIndex === undefined)
      throw new Error("module-connection-spatial-index-not-configured");
    return this.#connectionIndex.query(rect).flatMap((id) => {
      const value = this.#byId.get(id);
      return value?.kind === "connection" ? [value] : [];
    });
  }

  get connectionSpatialIndexStats(): SpatialIndexStats {
    return (
      this.#connectionIndex?.stats ?? {
        indexedCount: 0,
        bucketCount: 0,
        visitedBucketCount: 0,
        candidateCount: 0,
        resultCount: 0,
      }
    );
  }

  configureDomainGroupSpatialIndex(
    bucketSize: number,
    resolveBounds: SpatialBoundsResolver<ModuleDomainGroupInstance>,
  ): void {
    this.#domainGroupIndex = new SparseSpatialIndex(bucketSize);
    this.#resolveDomainGroupBounds = resolveBounds;
    for (const instance of this.#byId.values())
      this.#indexDomainGroup(instance);
  }

  queryDomainGroups(rect: MapRect): readonly ModuleDomainGroupInstance[] {
    if (this.#domainGroupIndex === undefined)
      throw new Error("module-domain-group-spatial-index-not-configured");
    return this.#domainGroupIndex.query(rect).flatMap((id) => {
      const value = this.#byId.get(id);
      return value?.kind === "domain-group" ? [value] : [];
    });
  }

  get domainGroupSpatialIndexStats(): SpatialIndexStats {
    return (
      this.#domainGroupIndex?.stats ?? {
        indexedCount: 0,
        bucketCount: 0,
        visitedBucketCount: 0,
        candidateCount: 0,
        resultCount: 0,
      }
    );
  }

  hasEdgeReference(edgeId: string, excludingInstanceId?: string): boolean {
    const references = this.#edgeReferences.get(edgeId);
    if (references === undefined) return false;
    if (excludingInstanceId === undefined) return references.size > 0;
    return references.size > 1 || !references.has(excludingInstanceId);
  }

  add(instance: ModuleRuntimeInstance): ModuleRuntimeInstance {
    if (instance.elementId.startsWith("tessera.basic:")) {
      throw new Error(`module-instance-basic-owned:${instance.instanceId}`);
    }
    if (this.#byId.has(instance.instanceId)) {
      throw new Error(`module-instance-duplicate:${instance.instanceId}`);
    }
    const stored = cloneInstance(instance);
    this.#byId.set(stored.instanceId, stored);
    this.#indexElement(stored);
    const key = carrierKey(stored);
    const bucket = this.#byCarrier.get(key) ?? new Set<string>();
    bucket.add(stored.instanceId);
    this.#byCarrier.set(key, bucket);
    this.#indexFreeOverlay(stored);
    this.#indexConnection(stored);
    this.#indexDomainGroup(stored);
    this.#indexEdgeReferences(stored);
    return stored;
  }

  replace(instance: ModuleRuntimeInstance): ModuleRuntimeInstance {
    if (instance.elementId.startsWith("tessera.basic:")) {
      throw new Error(`module-instance-basic-owned:${instance.instanceId}`);
    }
    const previous = this.#byId.get(instance.instanceId);
    if (previous === undefined) {
      throw new Error(`module-instance-not-found:${instance.instanceId}`);
    }
    if (
      previous.kind !== instance.kind ||
      carrierKey(previous) !== carrierKey(instance)
    ) {
      throw new Error(`module-instance-carrier-change:${instance.instanceId}`);
    }
    this.#removeEdgeReferences(previous);
    this.#removeElement(previous);
    const stored = cloneInstance(instance);
    this.#byId.set(stored.instanceId, stored);
    this.#indexElement(stored);
    this.#freeOverlayIndex.delete(stored.instanceId);
    this.#indexFreeOverlay(stored);
    this.#indexConnection(stored);
    this.#indexDomainGroup(stored);
    this.#indexEdgeReferences(stored);
    return stored;
  }

  delete(instanceId: string): boolean {
    const previous = this.#byId.get(instanceId);
    if (previous === undefined) return false;
    this.#byId.delete(instanceId);
    this.#freeOverlayIndex.delete(instanceId);
    this.#connectionIndex?.delete(instanceId);
    this.#domainGroupIndex?.delete(instanceId);
    this.#removeEdgeReferences(previous);
    this.#removeElement(previous);
    const key = carrierKey(previous);
    const bucket = this.#byCarrier.get(key);
    bucket?.delete(instanceId);
    if (bucket?.size === 0) this.#byCarrier.delete(key);
    return true;
  }

  #indexFreeOverlay(instance: ModuleRuntimeInstance): void {
    if (
      instance.kind !== "overlay" ||
      instance.objectKind !== "free-overlay" ||
      instance.point === undefined
    )
      return;
    this.#freeOverlayIndex.upsert(instance.instanceId, {
      minX: instance.point.x,
      minY: instance.point.y,
      maxX: instance.point.x,
      maxY: instance.point.y,
    });
  }

  #indexElement(instance: ModuleRuntimeInstance): void {
    const instances =
      this.#byElement.get(instance.elementId) ?? new Set<string>();
    instances.add(instance.instanceId);
    this.#byElement.set(instance.elementId, instances);
  }

  #removeElement(instance: ModuleRuntimeInstance): void {
    const instances = this.#byElement.get(instance.elementId);
    instances?.delete(instance.instanceId);
    if (instances?.size === 0) this.#byElement.delete(instance.elementId);
  }

  #indexConnection(instance: ModuleRuntimeInstance): void {
    this.#connectionIndex?.delete(instance.instanceId);
    if (instance.kind !== "connection") return;
    const bounds = this.#resolveConnectionBounds?.(instance);
    if (bounds !== undefined)
      this.#connectionIndex?.upsert(instance.instanceId, bounds);
  }

  #indexDomainGroup(instance: ModuleRuntimeInstance): void {
    this.#domainGroupIndex?.delete(instance.instanceId);
    if (instance.kind !== "domain-group") return;
    const bounds = this.#resolveDomainGroupBounds?.(instance);
    if (bounds !== undefined)
      this.#domainGroupIndex?.upsert(instance.instanceId, bounds);
  }

  #indexEdgeReferences(instance: ModuleRuntimeInstance): void {
    for (const edgeId of referencedEdgeIds(instance)) {
      const references = this.#edgeReferences.get(edgeId) ?? new Set<string>();
      references.add(instance.instanceId);
      this.#edgeReferences.set(edgeId, references);
    }
  }

  #removeEdgeReferences(instance: ModuleRuntimeInstance): void {
    for (const edgeId of referencedEdgeIds(instance)) {
      const references = this.#edgeReferences.get(edgeId);
      references?.delete(instance.instanceId);
      if (references?.size === 0) this.#edgeReferences.delete(edgeId);
    }
  }
}
