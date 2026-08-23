import {
  CHUNK_SIZE,
  assertGridCoordinate,
  chunkCoordinateOf,
  chunkKeyOf,
  parseCellId,
} from "./coordinates.js";
import type {
  CellCoordinate,
  CellOverride,
  ProjectGrid,
  RuntimeChunkCacheOptions,
  RuntimeChunkCacheStats,
  SparseCellStoreContract,
  SparseChunkBucket,
} from "./types.js";

interface MutableBucket {
  chunkRow: number;
  chunkColumn: number;
  cellIds: Set<string>;
  ownedEdgeIds: Set<string>;
  ownedOverlayIds: Set<string>;
  ownedDomainGroupIds: Set<string>;
  dirty: boolean;
}

/** 64×64 稳定文件桶；空白地格从不进入存储。 */
export class SparseChunkStore implements SparseCellStoreContract {
  readonly #cells = new Map<string, CellOverride>();
  readonly #buckets = new Map<string, MutableBucket>();
  readonly #runtimeLru = new Map<string, number>();
  readonly #runtimeChunkRevisions = new Map<string, number>();
  #clock = 0;
  #contentRevision = 0;

  constructor(cells: Iterable<CellOverride> = []) {
    for (const cell of cells) this.set(cell.cellId, cell);
    for (const bucket of this.#buckets.values()) bucket.dirty = false;
  }

  get size(): number {
    return this.#cells.size;
  }

  get bucketCount(): number {
    return this.#buckets.size;
  }

  get loadedChunkKeys(): readonly string[] {
    return [...this.#runtimeLru.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([key]) => key);
  }

  get(cellId: string): CellOverride | undefined {
    return this.#cells.get(cellId);
  }

  set(cellId: string, value: CellOverride): this {
    if (cellId !== value.cellId) throw new Error("cell-id-key-mismatch");
    const parsed = parseCellId(cellId);
    this.#cells.set(cellId, value);
    this.#ensureBucket(parsed.row, parsed.column).cellIds.add(cellId);
    this.#markDirty(parsed.row, parsed.column);
    return this;
  }

  delete(cellId: string): boolean {
    const parsed = parseCellId(cellId);
    const deleted = this.#cells.delete(cellId);
    if (!deleted) return false;
    const bucket = this.#bucket(parsed.row, parsed.column);
    bucket?.cellIds.delete(cellId);
    if (bucket !== undefined) bucket.dirty = true;
    this.#bumpRuntimeChunk(parsed.row, parsed.column);
    this.#dropEmptyBucket(parsed.row, parsed.column);
    return true;
  }

  values(): IterableIterator<CellOverride> {
    return this.#cells.values();
  }

  buckets(): IterableIterator<SparseChunkBucket> {
    return this.#buckets.values();
  }

  assignEdge(edgeId: string, ownerCellId: string): void {
    const owner = parseCellId(ownerCellId);
    const bucket = this.#ensureBucket(owner.row, owner.column);
    bucket.ownedEdgeIds.add(edgeId);
    bucket.dirty = true;
    this.#bumpRuntimeChunk(owner.row, owner.column);
  }

  unassignEdge(edgeId: string, ownerCellId: string): void {
    const owner = parseCellId(ownerCellId);
    const bucket = this.#bucket(owner.row, owner.column);
    const deleted = bucket?.ownedEdgeIds.delete(edgeId) ?? false;
    if (bucket !== undefined) bucket.dirty = true;
    if (deleted) this.#bumpRuntimeChunk(owner.row, owner.column);
    this.#dropEmptyBucket(owner.row, owner.column);
  }

  assignOverlay(overlayId: string, ownerCellId: string): void {
    const owner = parseCellId(ownerCellId);
    const bucket = this.#ensureBucket(owner.row, owner.column);
    bucket.ownedOverlayIds.add(overlayId);
    bucket.dirty = true;
    this.#bumpRuntimeChunk(owner.row, owner.column);
  }

  unassignOverlay(overlayId: string, ownerCellId: string): void {
    const owner = parseCellId(ownerCellId);
    const bucket = this.#bucket(owner.row, owner.column);
    const deleted = bucket?.ownedOverlayIds.delete(overlayId) ?? false;
    if (bucket !== undefined) bucket.dirty = true;
    if (deleted) this.#bumpRuntimeChunk(owner.row, owner.column);
    this.#dropEmptyBucket(owner.row, owner.column);
  }

  touchRuntimeChunk(chunkRow: number, chunkColumn: number): void {
    if (!Number.isInteger(chunkRow) || !Number.isInteger(chunkColumn)) {
      throw new RangeError("runtime-chunk-coordinate-invalid");
    }
    this.#runtimeLru.set(chunkKeyOf({ chunkRow, chunkColumn }), ++this.#clock);
  }

  evictRuntimeChunks(maxLoaded: number): readonly string[] {
    return this.#evictRuntimeChunks(maxLoaded, new Set());
  }

  #evictRuntimeChunks(
    maxLoaded: number,
    protectedKeys: ReadonlySet<string>,
  ): readonly string[] {
    if (!Number.isInteger(maxLoaded) || maxLoaded < 0) {
      throw new RangeError("runtime-chunk-limit-invalid");
    }
    const evicted: string[] = [];
    const candidates = [...this.#runtimeLru.entries()].sort(
      (left, right) => left[1] - right[1],
    );
    for (const [key] of candidates) {
      if (this.#runtimeLru.size <= maxLoaded) break;
      if (protectedKeys.has(key)) continue;
      if (this.#buckets.get(key)?.dirty === true) continue;
      this.#runtimeLru.delete(key);
      evicted.push(key);
    }
    return evicted;
  }

  updateRuntimeViewport(
    grid: ProjectGrid,
    visibleCells: readonly CellCoordinate[],
    options: RuntimeChunkCacheOptions = {},
  ): RuntimeChunkCacheStats {
    const rings = options.prefetchRings ?? 2;
    const maxLoaded = options.maxLoaded ?? 256;
    if (!Number.isInteger(rings) || rings < 0 || rings > 2) {
      throw new RangeError("runtime-chunk-prefetch-invalid");
    }
    if (!Number.isInteger(maxLoaded) || maxLoaded < 0) {
      throw new RangeError("runtime-chunk-limit-invalid");
    }
    if (visibleCells.length === 0) {
      const evictedChunkKeys = this.evictRuntimeChunks(maxLoaded);
      return {
        visibleChunkCount: 0,
        prefetchedChunkCount: 0,
        hitCount: 0,
        missCount: 0,
        loadedChunkCount: this.#runtimeLru.size,
        dirtyRetainedCount: this.#dirtyLoadedCount(),
        evictedChunkKeys,
      };
    }

    let minChunkRow = Number.POSITIVE_INFINITY;
    let maxChunkRow = Number.NEGATIVE_INFINITY;
    let minChunkColumn = Number.POSITIVE_INFINITY;
    let maxChunkColumn = Number.NEGATIVE_INFINITY;
    const visibleKeys = new Set<string>();
    for (const cell of visibleCells) {
      assertGridCoordinate(grid, cell);
      const chunk = chunkCoordinateOf(cell);
      minChunkRow = Math.min(minChunkRow, chunk.chunkRow);
      maxChunkRow = Math.max(maxChunkRow, chunk.chunkRow);
      minChunkColumn = Math.min(minChunkColumn, chunk.chunkColumn);
      maxChunkColumn = Math.max(maxChunkColumn, chunk.chunkColumn);
      visibleKeys.add(chunkKeyOf(chunk));
    }

    const lastChunkRow = Math.floor((grid.height - 1) / CHUNK_SIZE);
    const lastChunkColumn = Math.floor((grid.width - 1) / CHUNK_SIZE);
    const workingKeys: string[] = [];
    for (
      let chunkRow = Math.max(0, minChunkRow - rings);
      chunkRow <= Math.min(lastChunkRow, maxChunkRow + rings);
      chunkRow += 1
    ) {
      for (
        let chunkColumn = Math.max(0, minChunkColumn - rings);
        chunkColumn <= Math.min(lastChunkColumn, maxChunkColumn + rings);
        chunkColumn += 1
      ) {
        workingKeys.push(chunkKeyOf({ chunkRow, chunkColumn }));
      }
    }

    let hitCount = 0;
    let missCount = 0;
    for (const key of workingKeys) {
      if (this.#runtimeLru.has(key)) hitCount += 1;
      else missCount += 1;
      this.#runtimeLru.set(key, ++this.#clock);
    }
    const evictedChunkKeys = this.#evictRuntimeChunks(
      Math.max(maxLoaded, workingKeys.length),
      new Set(workingKeys),
    );
    return {
      visibleChunkCount: visibleKeys.size,
      prefetchedChunkCount: workingKeys.length - visibleKeys.size,
      hitCount,
      missCount,
      loadedChunkCount: this.#runtimeLru.size,
      dirtyRetainedCount: this.#dirtyLoadedCount(),
      evictedChunkKeys,
    };
  }

  getRuntimeChunkRevision(chunkRow: number, chunkColumn: number): number {
    return (
      this.#runtimeChunkRevisions.get(chunkKeyOf({ chunkRow, chunkColumn })) ??
      0
    );
  }

  invalidateRuntimeChunkForCell(cellId: string): void {
    const coordinate = parseCellId(cellId);
    this.#bumpRuntimeChunk(coordinate.row, coordinate.column);
  }

  markAllClean(): void {
    for (const bucket of this.#buckets.values()) bucket.dirty = false;
  }

  #bucket(row: number, column: number): MutableBucket | undefined {
    return this.#buckets.get(chunkKeyOf(chunkCoordinateOf({ row, column })));
  }

  #ensureBucket(row: number, column: number): MutableBucket {
    const coordinate = chunkCoordinateOf({ row, column });
    const key = chunkKeyOf(coordinate);
    const existing = this.#buckets.get(key);
    if (existing !== undefined) return existing;
    const created: MutableBucket = {
      ...coordinate,
      cellIds: new Set(),
      ownedEdgeIds: new Set(),
      ownedOverlayIds: new Set(),
      ownedDomainGroupIds: new Set(),
      dirty: false,
    };
    this.#buckets.set(key, created);
    return created;
  }

  #markDirty(row: number, column: number): void {
    this.#ensureBucket(row, column).dirty = true;
    this.#bumpRuntimeChunk(row, column);
  }

  #bumpRuntimeChunk(row: number, column: number): void {
    const key = chunkKeyOf(chunkCoordinateOf({ row, column }));
    this.#runtimeChunkRevisions.set(key, ++this.#contentRevision);
  }

  #dropEmptyBucket(row: number, column: number): void {
    const coordinate = chunkCoordinateOf({ row, column });
    const key = chunkKeyOf(coordinate);
    const bucket = this.#buckets.get(key);
    if (
      bucket !== undefined &&
      bucket.cellIds.size === 0 &&
      bucket.ownedEdgeIds.size === 0 &&
      bucket.ownedOverlayIds.size === 0 &&
      bucket.ownedDomainGroupIds.size === 0
    ) {
      this.#buckets.delete(key);
    }
  }

  #dirtyLoadedCount(): number {
    let count = 0;
    for (const key of this.#runtimeLru.keys()) {
      if (this.#buckets.get(key)?.dirty === true) count += 1;
    }
    return count;
  }
}
