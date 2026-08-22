import {
  StorageRepositoryError,
  toStorageRepositoryError,
} from "./storage-error.js";

export type BinaryStreamSource =
  ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>;

export interface OpfsGateway {
  isAvailable(): Promise<boolean>;
  createCommitExclusive(commitId: string): Promise<void>;
  writeFile(
    commitId: string,
    storageKey: string,
    source: BinaryStreamSource,
    maximumBytes: number,
  ): Promise<number>;
  openFile(
    commitId: string,
    storageKey: string,
  ): Promise<ReadableStream<Uint8Array>>;
  fileSize(commitId: string, storageKey: string): Promise<number | undefined>;
  listCommitIds(): Promise<readonly string[]>;
  markCommitted(commitId: string): Promise<void>;
  isCommitted(commitId: string): Promise<boolean>;
  deleteCommit(commitId: string): Promise<void>;
}

const COMMIT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const STORAGE_KEY_PATTERN = /^(?:archive|file)-[0-9]{6}$/;
const ROOT_DIRECTORY = "tessera-storage-v1";
const COMMIT_DIRECTORY = "package-commits";
const COMMITTED_MARKER = ".committed";

function assertInternalKey(commitId: string, storageKey?: string): void {
  if (
    !COMMIT_ID_PATTERN.test(commitId) ||
    (storageKey !== undefined && !STORAGE_KEY_PATTERN.test(storageKey))
  ) {
    throw new StorageRepositoryError(
      "local-package-input-invalid",
      { field: storageKey === undefined ? "commitId" : "storageKey" },
      "retry",
    );
  }
}

export async function* iterateBinarySource(
  source: BinaryStreamSource,
): AsyncGenerator<Uint8Array> {
  const readable = source as ReadableStream<Uint8Array>;
  if (typeof readable.getReader !== "function") {
    for await (const chunk of source) {
      if (!(chunk instanceof Uint8Array)) {
        throw new StorageRepositoryError(
          "local-package-input-invalid",
          { field: "streamChunk" },
          "reimport-package",
        );
      }
      yield chunk;
    }
    return;
  }
  const reader = readable.getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) return;
      if (!(next.value instanceof Uint8Array)) {
        throw new StorageRepositoryError(
          "local-package-input-invalid",
          { field: "streamChunk" },
          "reimport-package",
        );
      }
      yield next.value;
    }
  } finally {
    reader.releaseLock();
  }
}

async function browserCommitRoot(
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  const manager = globalThis.navigator?.storage;
  if (manager === undefined || typeof manager.getDirectory !== "function") {
    throw new StorageRepositoryError(
      "opfs-unavailable",
      { capability: "getDirectory" },
      "export-project",
    );
  }
  const root = await manager.getDirectory();
  const tessera = await root.getDirectoryHandle(ROOT_DIRECTORY, { create });
  return tessera.getDirectoryHandle(COMMIT_DIRECTORY, { create });
}

function isNotFound(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotFoundError";
}

export class BrowserOpfsGateway implements OpfsGateway {
  async isAvailable(): Promise<boolean> {
    return typeof globalThis.navigator?.storage?.getDirectory === "function";
  }

  async createCommitExclusive(commitId: string): Promise<void> {
    assertInternalKey(commitId);
    try {
      const commits = await browserCommitRoot(true);
      try {
        await commits.getDirectoryHandle(commitId);
        throw new StorageRepositoryError(
          "local-package-input-invalid",
          { field: "commitId", reason: "collision" },
          "retry",
        );
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      await commits.getDirectoryHandle(commitId, { create: true });
    } catch (error) {
      throw toStorageRepositoryError(
        error,
        "opfs-operation-failed",
        { operation: "createCommit" },
        "retry",
      );
    }
  }

  async writeFile(
    commitId: string,
    storageKey: string,
    source: BinaryStreamSource,
    maximumBytes: number,
  ): Promise<number> {
    assertInternalKey(commitId, storageKey);
    try {
      const commits = await browserCommitRoot(true);
      const commit = await commits.getDirectoryHandle(commitId);
      const file = await commit.getFileHandle(storageKey, { create: true });
      const writable = await file.createWritable({ keepExistingData: false });
      let bytes = 0;
      try {
        for await (const chunk of iterateBinarySource(source)) {
          if (bytes + chunk.byteLength > maximumBytes) {
            throw new StorageRepositoryError(
              "local-package-byte-count-mismatch",
              {
                declaredBytes: maximumBytes,
                actualBytesAtLeast: bytes + chunk.byteLength,
              },
              "reimport-package",
            );
          }
          await writable.write(new Uint8Array(chunk));
          bytes += chunk.byteLength;
          if (!Number.isSafeInteger(bytes)) {
            throw new StorageRepositoryError(
              "local-package-input-invalid",
              { field: "actualBytes" },
              "reimport-package",
            );
          }
        }
        await writable.close();
      } catch (error) {
        await writable.abort().catch(() => undefined);
        throw error;
      }
      return bytes;
    } catch (error) {
      throw toStorageRepositoryError(
        error,
        "opfs-operation-failed",
        { operation: "write" },
        "retry",
      );
    }
  }

  async openFile(
    commitId: string,
    storageKey: string,
  ): Promise<ReadableStream<Uint8Array>> {
    assertInternalKey(commitId, storageKey);
    try {
      const commits = await browserCommitRoot(false);
      const commit = await commits.getDirectoryHandle(commitId);
      const handle = await commit.getFileHandle(storageKey);
      return (await handle.getFile()).stream();
    } catch (error) {
      throw toStorageRepositoryError(
        error,
        "opfs-operation-failed",
        { operation: "open" },
        "reimport-package",
      );
    }
  }

  async fileSize(
    commitId: string,
    storageKey: string,
  ): Promise<number | undefined> {
    assertInternalKey(commitId, storageKey);
    try {
      const commits = await browserCommitRoot(false);
      const commit = await commits.getDirectoryHandle(commitId);
      const handle = await commit.getFileHandle(storageKey);
      return (await handle.getFile()).size;
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw toStorageRepositoryError(
        error,
        "opfs-operation-failed",
        { operation: "stat" },
        "retry",
      );
    }
  }

  async listCommitIds(): Promise<readonly string[]> {
    try {
      const commits = await browserCommitRoot(false);
      const result: string[] = [];
      for await (const [name, handle] of commits.entries()) {
        if (handle.kind === "directory" && COMMIT_ID_PATTERN.test(name)) {
          result.push(name);
        }
      }
      return result.sort();
    } catch (error) {
      if (isNotFound(error)) return [];
      throw toStorageRepositoryError(
        error,
        "opfs-operation-failed",
        { operation: "list" },
        "retry",
      );
    }
  }

  async markCommitted(commitId: string): Promise<void> {
    assertInternalKey(commitId);
    try {
      const commits = await browserCommitRoot(false);
      const commit = await commits.getDirectoryHandle(commitId);
      const marker = await commit.getFileHandle(COMMITTED_MARKER, {
        create: true,
      });
      const writable = await marker.createWritable({ keepExistingData: false });
      await writable.close();
    } catch (error) {
      throw toStorageRepositoryError(
        error,
        "opfs-operation-failed",
        { operation: "markCommitted" },
        "retry",
      );
    }
  }

  async isCommitted(commitId: string): Promise<boolean> {
    assertInternalKey(commitId);
    try {
      const commits = await browserCommitRoot(false);
      const commit = await commits.getDirectoryHandle(commitId);
      await commit.getFileHandle(COMMITTED_MARKER);
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw toStorageRepositoryError(
        error,
        "opfs-operation-failed",
        { operation: "isCommitted" },
        "retry",
      );
    }
  }

  async deleteCommit(commitId: string): Promise<void> {
    assertInternalKey(commitId);
    try {
      const commits = await browserCommitRoot(false);
      await commits.removeEntry(commitId, { recursive: true });
    } catch (error) {
      if (isNotFound(error)) return;
      throw toStorageRepositoryError(
        error,
        "opfs-operation-failed",
        { operation: "delete" },
        "retry",
      );
    }
  }
}

export type MemoryOpfsOperation =
  "write" | "open" | "stat" | "markCommitted" | "delete";

interface MemoryOpfsFailure {
  readonly operation: MemoryOpfsOperation;
  readonly afterBytes?: number;
  readonly quotaExceeded?: boolean;
}

interface MemoryCommit {
  readonly files: Map<string, readonly Uint8Array[]>;
  committed: boolean;
}

function cloneChunks(chunks: readonly Uint8Array[]): readonly Uint8Array[] {
  return chunks.map((chunk) => new Uint8Array(chunk));
}

export class MemoryOpfsGateway implements OpfsGateway {
  readonly #commits = new Map<string, MemoryCommit>();
  #failure: MemoryOpfsFailure | undefined;
  #available = true;

  setAvailableForTest(available: boolean): void {
    this.#available = available;
  }

  failNextForTest(failure: MemoryOpfsFailure): void {
    this.#failure = failure;
  }

  async isAvailable(): Promise<boolean> {
    return this.#available;
  }

  async createCommitExclusive(commitId: string): Promise<void> {
    assertInternalKey(commitId);
    if (!this.#available) {
      throw new StorageRepositoryError(
        "opfs-unavailable",
        { capability: "memory" },
        "export-project",
      );
    }
    if (this.#commits.has(commitId)) {
      throw new StorageRepositoryError(
        "local-package-input-invalid",
        { field: "commitId", reason: "collision" },
        "retry",
      );
    }
    this.#commits.set(commitId, {
      files: new Map<string, readonly Uint8Array[]>(),
      committed: false,
    });
  }

  #takeFailure(operation: MemoryOpfsOperation): MemoryOpfsFailure | undefined {
    if (this.#failure?.operation !== operation) return undefined;
    const failure = this.#failure;
    this.#failure = undefined;
    return failure;
  }

  #throwFailure(failure: MemoryOpfsFailure): never {
    if (failure.quotaExceeded === true) {
      throw new DOMException("", "QuotaExceededError");
    }
    throw new Error("memory-opfs-injected-failure");
  }

  async writeFile(
    commitId: string,
    storageKey: string,
    source: BinaryStreamSource,
    maximumBytes: number,
  ): Promise<number> {
    assertInternalKey(commitId, storageKey);
    if (!this.#available) {
      throw new StorageRepositoryError(
        "opfs-unavailable",
        { capability: "memory" },
        "export-project",
      );
    }
    const commit = this.#commits.get(commitId);
    if (commit === undefined) throw new Error("memory-opfs-commit-missing");
    const chunks: Uint8Array[] = [];
    const failure = this.#takeFailure("write");
    let bytes = 0;
    for await (const chunk of iterateBinarySource(source)) {
      if (bytes + chunk.byteLength > maximumBytes) {
        commit.files.set(storageKey, cloneChunks(chunks));
        throw new StorageRepositoryError(
          "local-package-byte-count-mismatch",
          {
            declaredBytes: maximumBytes,
            actualBytesAtLeast: bytes + chunk.byteLength,
          },
          "reimport-package",
        );
      }
      const remaining =
        failure?.afterBytes === undefined
          ? chunk.byteLength
          : Math.max(0, failure.afterBytes - bytes);
      if (remaining < chunk.byteLength) {
        if (remaining > 0) chunks.push(chunk.slice(0, remaining));
        commit.files.set(storageKey, cloneChunks(chunks));
        if (failure === undefined) throw new Error("memory-opfs-state-invalid");
        this.#throwFailure(failure);
      }
      chunks.push(new Uint8Array(chunk));
      bytes += chunk.byteLength;
      if (failure !== undefined && failure.afterBytes === bytes) {
        commit.files.set(storageKey, cloneChunks(chunks));
        this.#throwFailure(failure);
      }
    }
    if (failure !== undefined) this.#throwFailure(failure);
    commit.files.set(storageKey, cloneChunks(chunks));
    return bytes;
  }

  async openFile(
    commitId: string,
    storageKey: string,
  ): Promise<ReadableStream<Uint8Array>> {
    assertInternalKey(commitId, storageKey);
    const failure = this.#takeFailure("open");
    if (failure !== undefined) this.#throwFailure(failure);
    const chunks = this.#commits.get(commitId)?.files.get(storageKey);
    if (chunks === undefined) {
      throw new StorageRepositoryError(
        "opfs-operation-failed",
        { operation: "open" },
        "reimport-package",
      );
    }
    const copies = cloneChunks(chunks);
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of copies) controller.enqueue(chunk);
        controller.close();
      },
    });
  }

  async fileSize(
    commitId: string,
    storageKey: string,
  ): Promise<number | undefined> {
    assertInternalKey(commitId, storageKey);
    const failure = this.#takeFailure("stat");
    if (failure !== undefined) this.#throwFailure(failure);
    const chunks = this.#commits.get(commitId)?.files.get(storageKey);
    return chunks?.reduce((total, chunk) => total + chunk.byteLength, 0);
  }

  async listCommitIds(): Promise<readonly string[]> {
    return [...this.#commits.keys()].sort();
  }

  async markCommitted(commitId: string): Promise<void> {
    assertInternalKey(commitId);
    const failure = this.#takeFailure("markCommitted");
    if (failure !== undefined) this.#throwFailure(failure);
    const commit = this.#commits.get(commitId);
    if (commit === undefined) {
      throw new Error("memory-opfs-commit-missing");
    }
    commit.committed = true;
  }

  async isCommitted(commitId: string): Promise<boolean> {
    assertInternalKey(commitId);
    return this.#commits.get(commitId)?.committed ?? false;
  }

  async deleteCommit(commitId: string): Promise<void> {
    assertInternalKey(commitId);
    const failure = this.#takeFailure("delete");
    if (failure !== undefined) this.#throwFailure(failure);
    this.#commits.delete(commitId);
  }

  deleteFileForTest(commitId: string, storageKey: string): void {
    this.#commits.get(commitId)?.files.delete(storageKey);
  }

  replaceFileForTest(
    commitId: string,
    storageKey: string,
    chunks: readonly Uint8Array[],
  ): void {
    this.#commits.get(commitId)?.files.set(storageKey, cloneChunks(chunks));
  }
}
