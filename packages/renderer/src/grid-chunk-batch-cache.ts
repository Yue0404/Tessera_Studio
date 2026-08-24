export interface GridChunkDescriptor {
  readonly key: string;
  readonly revision: number;
}

export interface GridChunkBatchCacheStats {
  readonly batchCount: number;
  readonly rebuiltCount: number;
  readonly reusedCount: number;
  readonly evictedCount: number;
}

interface CacheEntry<T> {
  readonly value: T;
  revision: number;
}

/** 只管理分块批次生命周期，具体 Pixi 对象由调用者创建、重画和销毁。 */
export class GridChunkBatchCache<T> {
  readonly #entries = new Map<string, CacheEntry<T>>();
  #signature: string | null = null;

  update(
    visible: readonly GridChunkDescriptor[],
    retainedKeys: ReadonlySet<string>,
    signature: string,
    callbacks: {
      readonly create: (key: string) => T;
      readonly rebuild: (value: T, key: string) => void;
      readonly destroy: (value: T, key: string) => void;
    },
  ): GridChunkBatchCacheStats {
    let evictedCount = 0;
    if (this.#signature !== signature) {
      evictedCount += this.clear(callbacks.destroy);
      this.#signature = signature;
    }

    let rebuiltCount = 0;
    let reusedCount = 0;
    for (const descriptor of visible) {
      const existing = this.#entries.get(descriptor.key);
      if (existing === undefined) {
        const value = callbacks.create(descriptor.key);
        callbacks.rebuild(value, descriptor.key);
        this.#entries.set(descriptor.key, {
          value,
          revision: descriptor.revision,
        });
        rebuiltCount += 1;
      } else if (existing.revision !== descriptor.revision) {
        callbacks.rebuild(existing.value, descriptor.key);
        existing.revision = descriptor.revision;
        rebuiltCount += 1;
      } else {
        reusedCount += 1;
      }
    }

    for (const [key, entry] of [...this.#entries]) {
      if (retainedKeys.has(key)) continue;
      callbacks.destroy(entry.value, key);
      this.#entries.delete(key);
      evictedCount += 1;
    }
    return {
      batchCount: this.#entries.size,
      rebuiltCount,
      reusedCount,
      evictedCount,
    };
  }

  clear(destroy: (value: T, key: string) => void): number {
    const count = this.#entries.size;
    for (const [key, entry] of this.#entries) destroy(entry.value, key);
    this.#entries.clear();
    return count;
  }
}
