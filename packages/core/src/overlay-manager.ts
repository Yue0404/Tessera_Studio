import { assertFiniteMapPoint } from "./coordinates.js";
import {
  SparseSpatialIndex,
  type SpatialBoundsResolver,
  type SpatialIndexStats,
} from "./sparse-spatial-index.js";
import type { OverlayData, OverlayManagerContract } from "./types.js";
import type { MapRect } from "./viewport-clipping.js";

function validateOverlay(overlay: OverlayData): void {
  if (overlay.kind === "free-overlay") assertFiniteMapPoint(overlay.point);
  if (!Number.isInteger(overlay.orderInLayer)) {
    throw new RangeError("overlay-order-not-integer");
  }
  if (overlay.overlayType === "text" && overlay.text.length > 2048) {
    throw new RangeError("overlay-text-too-long");
  }
}

/** 文字和标记的唯一所有者；锚定与自由位置使用互斥联合类型。 */
export class OverlayManager implements OverlayManagerContract {
  readonly #overlaysById = new Map<string, OverlayData>();
  #spatialIndex: SparseSpatialIndex | undefined;
  #resolveBounds: SpatialBoundsResolver<OverlayData> | undefined;

  constructor(overlays: Iterable<OverlayData> = []) {
    for (const overlay of overlays) this.add(overlay);
  }

  get overlaysById(): ReadonlyMap<string, OverlayData> {
    return this.#overlaysById;
  }

  get size(): number {
    return this.#overlaysById.size;
  }

  get(overlayId: string): OverlayData | undefined {
    return this.#overlaysById.get(overlayId);
  }

  values(): IterableIterator<OverlayData> {
    return this.#overlaysById.values();
  }

  add(overlay: OverlayData): OverlayData {
    validateOverlay(overlay);
    if (this.#overlaysById.has(overlay.overlayId)) {
      throw new Error(`duplicate-overlay:${overlay.overlayId}`);
    }
    this.#overlaysById.set(overlay.overlayId, overlay);
    this.#index(overlay);
    return overlay;
  }

  replace(overlay: OverlayData): OverlayData {
    validateOverlay(overlay);
    if (!this.#overlaysById.has(overlay.overlayId)) {
      throw new Error(`overlay-not-found:${overlay.overlayId}`);
    }
    this.#overlaysById.set(overlay.overlayId, overlay);
    this.#index(overlay);
    return overlay;
  }

  delete(overlayId: string): boolean {
    const deleted = this.#overlaysById.delete(overlayId);
    if (deleted) this.#spatialIndex?.delete(overlayId);
    return deleted;
  }

  configureSpatialIndex(
    bucketSize: number,
    resolveBounds: SpatialBoundsResolver<OverlayData>,
  ): void {
    this.#spatialIndex = new SparseSpatialIndex(bucketSize);
    this.#resolveBounds = resolveBounds;
    for (const overlay of this.#overlaysById.values()) this.#index(overlay);
  }

  query(rect: MapRect): readonly OverlayData[] {
    if (this.#spatialIndex === undefined) {
      throw new Error("overlay-spatial-index-not-configured");
    }
    return this.#spatialIndex
      .query(rect)
      .map((id) => this.#overlaysById.get(id))
      .filter((value): value is OverlayData => value !== undefined);
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

  #index(overlay: OverlayData): void {
    this.#spatialIndex?.delete(overlay.overlayId);
    const bounds = this.#resolveBounds?.(overlay);
    if (bounds !== undefined)
      this.#spatialIndex?.upsert(overlay.overlayId, bounds);
  }
}
