/// <reference lib="webworker" />
import {
  BlobReader,
  ZipReader,
  type Entry,
  type FileEntry,
} from "@zip.js/zip.js";
import { ModuleRuntimeError } from "./errors.js";
import { normalizePackagePath } from "./source.js";
import type {
  UserFileWorkerRequest,
  UserFileWorkerResponse,
} from "./user-file-protocol.js";
import { validateZipEntryMetadata } from "./zip-entry-policy.js";

const workerScope = self as DedicatedWorkerGlobalScope;
const MAX_FILES = 65_536;
const MAX_EXPANDED_BYTES = 2 * 1024 ** 3;
const MAX_ENTRY_RATIO = 200;
const MAX_TOTAL_RATIO = 100;
let acknowledge: (() => void) | null = null;
let activeReader: ZipReader<Blob> | null = null;
let indexedFiles:
  readonly { readonly entry: FileEntry; readonly path: string }[] | null = null;

function send(response: UserFileWorkerResponse, transfer: Transferable[] = []) {
  workerScope.postMessage(response, transfer);
}

function fail(error: unknown): void {
  if (error instanceof ModuleRuntimeError) {
    send({
      type: "error",
      code: error.code,
      path: error.path,
      details: error.details,
      message: error.message,
    });
    return;
  }
  send({
    type: "error",
    code: "package-resource-invalid",
    path: "archive",
    details: { reason: "zip-read-failed" },
    message: error instanceof Error ? error.message : String(error),
  });
}

function invalid(
  path: string,
  details: Readonly<Record<string, unknown>>,
): never {
  throw new ModuleRuntimeError("package-resource-invalid", path, details);
}

function checkedEntries(entries: readonly Entry[]) {
  const files: { readonly entry: FileEntry; readonly path: string }[] = [];
  const canonical = new Set<string>();
  let expanded = 0;
  let compressed = 0;
  for (const entry of entries) {
    if (entry.directory) continue;
    const path = validateZipEntryMetadata(entry);
    const key = path.toLocaleLowerCase("en-US");
    if (canonical.has(key)) invalid(path, { reason: "canonical-collision" });
    canonical.add(key);
    files.push({ entry: entry as FileEntry, path });
    if (files.length > MAX_FILES) invalid("archive", { maxFiles: MAX_FILES });
    expanded += entry.uncompressedSize;
    compressed += entry.compressedSize;
    if (!Number.isSafeInteger(expanded) || expanded > MAX_EXPANDED_BYTES) {
      invalid("archive", { maxExpandedBytes: MAX_EXPANDED_BYTES });
    }
    if (
      entry.uncompressedSize > 0 &&
      (entry.compressedSize === 0 ||
        entry.uncompressedSize / entry.compressedSize > MAX_ENTRY_RATIO)
    ) {
      invalid(path, { maxCompressionRatio: MAX_ENTRY_RATIO });
    }
  }
  if (
    expanded > 0 &&
    (compressed === 0 || expanded / compressed > MAX_TOTAL_RATIO)
  ) {
    invalid("archive", { maxCompressionRatio: MAX_TOTAL_RATIO });
  }
  return files.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
}

async function indexArchive(file: File) {
  await activeReader?.close().catch(() => undefined);
  const reader = new ZipReader(new BlobReader(file), { useWebWorkers: false });
  try {
    const files = checkedEntries(await reader.getEntries());
    activeReader = reader;
    indexedFiles = files;
    return files;
  } catch (error) {
    await reader.close().catch(() => undefined);
    activeReader = null;
    indexedFiles = null;
    throw error;
  }
}

function waitForAcknowledge(): Promise<void> {
  return new Promise((resolve) => {
    acknowledge = resolve;
  });
}

async function list(file: File): Promise<void> {
  const files = await indexArchive(file);
  send({
    type: "listed",
    files: files.map(({ entry, path }) => ({
      path,
      bytes: entry.uncompressedSize,
    })),
  });
}

async function open(requestedPath: string): Promise<void> {
  const path = normalizePackagePath(requestedPath);
  const files = indexedFiles;
  if (activeReader === null || files === null) {
    invalid("archive", { reason: "archive-not-indexed" });
  }
  const selected = files.find((fileEntry) => fileEntry.path === path);
  if (selected === undefined) {
    throw new ModuleRuntimeError("package-file-missing", path);
  }
  let actualBytes = 0;
  const writable = new WritableStream<Uint8Array>({
    async write(value) {
      const chunk = new Uint8Array(value);
      actualBytes += chunk.byteLength;
      if (actualBytes > selected.entry.uncompressedSize) {
        invalid(path, {
          declaredBytes: selected.entry.uncompressedSize,
          actualBytes,
        });
      }
      send({ type: "chunk", chunk }, [chunk.buffer]);
      await waitForAcknowledge();
    },
  });
  await selected.entry.getData(writable, {
    checkSignature: true,
    useWebWorkers: false,
  });
  if (actualBytes !== selected.entry.uncompressedSize) {
    invalid(path, {
      declaredBytes: selected.entry.uncompressedSize,
      actualBytes,
    });
  }
  send({ type: "complete" });
}

workerScope.onmessage = ({ data }: MessageEvent<UserFileWorkerRequest>) => {
  if (data.type === "ack") {
    const resolve = acknowledge;
    acknowledge = null;
    resolve?.();
    return;
  }
  void (data.type === "list" ? list(data.file) : open(data.path)).catch(fail);
};
