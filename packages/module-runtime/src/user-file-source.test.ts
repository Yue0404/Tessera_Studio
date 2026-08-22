import { describe, expect, it } from "vitest";
import { ModuleRuntimeError } from "./errors.js";
import type {
  UserFileWorkerLike,
  UserFileWorkerRequest,
  UserFileWorkerResponse,
} from "./user-file-protocol.js";
import { UserFilePackageSource } from "./user-file-source.js";
import {
  validateZipEntryMetadata,
  type ZipEntryMetadata,
} from "./zip-entry-policy.js";

const encoder = new TextEncoder();

class FakeArchiveWorker implements UserFileWorkerLike {
  onmessage: ((event: MessageEvent<UserFileWorkerResponse>) => void) | null =
    null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly opens: string[] = [];
  lists = 0;
  terminated = false;
  #pendingComplete = false;

  constructor(
    private readonly files: Readonly<Record<string, Uint8Array>>,
    private readonly listFailure = false,
  ) {}

  #emit(data: UserFileWorkerResponse): void {
    this.onmessage?.(new MessageEvent("message", { data }));
  }

  postMessage(message: UserFileWorkerRequest): void {
    if (message.type === "list") {
      this.lists += 1;
      queueMicrotask(() => {
        if (this.listFailure) {
          this.#emit({
            type: "error",
            code: "package-resource-invalid",
            path: "archive",
            details: { reason: "fixture-list-failure" },
            message: "fixture-list-failure",
          });
          return;
        }
        this.#emit({
          type: "listed",
          files: Object.entries(this.files).map(([path, bytes]) => ({
            path,
            bytes: bytes.byteLength,
          })),
        });
      });
      return;
    }
    if (message.type === "open") {
      this.opens.push(message.path);
      const bytes = this.files[message.path];
      queueMicrotask(() => {
        if (bytes === undefined) return;
        this.#pendingComplete = true;
        this.#emit({ type: "chunk", chunk: bytes.slice() });
      });
      return;
    }
    if (this.#pendingComplete) {
      this.#pendingComplete = false;
      queueMicrotask(() => this.#emit({ type: "complete" }));
    }
  }

  terminate(): void {
    this.terminated = true;
  }
}

async function collectBytes(
  source: UserFilePackageSource,
  path: string,
): Promise<number[]> {
  const result: number[] = [];
  for await (const chunk of source.openFile(path)) result.push(...chunk);
  return result;
}

async function collectItems<T>(source: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of source) items.push(item);
  return items;
}

function entry(overrides: Partial<ZipEntryMetadata> = {}): ZipEntryMetadata {
  return {
    filename: "assets/icon.png",
    rawFilename: encoder.encode("assets/icon.png"),
    compressionMethod: 8,
    compressedSize: 12,
    uncompressedSize: 24,
    unixMode: 0o100644,
    ...overrides,
  };
}

describe("UserFilePackageSource", () => {
  it("同一 source 只枚举一次中央目录并复用 Worker 打开多个文件", async () => {
    const worker = new FakeArchiveWorker({
      "module.json": new Uint8Array([1, 2]),
      "assets/icon.png": new Uint8Array([3, 4, 5]),
    });
    let workerCount = 0;
    const source = new UserFilePackageSource(new File(["zip"], "test.zip"), {
      createWorker: () => {
        workerCount += 1;
        return worker;
      },
    });

    expect(await collectItems(source.listFiles())).toHaveLength(2);
    expect(await collectItems(source.listFiles())).toHaveLength(2);
    expect(await collectBytes(source, "module.json")).toEqual([1, 2]);
    expect(await collectBytes(source, "assets/icon.png")).toEqual([3, 4, 5]);
    expect(workerCount).toBe(1);
    expect(worker.lists).toBe(1);
    expect(worker.opens).toEqual(["module.json", "assets/icon.png"]);
    expect(worker.terminated).toBe(false);

    source.dispose();
    expect(worker.terminated).toBe(true);
  });

  it("枚举失败不会缓存 rejected Promise，下次可重建 Worker", async () => {
    const workers = [
      new FakeArchiveWorker({}, true),
      new FakeArchiveWorker({ "module.json": new Uint8Array([1]) }),
    ];
    const source = new UserFilePackageSource(new File(["zip"], "test.zip"), {
      createWorker: () => {
        const worker = workers.shift();
        if (worker === undefined) throw new Error("测试 Worker 已耗尽");
        return worker;
      },
    });

    await expect(collectItems(source.listFiles())).rejects.toMatchObject({
      code: "package-resource-invalid",
    });
    expect(await collectItems(source.listFiles())).toEqual([
      { path: "module.json", bytes: 1 },
    ]);
  });

  it("取消会终止会话且不返回半成品", async () => {
    const worker = new FakeArchiveWorker({
      "module.json": new Uint8Array([1, 2]),
    });
    const source = new UserFilePackageSource(new File(["zip"], "test.zip"), {
      createWorker: () => worker,
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      collectItems(source.listFiles(controller.signal)),
    ).rejects.toBeInstanceOf(ModuleRuntimeError);
    expect(worker.terminated).toBe(true);
  });
});

describe("ZIP 中央目录策略", () => {
  it("data descriptor 有可靠中央目录尺寸时允许", () => {
    expect(
      validateZipEntryMetadata(entry({ bitFlag: { dataDescriptor: true } })),
    ).toBe("assets/icon.png");
  });

  it("data descriptor 无法预检尺寸时 fail-closed", () => {
    expect(() =>
      validateZipEntryMetadata(
        entry({
          bitFlag: { dataDescriptor: true },
          compressedSize: Number.NaN,
        }),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "package-resource-invalid",
        details: { reason: "data-descriptor-size-unavailable" },
      }),
    );
  });

  it("拒绝未知压缩方法、非 UTF-8 名称与非普通或可执行文件", () => {
    for (const invalidEntry of [
      entry({ compressionMethod: 12 }),
      entry({ rawFilename: new Uint8Array([0xff]) }),
      entry({ unixMode: 0o120777 }),
      entry({ executable: true }),
    ]) {
      expect(() => validateZipEntryMetadata(invalidEntry)).toThrowError(
        expect.objectContaining({ code: "package-resource-invalid" }),
      );
    }
  });
});
