import { createProject } from "@tessera/core";
import { describe, expect, it } from "vitest";
import {
  FixedStorageEstimateGateway,
  LocalPackageRepository,
  MemoryOpfsGateway,
  MemoryRepositoryLockGateway,
  ProjectRepository,
  type BinaryStreamSource,
  type LocalPackageIdentity,
  type ValidatedLocalPackageInput,
} from "./index.js";

const IDENTITY: LocalPackageIdentity = {
  kind: "module",
  artifactId: "example.boundaries",
  version: "1.0.0",
};
const CAPACITY = new FixedStorageEstimateGateway({
  quota: 4 * 1024 * 1024 * 1024,
  usage: 0,
});

function bytesSource(...values: number[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(values));
      controller.close();
    },
  });
}

function packageInput(
  value: number,
  options: {
    readonly identity?: LocalPackageIdentity;
    readonly sourceKind?: ValidatedLocalPackageInput["sourceKind"];
    readonly archiveSource?: BinaryStreamSource;
    readonly fileSource?: BinaryStreamSource;
    readonly fileBytes?: number;
    readonly files?: readonly Readonly<{
      path: string;
      bytes: number;
      source: BinaryStreamSource;
    }>[];
  } = {},
): ValidatedLocalPackageInput {
  const files = options.files ?? [
    {
      path: "module.json",
      bytes: options.fileBytes ?? 1,
      source: options.fileSource ?? bytesSource(value),
    },
  ];
  return {
    identity: options.identity ?? IDENTITY,
    sourceKind: options.sourceKind ?? "user-file",
    archive: {
      fileName: "example.tessera-module.zip",
      bytes: 2,
      source: options.archiveSource ?? bytesSource(80, 75),
    },
    expandedBytes: files.reduce((total, file) => total + file.bytes, 0),
    files,
  };
}

async function readBytes(
  stream: ReadableStream<Uint8Array>,
): Promise<readonly number[]> {
  const result: number[] = [];
  for await (const chunk of stream) result.push(...chunk);
  return result;
}

function repository(
  databaseName: string,
  opfs: MemoryOpfsGateway,
  lock: MemoryRepositoryLockGateway,
  options: {
    readonly uuidGenerator?: () => string;
    readonly now?: () => string;
    readonly estimateGateway?: FixedStorageEstimateGateway;
  } = {},
): LocalPackageRepository {
  return new LocalPackageRepository({
    databaseName,
    opfs,
    lockGateway: lock,
    estimateGateway: options.estimateGateway ?? CAPACITY,
    ...(options.uuidGenerator === undefined
      ? {}
      : { uuidGenerator: options.uuidGenerator }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
}

describe("LocalPackageRepository", () => {
  it("安装、刷新发现、精确打开、同身份替换与删除均保持 manifest/path 分离", async () => {
    const databaseName = `packages-${crypto.randomUUID()}`;
    const opfs = new MemoryOpfsGateway();
    const lock = new MemoryRepositoryLockGateway();
    const first = repository(databaseName, opfs, lock);
    const installed = await first.install(packageInput(1));
    expect(installed.package).toMatchObject({
      identity: IDENTITY,
      sourceKind: "user-file",
      files: [{ path: "module.json", bytes: 1 }],
    });
    expect(await first.listRegistrations()).toMatchObject([
      { status: "ready", reasonCode: null },
    ]);
    first.close();

    const reopened = repository(databaseName, opfs, lock);
    expect(await reopened.findExact(IDENTITY)).toMatchObject({
      identity: IDENTITY,
    });
    expect(
      await readBytes(await reopened.openFile(IDENTITY, "module.json")),
    ).toEqual([1]);
    expect(await readBytes(await reopened.openArchive(IDENTITY))).toEqual([
      80, 75,
    ]);
    const replaced = await reopened.replace(packageInput(2));
    expect(replaced.replacedCommitId).not.toBeNull();
    expect(
      await readBytes(await reopened.openFile(IDENTITY, "module.json")),
    ).toEqual([2]);
    expect(await reopened.list()).toHaveLength(1);
    expect(await reopened.delete(IDENTITY)).toMatchObject({ deleted: true });
    expect(await reopened.findExact(IDENTITY)).toBeUndefined();
    reopened.close();
  });

  it.each([
    ["after-staging-validation", "local-package-install-failed", false],
    ["during-database-transaction", "local-package-database-failed", false],
    ["after-database-commit", "local-package-finalize-failed", true],
    ["during-finalize-cleanup", "local-package-finalize-failed", true],
  ] as const)(
    "%s 故障不覆盖旧包，pending 可由恢复完成",
    async (failureStep, expectedCode, pendingExpected) => {
      const databaseName = `phase-${crypto.randomUUID()}`;
      const opfs = new MemoryOpfsGateway();
      const lock = new MemoryRepositoryLockGateway();
      const current = repository(databaseName, opfs, lock);
      await current.install(packageInput(1));
      await expect(
        current.replace(packageInput(2), {
          failureHook(step) {
            if (step === failureStep) throw new Error("injected");
          },
        }),
      ).rejects.toMatchObject({ code: expectedCode });
      expect(
        await readBytes(await current.openFile(IDENTITY, "module.json")),
      ).toEqual([1]);
      expect(await current.pendingCountForTest()).toBe(pendingExpected ? 1 : 0);
      if (pendingExpected) {
        expect(await current.listRegistrations()).toMatchObject([
          { status: "pending", reasonCode: "local-package-not-ready" },
        ]);
        const report = await current.recover();
        expect(report.completedCommitIds).toHaveLength(1);
        expect(
          await readBytes(await current.openFile(IDENTITY, "module.json")),
        ).toEqual([2]);
      }
      current.close();
    },
  );

  it("staging 写入中断、写时配额与实际超长流均不产生半注册", async () => {
    const databaseName = `staging-${crypto.randomUUID()}`;
    const opfs = new MemoryOpfsGateway();
    const lock = new MemoryRepositoryLockGateway();
    const current = repository(databaseName, opfs, lock);
    opfs.failNextForTest({ operation: "write", afterBytes: 1 });
    await expect(current.install(packageInput(1))).rejects.toMatchObject({
      code: "local-package-install-failed",
    });
    expect(await current.list()).toEqual([]);
    expect(await opfs.listCommitIds()).toEqual([]);

    opfs.failNextForTest({ operation: "write", quotaExceeded: true });
    await expect(current.install(packageInput(1))).rejects.toMatchObject({
      code: "storage-quota-write-failed",
      uiAction: "free-space",
    });
    expect(await current.list()).toEqual([]);

    let consumed = 0;
    const tooLong = {
      async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
        consumed += 1;
        yield new Uint8Array([1]);
        consumed += 1;
        yield new Uint8Array([2, 3]);
        consumed += 1;
        yield new Uint8Array([4]);
      },
    };
    await expect(
      current.install(packageInput(1, { fileSource: tooLong, fileBytes: 1 })),
    ).rejects.toMatchObject({ code: "local-package-byte-count-mismatch" });
    expect(consumed).toBe(2);
    expect(await current.list()).toEqual([]);

    await expect(
      current.install(
        packageInput(1, { fileSource: bytesSource(1), fileBytes: 2 }),
      ),
    ).rejects.toMatchObject({
      code: "local-package-byte-count-mismatch",
      details: { declaredBytes: 2, actualBytes: 1 },
    });
    expect(await current.list()).toEqual([]);
    current.close();
  });

  it("preset 与 generated-local 使用相同通用格式并按精确版本查询", async () => {
    const current = repository(
      `preset-${crypto.randomUUID()}`,
      new MemoryOpfsGateway(),
      new MemoryRepositoryLockGateway(),
    );
    const presetIdentity: LocalPackageIdentity = {
      kind: "preset",
      artifactId: "example.starter",
      version: "2.1.0",
    };
    await current.install(
      packageInput(1, {
        identity: presetIdentity,
        sourceKind: "generated-local",
      }),
    );
    expect(await current.findExact(presetIdentity)).toMatchObject({
      identity: presetIdentity,
      sourceKind: "generated-local",
    });
    expect(
      await current.findExact({ ...presetIdentity, version: "2.1.1" }),
    ).toBeUndefined();
    current.close();
  });

  it("初装 pending 无 previous 时显式 not-ready，恢复后才成为 ready", async () => {
    const databaseName = `pending-${crypto.randomUUID()}`;
    const opfs = new MemoryOpfsGateway();
    const lock = new MemoryRepositoryLockGateway();
    const current = repository(databaseName, opfs, lock);
    await expect(
      current.install(packageInput(1), {
        failureHook(step) {
          if (step === "after-database-commit") throw new Error("stop");
        },
      }),
    ).rejects.toMatchObject({ code: "local-package-finalize-failed" });
    await expect(current.findExact(IDENTITY)).rejects.toMatchObject({
      code: "local-package-not-ready",
    });
    expect(await current.list()).toEqual([]);
    expect(await current.listRegistrations()).toMatchObject([
      { status: "pending", reasonCode: "local-package-not-ready" },
    ]);
    await current.recover();
    expect(await current.listRegistrations()).toMatchObject([
      { status: "ready", reasonCode: null },
    ]);
    current.close();
  });

  it("finalize 失败可恢复；pending 缺文件与稳定 current 损坏均回退已验证 previous", async () => {
    const databaseName = `recover-${crypto.randomUUID()}`;
    const opfs = new MemoryOpfsGateway();
    const lock = new MemoryRepositoryLockGateway();
    const current = repository(databaseName, opfs, lock);
    await current.install(packageInput(1));
    opfs.failNextForTest({ operation: "markCommitted" });
    await expect(current.replace(packageInput(2))).rejects.toMatchObject({
      code: "local-package-finalize-failed",
    });
    expect(
      await readBytes(await current.openFile(IDENTITY, "module.json")),
    ).toEqual([1]);
    await current.recover();
    expect(
      await readBytes(await current.openFile(IDENTITY, "module.json")),
    ).toEqual([2]);

    await expect(
      current.replace(packageInput(3), {
        failureHook(step) {
          if (step === "after-database-commit") throw new Error("stop");
        },
      }),
    ).rejects.toMatchObject({ code: "local-package-finalize-failed" });
    const [pendingId] = await current.pendingCommitIdsForTest();
    expect(pendingId).toBeDefined();
    opfs.deleteFileForTest(pendingId ?? "", "file-000000");
    const rollback = await current.recover();
    expect(rollback.rolledBackCommitIds).toContain(pendingId);
    expect(
      await readBytes(await current.openFile(IDENTITY, "module.json")),
    ).toEqual([2]);
    const second = await current.recover();
    expect(second.completedCommitIds).toEqual([]);
    expect(second.rolledBackCommitIds).toEqual([]);

    await current.replace(packageInput(4));
    const corruptedCurrent = await current.currentCommitIdForTest(IDENTITY);
    expect(corruptedCurrent).toBeDefined();
    opfs.replaceFileForTest(corruptedCurrent ?? "", "file-000000", []);
    expect(await current.listRegistrations()).toMatchObject([
      { status: "corrupted", reasonCode: "local-package-storage-corrupted" },
    ]);
    await expect(current.findExact(IDENTITY)).rejects.toMatchObject({
      code: "local-package-storage-corrupted",
    });
    await current.recover();
    expect(
      await readBytes(await current.openFile(IDENTITY, "module.json")),
    ).toEqual([2]);

    await current.replace(packageInput(5));
    await current.deleteCurrentManifestForTest(IDENTITY);
    expect(await current.list()).toEqual([]);
    expect(await current.listRegistrations()).toMatchObject([
      { status: "corrupted", reasonCode: "local-package-storage-corrupted" },
    ]);
    await expect(current.findExact(IDENTITY)).rejects.toMatchObject({
      code: "local-package-storage-corrupted",
    });
    await current.recover();
    expect(
      await readBytes(await current.openFile(IDENTITY, "module.json")),
    ).toEqual([2]);
    current.close();
  });

  it("orphan 与删除 GC 失败可由后续 recover 幂等清理", async () => {
    const databaseName = `orphan-${crypto.randomUUID()}`;
    const opfs = new MemoryOpfsGateway();
    const lock = new MemoryRepositoryLockGateway();
    const current = repository(databaseName, opfs, lock);
    await current.install(packageInput(1));
    opfs.failNextForTest({ operation: "delete" });
    expect(await current.delete(IDENTITY)).toMatchObject({
      deleted: true,
      garbageCollectionPending: true,
    });
    const first = await current.recover();
    expect(first.deletedOrphanCommitIds).toHaveLength(1);

    const orphanId = "10000000-0000-4000-8000-000000000099";
    await opfs.createCommitExclusive(orphanId);
    await opfs.writeFile(orphanId, "file-000000", bytesSource(9), 1);
    opfs.failNextForTest({ operation: "delete" });
    const deferred = await current.recover();
    expect(deferred.issues).toContainEqual({
      code: "local-package-orphan-cleanup-failed",
      commitId: orphanId,
    });
    expect((await current.recover()).deletedOrphanCommitIds).toContain(
      orphanId,
    );
    expect((await current.recover()).deletedOrphanCommitIds).toEqual([]);
    current.close();
  });

  it("current 与 fallback manifest 全失时注册仍以 identity/source corrupted 可发现", async () => {
    const databaseName = `manifestless-${crypto.randomUUID()}`;
    const opfs = new MemoryOpfsGateway();
    const lock = new MemoryRepositoryLockGateway();
    const current = repository(databaseName, opfs, lock);
    await current.install(packageInput(1));
    await current.replace(packageInput(2));
    await current.deleteAllManifestsForTest(IDENTITY);
    expect(await current.list()).toEqual([]);
    expect(await current.listRegistrations()).toEqual([
      {
        identity: IDENTITY,
        sourceKind: "user-file",
        package: null,
        status: "corrupted",
        reasonCode: "local-package-storage-corrupted",
      },
    ]);
    const report = await current.recover();
    expect(report.rolledBackCommitIds).toHaveLength(1);
    expect(await current.listRegistrations()).toEqual([]);
    current.close();
  });

  it("manifest 全失的损坏注册仍可删除并清理 pointer 引用的 OPFS", async () => {
    const databaseName = `manifestless-delete-${crypto.randomUUID()}`;
    const opfs = new MemoryOpfsGateway();
    const lock = new MemoryRepositoryLockGateway();
    const current = repository(databaseName, opfs, lock);
    await current.install(packageInput(1));
    await current.replace(packageInput(2));
    await current.deleteAllManifestsForTest(IDENTITY);
    expect(await opfs.listCommitIds()).toHaveLength(2);

    expect(await current.delete(IDENTITY)).toEqual({
      deleted: true,
      garbageCollectionPending: false,
    });
    expect(await current.listRegistrations()).toEqual([]);
    expect(await opfs.listCommitIds()).toEqual([]);
    current.close();
  });

  it("find/open 的 OPFS 查询异常统一映射为稳定 query code", async () => {
    const databaseName = `opfs-query-${crypto.randomUUID()}`;
    const opfs = new MemoryOpfsGateway();
    const current = repository(
      databaseName,
      opfs,
      new MemoryRepositoryLockGateway(),
    );
    await current.install(packageInput(1));

    opfs.failNextForTest({ operation: "stat" });
    await expect(current.findExact(IDENTITY)).rejects.toMatchObject({
      code: "local-package-query-failed",
      message: "local-package-query-failed",
      details: { operation: "resolve" },
    });
    opfs.failNextForTest({ operation: "open" });
    await expect(
      current.openFile(IDENTITY, "module.json"),
    ).rejects.toMatchObject({
      code: "local-package-query-failed",
      details: { operation: "openFile" },
    });
    opfs.failNextForTest({ operation: "open" });
    await expect(current.openArchive(IDENTITY)).rejects.toMatchObject({
      code: "local-package-query-failed",
      details: { operation: "openArchive" },
    });
    current.close();
  });

  it("已占用 commitId 在 staging 前拒绝且旧字节不变", async () => {
    const databaseName = `collision-${crypto.randomUUID()}`;
    const opfs = new MemoryOpfsGateway();
    const lock = new MemoryRepositoryLockGateway();
    const first = repository(databaseName, opfs, lock);
    await first.install(packageInput(1));
    const occupied = await first.currentCommitIdForTest(IDENTITY);
    expect(occupied).toBeDefined();
    const second = repository(databaseName, opfs, lock, {
      uuidGenerator: () => occupied ?? "",
    });
    await expect(second.replace(packageInput(2))).rejects.toMatchObject({
      code: "local-package-input-invalid",
      details: { reason: "collision" },
    });
    expect(
      await readBytes(await first.openFile(IDENTITY, "module.json")),
    ).toEqual([1]);
    first.close();
    second.close();
  });

  it("共享锁串行化慢 install、recover 与同 identity replace，活跃 staging 不被删", async () => {
    const databaseName = `concurrent-${crypto.randomUUID()}`;
    const opfs = new MemoryOpfsGateway();
    const lock = new MemoryRepositoryLockGateway();
    const first = repository(databaseName, opfs, lock);
    const second = repository(databaseName, opfs, lock);
    let startedResolve = (): void => undefined;
    const started = new Promise<void>((resolve) => {
      startedResolve = resolve;
    });
    let releaseResolve = (): void => undefined;
    const release = new Promise<void>((resolve) => {
      releaseResolve = resolve;
    });
    const slowArchive = {
      async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
        yield new Uint8Array([80]);
        startedResolve();
        await release;
        yield new Uint8Array([75]);
      },
    };
    const install = first.install(
      packageInput(1, { archiveSource: slowArchive }),
    );
    await started;
    let recoveryFinished = false;
    const recovery = second.recover().then((result) => {
      recoveryFinished = true;
      return result;
    });
    const replacement = second.replace(packageInput(2));
    await Promise.resolve();
    await Promise.resolve();
    expect(recoveryFinished).toBe(false);
    releaseResolve();
    await install;
    await recovery;
    await replacement;
    expect(
      await readBytes(await first.openFile(IDENTITY, "module.json")),
    ).toEqual([2]);
    expect(await first.pendingCountForTest()).toBe(0);
    expect(await first.listRegistrations()).toMatchObject([
      { status: "ready" },
    ]);
    first.close();
    second.close();
  });

  it("无效路径、大小写/NFC 碰撞、严格时间与 OPFS 不可用均稳定拒绝", async () => {
    const databaseName = `invalid-${crypto.randomUUID()}`;
    const opfs = new MemoryOpfsGateway();
    const lock = new MemoryRepositoryLockGateway();
    const current = repository(databaseName, opfs, lock);
    await expect(
      current.install(
        packageInput(1, {
          files: [
            { path: "A.json", bytes: 1, source: bytesSource(1) },
            { path: "a.json", bytes: 1, source: bytesSource(2) },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "local-package-path-invalid" });
    await expect(
      current.install(
        packageInput(1, {
          files: [{ path: "a/../b", bytes: 1, source: bytesSource(1) }],
        }),
      ),
    ).rejects.toMatchObject({ code: "local-package-path-invalid" });

    const invalidClock = repository(databaseName, opfs, lock, {
      now: () => "2026-02-30T00:00:00Z",
    });
    await expect(invalidClock.install(packageInput(1))).rejects.toMatchObject({
      code: "local-package-input-invalid",
      details: { field: "createdAt" },
    });
    opfs.setAvailableForTest(false);
    await expect(current.install(packageInput(1))).rejects.toMatchObject({
      code: "opfs-unavailable",
    });
    current.close();
    invalidClock.close();
  });

  it("ProjectRepository 与 LocalPackageRepository 共享 v3 时包故障不影响工程修订", async () => {
    const databaseName = `shared-${crypto.randomUUID()}`;
    const opfs = new MemoryOpfsGateway();
    const lock = new MemoryRepositoryLockGateway();
    const projects = new ProjectRepository(databaseName);
    const project = createProject({
      name: "共享数据库",
      grid: { type: "square", width: 4, height: 4, cellSize: 32 },
      style: {
        canvasBackground: "#09141DFF",
        defaultCellColor: "#14232DFF",
        gridColor: "#59656AFF",
        gridOpacity: 0.7,
        gridWidth: 1,
        defaultEdgeColor: "#59656AFF",
      },
    });
    await projects.save(project);
    const packages = repository(databaseName, opfs, lock);
    await packages.install(packageInput(1));
    await expect(
      packages.replace(packageInput(2), {
        failureHook(step) {
          if (step === "after-database-commit") throw new Error("stop");
        },
      }),
    ).rejects.toMatchObject({ code: "local-package-finalize-failed" });
    expect((await projects.loadLatest())?.name).toBe("共享数据库");
    expect(await projects.revisionCount(project.projectId)).toBe(1);
    await packages.recover();
    expect((await projects.loadLatest())?.name).toBe("共享数据库");
    packages.close();
    projects.close();
  });

  it("关闭数据库后的查询错误不泄漏 Dexie 原始异常", async () => {
    const current = repository(
      `query-${crypto.randomUUID()}`,
      new MemoryOpfsGateway(),
      new MemoryRepositoryLockGateway(),
    );
    current.close();
    await expect(current.listRegistrations()).rejects.toMatchObject({
      code: "local-package-query-failed",
      message: "local-package-query-failed",
      details: { operation: "listRegistrations" },
    });
  });
});
