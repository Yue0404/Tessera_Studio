import type { MapRect } from "./viewport-clipping.js";

export interface SpatialIndexStats {
  readonly indexedCount: number;
  readonly bucketCount: number;
  readonly visitedBucketCount: number;
  readonly candidateCount: number;
  readonly resultCount: number;
}

export type SpatialBoundsResolver<T> = (value: T) => MapRect | undefined;

const MAX_BUCKETS_PER_OBJECT = 4096;
const MAX_QUERY_BUCKETS = 4096;

function intersects(left: MapRect, right: MapRect): boolean {
  return (
    left.minX <= right.maxX &&
    left.maxX >= right.minX &&
    left.minY <= right.maxY &&
    left.maxY >= right.minY
  );
}

function assertRect(rect: MapRect): void {
  if (
    ![rect.minX, rect.minY, rect.maxX, rect.maxY].every(Number.isFinite) ||
    rect.minX > rect.maxX ||
    rect.minY > rect.maxY
  ) {
    throw new RangeError("spatial-index-rect-invalid");
  }
}

/** 稀疏均匀网格索引；只分配实际对象覆盖的桶。 */
export class SparseSpatialIndex {
  readonly #buckets = new Map<string, Set<string>>();
  readonly #bounds = new Map<string, MapRect>();
  readonly #keysById = new Map<string, readonly string[]>();
  readonly #globalIds = new Set<string>();
  readonly #bucketSize: number;
  #lastQuery: SpatialIndexStats;

  constructor(bucketSize: number) {
    if (!Number.isFinite(bucketSize) || bucketSize <= 0) {
      throw new RangeError("spatial-index-bucket-size-invalid");
    }
    this.#bucketSize = bucketSize;
    this.#lastQuery = this.#stats(0, 0, 0);
  }

  get stats(): SpatialIndexStats {
    return {
      ...this.#lastQuery,
      indexedCount: this.#bounds.size,
      bucketCount: this.#buckets.size,
    };
  }

  clear(): void {
    this.#buckets.clear();
    this.#bounds.clear();
    this.#keysById.clear();
    this.#globalIds.clear();
    this.#lastQuery = this.#stats(0, 0, 0);
  }

  upsert(id: string, rect: MapRect): void {
    assertRect(rect);
    this.delete(id);
    const keys = this.#keysFor(rect, MAX_BUCKETS_PER_OBJECT);
    this.#bounds.set(id, { ...rect });
    if (keys === null) {
      this.#globalIds.add(id);
      this.#keysById.set(id, []);
      return;
    }
    this.#keysById.set(id, keys);
    for (const key of keys) {
      const bucket = this.#buckets.get(key) ?? new Set<string>();
      bucket.add(id);
      this.#buckets.set(key, bucket);
    }
  }

  delete(id: string): void {
    for (const key of this.#keysById.get(id) ?? []) {
      const bucket = this.#buckets.get(key);
      bucket?.delete(id);
      if (bucket?.size === 0) this.#buckets.delete(key);
    }
    this.#keysById.delete(id);
    this.#bounds.delete(id);
    this.#globalIds.delete(id);
  }

  query(rect: MapRect): readonly string[] {
    assertRect(rect);
    const candidates = new Set<string>(this.#globalIds);
    const keys = this.#keysFor(rect, MAX_QUERY_BUCKETS);
    if (keys === null) {
      for (const id of this.#bounds.keys()) candidates.add(id);
    } else {
      for (const key of keys) {
        for (const id of this.#buckets.get(key) ?? []) candidates.add(id);
      }
    }
    const result = [...candidates]
      .filter((id) => {
        const bounds = this.#bounds.get(id);
        return bounds !== undefined && intersects(bounds, rect);
      })
      .sort();
    this.#lastQuery = this.#stats(
      keys?.length ?? 0,
      candidates.size,
      result.length,
    );
    return result;
  }

  #keysFor(rect: MapRect, maximum: number): readonly string[] | null {
    const minColumn = Math.floor(rect.minX / this.#bucketSize);
    const maxColumn = Math.floor(rect.maxX / this.#bucketSize);
    const minRow = Math.floor(rect.minY / this.#bucketSize);
    const maxRow = Math.floor(rect.maxY / this.#bucketSize);
    const rowCount = maxRow - minRow + 1;
    const columnCount = maxColumn - minColumn + 1;
    if (rowCount * columnCount > maximum) return null;
    const keys: string[] = [];
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1) {
        keys.push(`${row}:${column}`);
      }
    }
    return keys;
  }

  #stats(
    visitedBucketCount: number,
    candidateCount: number,
    resultCount: number,
  ): SpatialIndexStats {
    return {
      indexedCount: this.#bounds.size,
      bucketCount: this.#buckets.size,
      visitedBucketCount,
      candidateCount,
      resultCount,
    };
  }
}
