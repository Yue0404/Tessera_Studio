import { ModuleRuntimeError, runtimeError } from "./errors.js";
import { canonicalJson } from "./immutable.js";
import type {
  ExtensionPackageSource,
  PackageFile,
  PackageFileDescriptor,
  PackageFileSet,
  PackageResourceAccess,
  ParsedExtensionPackage,
} from "./types.js";
import { parseJsonBytes } from "./validation.js";

const encoder = new TextEncoder();
const MAX_PACKAGE_FILES = 65_536;
const MAX_EXPANDED_BYTES = 2 * 1024 ** 3;
const MAX_IDENTITY_JSON_BYTES = 64 * 1024 ** 2;

export function normalizePackagePath(path: string): string {
  if (
    path.length === 0 ||
    path.length > 512 ||
    path.includes("\\") ||
    path.startsWith("/") ||
    /^[A-Za-z]:/u.test(path) ||
    path.includes("\0")
  ) {
    runtimeError("package-path-invalid", path || "<empty>");
  }
  const segments = path.split("/");
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    ) ||
    segments.length > 16
  ) {
    runtimeError("package-path-invalid", path);
  }
  return segments.join("/").normalize("NFC");
}

export function throwIfPackageAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) runtimeError("package-aborted", "source");
}

function assertByteLength(bytes: number, path: string): void {
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    runtimeError("package-resource-invalid", path, { bytes });
  }
}

export class BuiltInPackageSource implements ExtensionPackageSource {
  readonly origin = "built-in" as const;
  readonly #files: ReadonlyMap<string, Uint8Array>;

  constructor(files: Readonly<Record<string, Uint8Array | string>>) {
    const normalized = new Map<string, Uint8Array>();
    for (const [rawPath, content] of Object.entries(files)) {
      const path = normalizePackagePath(rawPath);
      if (normalized.has(path)) runtimeError("package-path-duplicate", path);
      normalized.set(
        path,
        typeof content === "string"
          ? encoder.encode(content)
          : new Uint8Array(content),
      );
    }
    this.#files = normalized;
  }

  async *listFiles(signal?: AbortSignal): AsyncIterable<PackageFileDescriptor> {
    for (const [path, bytes] of [...this.#files.entries()].sort(
      ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
    )) {
      throwIfPackageAborted(signal);
      yield Object.freeze({ path, bytes: bytes.byteLength });
    }
  }

  async *openFile(
    path: string,
    signal?: AbortSignal,
  ): AsyncIterable<Uint8Array> {
    throwIfPackageAborted(signal);
    const normalized = normalizePackagePath(path);
    const bytes = this.#files.get(normalized);
    if (bytes === undefined) runtimeError("package-file-missing", normalized);
    yield new Uint8Array(bytes);
    throwIfPackageAborted(signal);
  }
}

async function* validatedFileStream(
  source: ExtensionPackageSource,
  descriptor: PackageFileDescriptor,
  signal?: AbortSignal,
): AsyncIterable<Uint8Array> {
  let actualBytes = 0;
  try {
    for await (const chunk of source.openFile(descriptor.path, signal)) {
      throwIfPackageAborted(signal);
      if (Object.prototype.toString.call(chunk) !== "[object Uint8Array]") {
        runtimeError("package-resource-invalid", descriptor.path, {
          reason: "invalid-chunk",
        });
      }
      actualBytes += chunk.byteLength;
      if (
        !Number.isSafeInteger(actualBytes) ||
        actualBytes > descriptor.bytes
      ) {
        runtimeError("package-resource-invalid", descriptor.path, {
          declaredBytes: descriptor.bytes,
          actualBytes,
        });
      }
      yield chunk;
    }
  } catch (error) {
    throwIfPackageAborted(signal);
    if (error instanceof ModuleRuntimeError) throw error;
    runtimeError(
      "package-resource-invalid",
      descriptor.path,
      { reason: "source-read-failed" },
      error,
    );
  }
  throwIfPackageAborted(signal);
  if (actualBytes !== descriptor.bytes) {
    runtimeError("package-resource-invalid", descriptor.path, {
      declaredBytes: descriptor.bytes,
      actualBytes,
    });
  }
}

/**
 * 只枚举并冻结文件描述；资源内容保持可重开流式访问，不在此处聚合。
 * 这是 UserFile/持久仓库接入统一解析器的主入口。
 */
export async function readPackageSource(
  source: ExtensionPackageSource,
  signal?: AbortSignal,
): Promise<PackageResourceAccess> {
  const descriptors: PackageFileDescriptor[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  try {
    for await (const item of source.listFiles(signal)) {
      throwIfPackageAborted(signal);
      const path = normalizePackagePath(item.path);
      if (seen.has(path)) runtimeError("package-path-duplicate", path);
      assertByteLength(item.bytes, path);
      seen.add(path);
      descriptors.push(Object.freeze({ path, bytes: item.bytes }));
      if (descriptors.length > MAX_PACKAGE_FILES) {
        runtimeError("package-resource-invalid", "package", {
          maxFiles: MAX_PACKAGE_FILES,
        });
      }
      totalBytes += item.bytes;
      if (
        !Number.isSafeInteger(totalBytes) ||
        totalBytes > MAX_EXPANDED_BYTES
      ) {
        runtimeError("package-resource-invalid", "package", {
          maxTotal: MAX_EXPANDED_BYTES,
        });
      }
    }
  } catch (error) {
    throwIfPackageAborted(signal);
    if (error instanceof ModuleRuntimeError) throw error;
    runtimeError(
      "package-resource-invalid",
      "package",
      { reason: "source-list-failed" },
      error,
    );
  }
  descriptors.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const byPath = new Map(descriptors.map((item) => [item.path, item]));
  return Object.freeze({
    origin: source.origin,
    files: Object.freeze(descriptors),
    openFile(path: string, openSignal?: AbortSignal) {
      const normalized = normalizePackagePath(path);
      const descriptor = byPath.get(normalized);
      if (descriptor === undefined)
        runtimeError("package-file-missing", normalized);
      return validatedFileStream(source, descriptor, openSignal);
    },
  });
}

export async function readPackageFileBytes(
  access: PackageResourceAccess,
  path: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const normalized = normalizePackagePath(path);
  const descriptor = access.files.find((item) => item.path === normalized);
  if (descriptor === undefined)
    runtimeError("package-file-missing", normalized);
  if (descriptor.bytes > maxBytes) {
    runtimeError("package-resource-invalid", normalized, { maxBytes });
  }
  const result = new Uint8Array(descriptor.bytes);
  let offset = 0;
  for await (const chunk of access.openFile(normalized, signal)) {
    throwIfPackageAborted(signal);
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((value, index) => value === right[index]);
}

/** 仅供内置包和小型单测使用的显式内存辅助，不是安装主路径。 */
export function packageFileSetsEquivalent(
  left: Pick<PackageFileSet, "files">,
  right: Pick<PackageFileSet, "files">,
): boolean {
  const normalizeFiles = (files: readonly PackageFile[]) => {
    const result = new Map<string, Uint8Array>();
    for (const file of files) {
      const path = normalizePackagePath(file.path);
      if (result.has(path)) runtimeError("package-path-duplicate", path);
      result.set(path, file.bytes);
    }
    return result;
  };
  const leftByPath = normalizeFiles(left.files);
  const rightByPath = normalizeFiles(right.files);
  if (leftByPath.size !== rightByPath.size) return false;
  for (const [path, bytes] of leftByPath) {
    const other = rightByPath.get(path);
    if (other === undefined) return false;
    if (path.endsWith(".json")) {
      if (
        canonicalJson(parseJsonBytes(bytes, path)) !==
        canonicalJson(parseJsonBytes(other, path))
      )
        return false;
    } else if (!bytesEqual(bytes, other)) return false;
  }
  return true;
}

function packageAccess(
  value: PackageResourceAccess | Pick<ParsedExtensionPackage, "resources">,
): PackageResourceAccess {
  return "resources" in value ? value.resources : value;
}

async function streamsEqual(
  left: AsyncIterable<Uint8Array>,
  right: AsyncIterable<Uint8Array>,
  signal?: AbortSignal,
): Promise<boolean> {
  const leftIterator = left[Symbol.asyncIterator]();
  const rightIterator = right[Symbol.asyncIterator]();
  let leftChunk = new Uint8Array();
  let rightChunk = new Uint8Array();
  let leftOffset = 0;
  let rightOffset = 0;
  let leftDone = false;
  let rightDone = false;
  try {
    while (true) {
      throwIfPackageAborted(signal);
      if (leftOffset === leftChunk.byteLength && !leftDone) {
        const next = await leftIterator.next();
        leftDone = next.done === true;
        leftChunk = next.value ?? new Uint8Array();
        leftOffset = 0;
      }
      if (rightOffset === rightChunk.byteLength && !rightDone) {
        const next = await rightIterator.next();
        rightDone = next.done === true;
        rightChunk = next.value ?? new Uint8Array();
        rightOffset = 0;
      }
      if (leftDone || rightDone) return leftDone && rightDone;
      const count = Math.min(
        leftChunk.byteLength - leftOffset,
        rightChunk.byteLength - rightOffset,
      );
      for (let index = 0; index < count; index += 1) {
        if (leftChunk[leftOffset + index] !== rightChunk[rightOffset + index])
          return false;
      }
      leftOffset += count;
      rightOffset += count;
    }
  } finally {
    await Promise.all([leftIterator.return?.(), rightIterator.return?.()]);
  }
}

export async function packageSourcesEquivalent(
  leftValue: PackageResourceAccess | Pick<ParsedExtensionPackage, "resources">,
  rightValue: PackageResourceAccess | Pick<ParsedExtensionPackage, "resources">,
  signal?: AbortSignal,
): Promise<boolean> {
  const left = packageAccess(leftValue);
  const right = packageAccess(rightValue);
  if (left.files.length !== right.files.length) return false;
  const rightByPath = new Map(right.files.map((item) => [item.path, item]));
  for (const descriptor of left.files) {
    const other = rightByPath.get(descriptor.path);
    if (other === undefined) return false;
    if (descriptor.path.endsWith(".json")) {
      const leftBytes = await readPackageFileBytes(
        left,
        descriptor.path,
        MAX_IDENTITY_JSON_BYTES,
        signal,
      );
      const leftJson = canonicalJson(
        parseJsonBytes(leftBytes, descriptor.path),
      );
      const rightBytes = await readPackageFileBytes(
        right,
        descriptor.path,
        MAX_IDENTITY_JSON_BYTES,
        signal,
      );
      if (
        leftJson !== canonicalJson(parseJsonBytes(rightBytes, descriptor.path))
      )
        return false;
    } else if (
      descriptor.bytes !== other.bytes ||
      !(await streamsEqual(
        left.openFile(descriptor.path, signal),
        right.openFile(descriptor.path, signal),
        signal,
      ))
    ) {
      return false;
    }
  }
  return true;
}

export async function assertSameVersionEquivalent(
  current: PackageResourceAccess | Pick<ParsedExtensionPackage, "resources">,
  replacement:
    PackageResourceAccess | Pick<ParsedExtensionPackage, "resources">,
  identity: {
    readonly kind: string;
    readonly artifactId: string;
    readonly version: string;
  },
  signal?: AbortSignal,
): Promise<void> {
  if (!(await packageSourcesEquivalent(current, replacement, signal))) {
    runtimeError("package-version-reuse", "package", identity);
  }
}
