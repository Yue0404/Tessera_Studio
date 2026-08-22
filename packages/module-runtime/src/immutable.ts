import type { JsonValue, PackageFile } from "./types.js";

export function deepFreeze<T>(value: T): Readonly<T> {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  // 非空 TypedArray 不能被冻结；包字节在进入结果前已经逐份复制，且不向语义对象暴露写入口。
  if (ArrayBuffer.isView(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export function cloneJson<T extends JsonValue | object>(value: T): T {
  return structuredClone(value);
}

export function cloneFiles(
  files: readonly PackageFile[],
): readonly PackageFile[] {
  return Object.freeze(
    files.map((file) =>
      Object.freeze({ path: file.path, bytes: new Uint8Array(file.bytes) }),
    ),
  );
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

/** 原生 Map 即使 Object.freeze 后仍可 set；用私有副本只暴露 ReadonlyMap 协议。 */
export class ImmutableMap<K, V> implements ReadonlyMap<K, V> {
  readonly #map: Map<K, V>;

  constructor(entries: Iterable<readonly [K, V]>) {
    this.#map = new Map(entries);
    Object.freeze(this);
  }

  get size(): number {
    return this.#map.size;
  }

  get(key: K): V | undefined {
    return this.#map.get(key);
  }

  has(key: K): boolean {
    return this.#map.has(key);
  }

  entries(): MapIterator<[K, V]> {
    return this.#map.entries();
  }

  keys(): MapIterator<K> {
    return this.#map.keys();
  }

  values(): MapIterator<V> {
    return this.#map.values();
  }

  forEach(
    callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void,
    thisArg?: unknown,
  ): void {
    this.#map.forEach((value, key) =>
      callbackfn.call(thisArg, value, key, this),
    );
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.entries();
  }

  readonly [Symbol.toStringTag] = "ImmutableMap";
}
