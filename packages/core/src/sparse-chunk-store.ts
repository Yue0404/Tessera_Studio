import { chunkCoordinateOf, chunkKeyOf, parseCellId } from "./coordinates.js";
import type {
  CellOverride,
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
  #clock = 0;

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
  }

  unassignEdge(edgeId: string, ownerCellId: string): void {
    const owner = parseCellId(ownerCellId);
    const bucket = this.#bucket(owner.row, owner.column);
    bucket?.ownedEdgeIds.delete(edgeId);
    if (bucket !== undefined) bucket.dirty = true;
    this.#dropEmptyBucket(owner.row, owner.column);
  }

  assignOverlay(overlayId: string, ownerCellId: string): void {
    const owner = parseCellId(ownerCellId);
    const bucket = this.#ensureBucket(owner.row, owner.column);
    bucket.ownedOverlayIds.add(overlayId);
    bucket.dirty = true;
  }

  unassignOverlay(overlayId: string, ownerCellId: string): void {
    const owner = parseCellId(ownerCellId);
    const bucket = this.#bucket(owner.row, owner.column);
    bucket?.ownedOverlayIds.delete(overlayId);
    if (bucket !== undefined) bucket.dirty = true;
    this.#dropEmptyBucket(owner.row, owner.column);
  }

  touchRuntimeChunk(chunkRow: number, chunkColumn: number): void {
    if (!Number.isInteger(chunkRow) || !Number.isInteger(chunkColumn)) {
      throw new RangeError("runtime-chunk-coordinate-invalid");
    }
    this.#runtimeLru.set(chunkKeyOf({ chunkRow, chunkColumn }), ++this.#clock);
  }

  evictRuntimeChunks(maxLoaded: number): readonly string[] {
    if (!Number.isInteger(maxLoaded) || maxLoaded < 0) {
      throw new RangeError("runtime-chunk-limit-invalid");
    }
    const evicted: string[] = [];
    const candidates = [...this.#runtimeLru.entries()].sort(
      (left, right) => left[1] - right[1],
    );
    for (const [key] of candidates) {
      if (this.#runtimeLru.size <= maxLoaded) break;
      if (this.#buckets.get(key)?.dirty === true) continue;
      this.#runtimeLru.delete(key);
      evicted.push(key);
    }
    return evicted;
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
}
