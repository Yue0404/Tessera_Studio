import { ModuleRuntimeError, runtimeError } from "./errors.js";
import type { ExtensionPackageSource, PackageFileDescriptor } from "./types.js";
import type {
  UserFileWorkerLike,
  UserFileWorkerResponse,
} from "./user-file-protocol.js";

export interface UserFilePackageSourceOptions {
  readonly createWorker?: () => UserFileWorkerLike;
}

function defaultWorkerFactory(): UserFileWorkerLike {
  return new Worker(new URL("./user-file-worker.ts", import.meta.url), {
    type: "module",
  });
}

function workerError(
  response: Extract<UserFileWorkerResponse, { type: "error" }>,
) {
  return new ModuleRuntimeError(
    response.code as ModuleRuntimeError["code"],
    response.path,
    response.details,
  );
}

/**
 * 一个 source 复用一个 Worker 与中央目录索引；调用者完成安装后必须 dispose。
 * 读取失败或取消会销毁 Worker，下次 list 可重新建立干净会话。
 */
export class UserFilePackageSource implements ExtensionPackageSource {
  readonly origin = "user-file" as const;
  readonly #file: File;
  readonly #createWorker: () => UserFileWorkerLike;
  #worker: UserFileWorkerLike | null = null;
  #descriptors: Promise<readonly PackageFileDescriptor[]> | null = null;
  #busy = false;

  constructor(file: File, options: UserFilePackageSourceOptions = {}) {
    if (file.size <= 0 || !Number.isSafeInteger(file.size)) {
      runtimeError("package-resource-invalid", "archive", {
        bytes: file.size,
      });
    }
    this.#file = file;
    this.#createWorker = options.createWorker ?? defaultWorkerFactory;
  }

  #session(): UserFileWorkerLike {
    this.#worker ??= this.#createWorker();
    return this.#worker;
  }

  #reset(): void {
    this.#worker?.terminate();
    this.#worker = null;
    this.#descriptors = null;
    this.#busy = false;
  }

  async #list(signal?: AbortSignal): Promise<readonly PackageFileDescriptor[]> {
    if (this.#descriptors !== null) return this.#descriptors;
    const worker = this.#session();
    const request = new Promise<readonly PackageFileDescriptor[]>(
      (resolve, reject) => {
        const abort = () => {
          this.#reset();
          reject(new ModuleRuntimeError("package-aborted", "archive"));
        };
        if (signal?.aborted === true) {
          abort();
          return;
        }
        signal?.addEventListener("abort", abort, { once: true });
        const settle = (action: () => void, reset: boolean) => {
          signal?.removeEventListener("abort", abort);
          worker.onmessage = null;
          worker.onerror = null;
          if (reset) this.#reset();
          action();
        };
        worker.onerror = (event) =>
          settle(
            () =>
              reject(
                new ModuleRuntimeError(
                  "package-resource-invalid",
                  "archive",
                  { reason: "worker-error" },
                  event.error,
                ),
              ),
            true,
          );
        worker.onmessage = ({ data }) => {
          if (data.type === "listed") {
            settle(() => resolve(Object.freeze([...data.files])), false);
          } else if (data.type === "error") {
            settle(() => reject(workerError(data)), true);
          }
        };
        worker.postMessage({ type: "list", file: this.#file });
      },
    ).catch((error) => {
      this.#descriptors = null;
      throw error;
    });
    this.#descriptors = request;
    return request;
  }

  async *listFiles(signal?: AbortSignal): AsyncIterable<PackageFileDescriptor> {
    for (const descriptor of await this.#list(signal)) yield descriptor;
  }

  async *openFile(
    path: string,
    signal?: AbortSignal,
  ): AsyncIterable<Uint8Array> {
    const descriptors = await this.#list(signal);
    if (!descriptors.some((item) => item.path === path)) {
      runtimeError("package-file-missing", path);
    }
    if (this.#busy) {
      runtimeError("package-resource-invalid", path, {
        reason: "concurrent-open-not-supported",
      });
    }
    this.#busy = true;
    const worker = this.#session();
    let completed = false;
    let aborted = false;
    const queue: UserFileWorkerResponse[] = [];
    let wake: (() => void) | null = null;
    const abort = () => {
      aborted = true;
      this.#reset();
      wake?.();
    };
    if (signal?.aborted === true) abort();
    signal?.addEventListener("abort", abort, { once: true });
    worker.onerror = (event) => {
      queue.push({
        type: "error",
        code: "package-resource-invalid",
        path,
        details: { reason: "worker-error" },
        message: event.message,
      });
      wake?.();
    };
    worker.onmessage = ({ data }) => {
      queue.push(data);
      wake?.();
    };
    worker.postMessage({ type: "open", path });
    try {
      while (!aborted) {
        if (signal?.aborted === true)
          throw new ModuleRuntimeError("package-aborted", path);
        const response = queue.shift();
        if (response === undefined) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          wake = null;
          continue;
        }
        if (response.type === "chunk") {
          yield response.chunk;
          worker.postMessage({ type: "ack" });
        } else if (response.type === "complete") {
          completed = true;
          return;
        } else if (response.type === "error") {
          throw workerError(response);
        }
      }
      throw new ModuleRuntimeError("package-aborted", path);
    } finally {
      signal?.removeEventListener("abort", abort);
      worker.onmessage = null;
      worker.onerror = null;
      this.#busy = false;
      if (!completed) this.#reset();
    }
  }

  dispose(): void {
    this.#reset();
  }
}

export type { UserFileWorkerLike } from "./user-file-protocol.js";
