import { assertFiniteMapPoint } from "./coordinates.js";
import {
  SparseSpatialIndex,
  type SpatialBoundsResolver,
  type SpatialIndexStats,
} from "./sparse-spatial-index.js";
import type { OverlayData, OverlayManagerContract } from "./types.js";
import type { MapRect } from "./viewport-clipping.js";

export type ProjectTextContentViolation =
  "text-line-limit-exceeded" | "text-grapheme-limit-exceeded";

/** Project v1 的用户文字统一按字素和逻辑行计数。 */
export function projectTextContentViolation(
  value: string,
): ProjectTextContentViolation | null {
  if (value.split(/\r\n|\r|\n/u).length > 8) {
    return "text-line-limit-exceeded";
  }
  const graphemes =
    typeof Intl.Segmenter === "function"
      ? [
          ...new Intl.Segmenter("und", { granularity: "grapheme" }).segment(
            value,
          ),
        ].length
      : [...value.normalize("NFC")].length;
  return graphemes > 256 ? "text-grapheme-limit-exceeded" : null;
}

export function projectTextContentValid(value: string): boolean {
  return projectTextContentViolation(value) === null;
}

function validateOverlay(overlay: OverlayData): void {
  if (overlay.kind === "free-overlay") assertFiniteMapPoint(overlay.point);
  if (!Number.isInteger(overlay.orderInLayer)) {
    throw new RangeError("overlay-order-not-integer");
  }
  if (
    overlay.overlayType === "text" &&
    !projectTextContentValid(overlay.text)
  ) {
    throw new RangeError("overlay-text-too-long");
  }
}

/** 文字和标记的唯一所有者；锚定与自由位置使用互斥联合类型。 */
export class OverlayManager implements OverlayManagerContract {
  readonly #overlaysById = new Map<string, OverlayData>();
  readonly #edgeReferences = new Map<string, Set<string>>();
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

  hasEdgeReference(edgeId: string, excludingOverlayId?: string): boolean {
    const references = this.#edgeReferences.get(edgeId);
    if (references === undefined) return false;
    if (excludingOverlayId === undefined) return references.size > 0;
    return references.size > 1 || !references.has(excludingOverlayId);
  }

  add(overlay: OverlayData): OverlayData {
    validateOverlay(overlay);
    if (this.#overlaysById.has(overlay.overlayId)) {
      throw new Error(`duplicate-overlay:${overlay.overlayId}`);
    }
    this.#overlaysById.set(overlay.overlayId, overlay);
    this.#indexEdgeReference(overlay);
    this.#index(overlay);
    return overlay;
  }

  replace(overlay: OverlayData): OverlayData {
    validateOverlay(overlay);
    const previous = this.#overlaysById.get(overlay.overlayId);
    if (previous === undefined) {
      throw new Error(`overlay-not-found:${overlay.overlayId}`);
    }
    this.#removeEdgeReference(previous);
    this.#overlaysById.set(overlay.overlayId, overlay);
    this.#indexEdgeReference(overlay);
    this.#index(overlay);
    return overlay;
  }

  delete(overlayId: string): boolean {
    const previous = this.#overlaysById.get(overlayId);
    const deleted = this.#overlaysById.delete(overlayId);
    if (previous !== undefined) this.#removeEdgeReference(previous);
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

  #indexEdgeReference(overlay: OverlayData): void {
    if (overlay.kind !== "anchored-overlay" || overlay.anchor.kind !== "edge")
      return;
    const references =
      this.#edgeReferences.get(overlay.anchor.edgeId) ?? new Set<string>();
    references.add(overlay.overlayId);
    this.#edgeReferences.set(overlay.anchor.edgeId, references);
  }

  #removeEdgeReference(overlay: OverlayData): void {
    if (overlay.kind !== "anchored-overlay" || overlay.anchor.kind !== "edge")
      return;
    const references = this.#edgeReferences.get(overlay.anchor.edgeId);
    references?.delete(overlay.overlayId);
    if (references?.size === 0)
      this.#edgeReferences.delete(overlay.anchor.edgeId);
  }
}
