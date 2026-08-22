import {
  createProject,
  edgeIdentity,
  EditorStore,
  TESSERA_APP_VERSION,
} from "@tessera/core";
import {
  createPartialProjectV1,
  parseProjectV1,
  restoreProjectV1,
  stringifyProjectV1,
  toProjectV1,
  type ProjectV1Document,
  type FragmentModuleResolver,
} from "@tessera/formats";
import Dexie from "dexie";
import { describe, expect, it, vi } from "vitest";
import { ProjectRecoveryError, ProjectRepository } from "./index.js";

describe("ProjectRepository", () => {
  it("恢复错误提供稳定 code 与结构化 details", () => {
    const error = new ProjectRecoveryError("project-1", 3);
    expect(error).toMatchObject({
      code: "project-recovery-no-valid-revision",
      message: "project-recovery-no-valid-revision",
      details: { projectId: "project-1", candidateCount: 3 },
      issues: [],
    });
  });

  it("新仓库恢复时继续使用精确模块 resolver 启用外部图层", async () => {
    const databaseName = `resolver-${crypto.randomUUID()}`;
    const document = structuredClone(
      toProjectV1(
        createProject({
          name: "外部模块恢复",
          grid: { type: "square", width: 4, height: 4, cellSize: 32 },
          style: {
            canvasBackground: "#09141DFF",
            defaultCellColor: "#14232DFF",
            gridColor: "#59656AFF",
            gridOpacity: 0.7,
            gridWidth: 1,
            defaultEdgeColor: "#59656AFF",
          },
        }),
      ),
    ) as ProjectV1Document;
    document.modules = [
      {
        moduleId: "example.weather",
        version: "1.0.0",
        packageSourceKind: "user-file",
        extensions: {},
      },
      ...document.modules,
    ];
    document.layerStates = [
      ...document.layerStates,
      {
        layerId: "example.weather.surface",
        moduleVersion: "1.0.0",
        zIndex: 2500,
        visible: true,
        locked: false,
        opacity: 1,
        extensions: {},
      },
    ].sort(
      (left, right) =>
        left.zIndex - right.zIndex || left.layerId.localeCompare(right.layerId),
    );
    const resolver: FragmentModuleResolver = {
      resolve(request) {
        return request.moduleId === "example.weather" &&
          request.version === "1.0.0"
          ? {
              moduleId: request.moduleId,
              version: request.version,
              appVersionSupported: true,
              supportedGrids: ["square"],
              layers: [
                {
                  layerId: "example.weather.surface",
                  zIndex: 2500,
                  allowedPrimitives: ["cell"],
                  allowedAnchors: ["cell"],
                },
              ],
              elements: [],
            }
          : undefined;
      },
    };
    const options = () => ({
      moduleResolver: resolver,
      currentAppVersion: TESSERA_APP_VERSION,
      moduleResolutionMode: "tolerant" as const,
    });
    const first = new ProjectRepository(databaseName);
    first.setModuleResolutionProvider(options);
    await first.save(
      restoreProjectV1(JSON.stringify(document), {
        ...options(),
        moduleResolutionMode: "strict",
      }),
    );
    first.close();

    const restarted = new ProjectRepository(databaseName);
    restarted.setModuleResolutionProvider(options);
    expect(
      (await restarted.loadLatest())?.layers.get("example.weather.surface"),
    ).toMatchObject({ allowedKinds: ["cell"] });
    restarted.close();
  });
  it("保存并恢复最新工程", async () => {
    const repository = new ProjectRepository(`test-${crypto.randomUUID()}`);
    const project = createProject({
      name: "本地恢复",
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
    await repository.save(project);
    expect((await repository.loadLatest())?.name).toBe("本地恢复");
    const store = new EditorStore(project);
    store.paintCell(1, 1, "#E3614DFF");
    await repository.save(store.state);
    expect(await repository.revisionCount(project.projectId)).toBe(2);
    repository.failNextSaveForTest();
    store.paintCell(2, 2, "#D9B866FF");
    await expect(repository.save(store.state)).rejects.toThrow(
      "injected-save-failure",
    );
    expect((await repository.loadLatest())?.cells.size).toBe(1);
    repository.close();
  });

  it("冻结时钟下全局激活时间仍严格单调，旧文档后保存也成为 latest", async () => {
    const repository = new ProjectRepository(`active-${crypto.randomUUID()}`);
    const makeProject = (name: string, updatedAt: string) => ({
      ...createProject({
        name,
        grid: { type: "square" as const, width: 2, height: 2, cellSize: 24 },
        style: {
          canvasBackground: "#09141DFF",
          defaultCellColor: "#14232DFF",
          gridColor: "#59656AFF",
          gridOpacity: 0.7,
          gridWidth: 1,
          defaultEdgeColor: "#59656AFF",
        },
      }),
      updatedAt,
    });
    const now = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    try {
      await repository.save(
        makeProject("较新的文档", "2030-01-01T00:00:00.000Z"),
      );
      await repository.save(
        makeProject("后载入的旧文档", "2000-01-01T00:00:00.000Z"),
      );
      expect((await repository.loadLatest())?.name).toBe("后载入的旧文档");
    } finally {
      now.mockRestore();
      repository.close();
    }
  });

  it("内部恢复与 preserve 保存不会反复改写 partial 身份", async () => {
    const repository = new ProjectRepository(`partial-${crypto.randomUUID()}`);
    const store = new EditorStore(
      createProject({
        name: "部分工程恢复",
        grid: { type: "square", width: 4, height: 4, cellSize: 32 },
        style: {
          canvasBackground: "#09141DFF",
          defaultCellColor: "#14232DFF",
          gridColor: "#59656AFF",
          gridOpacity: 0.7,
          gridWidth: 1,
          defaultEdgeColor: "#59656AFF",
        },
      }),
    );
    store.paintCell(0, 0, "#E3614DFF");
    const partial = createPartialProjectV1(toProjectV1(store.state), {
      bounds: { minX: 0, minY: 0, maxX: 32, maxY: 32 },
      includedLayerIds: ["tessera.basic.cell-style"],
    });
    await repository.saveDocument(partial, "partial-import");
    const restored = await repository.loadLatest();
    expect(restored).not.toBeNull();
    expect(restored?.projectId).toBe(partial.projectId);
    expect(restored?.formatSource).toMatchObject({
      exportScope: "partial",
      isComplete: false,
    });
    if (restored === null) throw new Error("partial-restore-missing");
    await repository.save(restored);
    const restoredAgain = await repository.loadLatest();
    expect(restoredAgain?.projectId).toBe(partial.projectId);
    expect(restoredAgain?.formatSource.exportScope).toBe("partial");
    repository.close();
  });

  it.each(["missing", "corrupted"] as const)(
    "当前指针 %s 时回退并修复到上一个有效修订",
    async (failure) => {
      const repository = new ProjectRepository(`test-${crypto.randomUUID()}`);
      const project = createProject({
        name: "恢复测试",
        grid: { type: "hex-pointy", width: 8, height: 8, cellSize: 32 },
        style: {
          canvasBackground: "#09141DFF",
          defaultCellColor: "#14232DFF",
          gridColor: "#59656AFF",
          gridOpacity: 0.7,
          gridWidth: 1,
          defaultEdgeColor: "#59656AFF",
        },
      });
      await repository.save(project);
      const store = new EditorStore(project);
      store.paintCell(1, 1, "#E3614DFF");
      await repository.save(store.state);
      if (failure === "missing")
        await repository.deleteCurrentRevisionForTest(project.projectId);
      else await repository.corruptCurrentRevisionForTest(project.projectId);
      expect((await repository.loadLatest())?.cells.size).toBe(0);
      expect((await repository.loadLatest())?.cells.size).toBe(0);
      repository.close();
    },
  );

  it("多工程回退损坏修订时保留当前工程活跃顺序", async () => {
    const repository = new ProjectRepository(`fallback-${crypto.randomUUID()}`);
    const makeStore = (name: string) =>
      new EditorStore(
        createProject({
          name,
          grid: { type: "square", width: 4, height: 4, cellSize: 24 },
          style: {
            canvasBackground: "#09141DFF",
            defaultCellColor: "#14232DFF",
            gridColor: "#59656AFF",
            gridOpacity: 0.7,
            gridWidth: 1,
            defaultEdgeColor: "#59656AFF",
          },
        }),
      );
    const secondNewest = makeStore("工程 B");
    const latest = makeStore("工程 A");
    await repository.save(secondNewest.state);
    await repository.save(latest.state);
    latest.paintCell(0, 0, "#E3614DFF");
    await repository.save(latest.state);
    await repository.corruptCurrentRevisionForTest(latest.state.projectId);

    expect((await repository.loadLatest())?.name).toBe("工程 A");
    expect((await repository.loadLatest())?.name).toBe("工程 A");
    repository.close();
  });

  it("当前工程指针丢失时从不可变修订恢复", async () => {
    const repository = new ProjectRepository(`test-${crypto.randomUUID()}`);
    const project = createProject({
      name: "无指针恢复",
      grid: { type: "square", width: 2, height: 2, cellSize: 24 },
      style: {
        canvasBackground: "#09141DFF",
        defaultCellColor: "#14232DFF",
        gridColor: "#59656AFF",
        gridOpacity: 0.7,
        gridWidth: 1,
        defaultEdgeColor: "#59656AFF",
      },
    });
    await repository.save(project);
    await repository.deletePointerForTest(project.projectId);
    expect((await repository.loadLatest())?.name).toBe("无指针恢复");
    expect(await repository.hasPointerForTest(project.projectId)).toBe(true);
    expect((await repository.loadLatest())?.name).toBe("无指针恢复");
    repository.close();
  });

  it("SAVE-009 跨 Manager 使用同 transactionId 原子保存并可恢复", async () => {
    const repository = new ProjectRepository(`test-${crypto.randomUUID()}`);
    const state = createProject({
      name: "跨 Manager",
      grid: { type: "square", width: 128, height: 128, cellSize: 32 },
      style: {
        canvasBackground: "#09141DFF",
        defaultCellColor: "#14232DFF",
        gridColor: "#59656AFF",
        gridOpacity: 0.7,
        gridWidth: 1,
        defaultEdgeColor: "#59656AFF",
      },
    });
    const store = new EditorStore(state);
    const identity = edgeIdentity(state.grid, { row: 70, column: 70 }, 1);
    state.cells.touchRuntimeChunk(1, 1);
    store.placeEdgeMarker({
      instanceId: crypto.randomUUID(),
      ...identity,
      strokeColor: "#59656AFF",
      strokeWidth: 2,
      strokeOpacity: 1,
      lineStyle: "solid",
    });
    const transactionId = store.state.lastTransactionId;
    const saved = await repository.save(store.state);
    expect(saved.transactionId).toBe(transactionId);
    expect(
      await repository.latestRevisionTransactionIdForTest(state.projectId),
    ).toBe(transactionId);
    expect(state.cells.evictRuntimeChunks(0)).toEqual(["1:1"]);

    const restored = await repository.loadLatest();
    expect(restored?.edges.size).toBe(1);
    expect(restored?.overlays.size).toBe(1);
    expect(restored?.cells.bucketCount).toBe(1);

    repository.failNextSaveForTest();
    store.createConnection(
      { kind: "cell-center", cellId: "cell:square:70:70" },
      { kind: "cell-center", cellId: "cell:square:70:71" },
    );
    await expect(repository.save(store.state)).rejects.toThrow(
      "injected-save-failure",
    );
    expect((await repository.loadLatest())?.connections.size).toBe(0);
    repository.close();
  });

  it("保存期间的新编辑不被旧快照标记 clean", async () => {
    const repository = new ProjectRepository(`test-${crypto.randomUUID()}`);
    const state = createProject({
      name: "并发保存",
      grid: { type: "square", width: 256, height: 256, cellSize: 32 },
      style: {
        canvasBackground: "#09141DFF",
        defaultCellColor: "#14232DFF",
        gridColor: "#59656AFF",
        gridOpacity: 0.7,
        gridWidth: 1,
        defaultEdgeColor: "#59656AFF",
      },
    });
    const store = new EditorStore(state);
    store.paintCell(1, 1, "#E3614DFF");
    const oldTransactionId = store.state.lastTransactionId;
    const savePromise = repository.save(store.state);

    state.cells.touchRuntimeChunk(2, 2);
    store.paintCell(130, 130, "#D9B866FF");
    const newTransactionId = store.state.lastTransactionId;
    const saved = await savePromise;
    expect(saved.transactionId).toBe(oldTransactionId);
    expect(newTransactionId).not.toBe(oldTransactionId);
    expect((await repository.loadLatest())?.cells.size).toBe(1);
    expect(state.cells.evictRuntimeChunks(0)).not.toContain("2:2");

    const nextSaved = await repository.save(store.state);
    expect(nextSaved.transactionId).toBe(newTransactionId);
    expect(state.cells.evictRuntimeChunks(0)).toContain("2:2");
    expect((await repository.loadLatest())?.cells.size).toBe(2);
    repository.close();
  });

  it("两个 Repository 交错保存时存储修订单调且旧快照不清理后续编辑", async () => {
    const databaseName = `interleaved-${crypto.randomUUID()}`;
    const firstRepository = new ProjectRepository(databaseName);
    const secondRepository = new ProjectRepository(databaseName);
    const firstState = createProject({
      name: "交错保存",
      grid: { type: "square", width: 256, height: 256, cellSize: 32 },
      style: {
        canvasBackground: "#09141DFF",
        defaultCellColor: "#14232DFF",
        gridColor: "#59656AFF",
        gridOpacity: 0.7,
        gridWidth: 1,
        defaultEdgeColor: "#59656AFF",
      },
    });
    const staleState = parseProjectV1(stringifyProjectV1(firstState));
    const firstStore = new EditorStore(firstState);
    firstStore.paintCell(1, 1, "#E3614DFF");
    firstStore.paintCell(2, 2, "#D9B866FF");
    const firstSaved = await firstRepository.save(firstStore.state);
    expect(firstSaved.revision).toBe(0);
    expect((await firstRepository.loadLatest())?.cells.size).toBe(2);

    const staleStore = new EditorStore(staleState);
    staleStore.paintCell(3, 3, "#6AAE75FF");
    const staleTransactionId = staleStore.state.lastTransactionId;
    const staleSavePromise = secondRepository.save(staleStore.state);
    staleState.cells.touchRuntimeChunk(2, 2);
    staleStore.paintCell(130, 130, "#D9B866FF");
    const nextTransactionId = staleStore.state.lastTransactionId;
    const staleSaved = await staleSavePromise;

    expect(staleSaved).toMatchObject({
      revision: 1,
      transactionId: staleTransactionId,
    });
    expect(nextTransactionId).not.toBe(staleTransactionId);
    expect((await firstRepository.loadLatest())?.cells.size).toBe(1);
    expect(staleState.cells.evictRuntimeChunks(0)).not.toContain("2:2");

    const finalSaved = await secondRepository.save(staleStore.state);
    expect(finalSaved).toMatchObject({
      revision: 2,
      transactionId: nextTransactionId,
    });
    expect((await firstRepository.loadLatest())?.cells.size).toBe(2);
    expect(staleState.cells.evictRuntimeChunks(0)).toContain("2:2");
    firstRepository.close();
    secondRepository.close();
  });

  it("saveDocument 原子保存 Fragment 合并结果并保留 transactionId", async () => {
    const repository = new ProjectRepository(`test-${crypto.randomUUID()}`);
    const state = createProject({
      name: "Fragment 合并保存",
      grid: { type: "square", width: 8, height: 8, cellSize: 32 },
      style: {
        canvasBackground: "#09141DFF",
        defaultCellColor: "#14232DFF",
        gridColor: "#59656AFF",
        gridOpacity: 0.7,
        gridWidth: 1,
        defaultEdgeColor: "#59656AFF",
      },
    });
    const store = new EditorStore(state);
    store.paintCell(2, 2, "#E3614DFF");
    const document = toProjectV1(store.state) as ProjectV1Document;
    const saved = await repository.saveDocument(document, "fragment-merge-1");
    expect(saved).toMatchObject({
      revision: 0,
      transactionId: "fragment-merge-1",
    });
    expect(
      await repository.latestRevisionTransactionIdForTest(state.projectId),
    ).toBe("fragment-merge-1");
    expect((await repository.loadLatest())?.cells.size).toBe(1);
    repository.close();
  });

  it("指针修复写失败映射 project-load-failed 而非损坏修订", async () => {
    const repository = new ProjectRepository(`test-${crypto.randomUUID()}`);
    const project = createProject({
      name: "指针修复失败",
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
    await repository.save(project);
    const store = new EditorStore(project);
    store.paintCell(1, 1, "#E3614DFF");
    await repository.save(store.state);
    await repository.corruptCurrentRevisionForTest(project.projectId);
    repository.failNextPointerRepairForTest();
    await expect(repository.loadLatest()).rejects.toMatchObject({
      code: "project-load-failed",
      message: "project-load-failed",
      details: { operation: "loadLatest" },
    });
    repository.close();
  });

  it.each([1, 2] as const)(
    "Dexie v%s 工程数据前向升级到共享 v3 后仍可读取和追加修订",
    async (legacyVersion) => {
      const databaseName = `legacy-v${legacyVersion}-${crypto.randomUUID()}`;
      const project = createProject({
        name: `legacy-v${legacyVersion}`,
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
      const revisionId = `${project.projectId}:0:legacy`;
      const legacy = new Dexie(databaseName);
      legacy.version(1).stores({
        projects: "&projectId,updatedAt",
        revisions: "&revisionId,projectId,[projectId+revision],createdAt",
      });
      if (legacyVersion === 2) {
        legacy.version(2).stores({
          projects: "&projectId,updatedAt",
          revisions:
            "&revisionId,projectId,[projectId+revision],createdAt,transactionId",
        });
      }
      await legacy.table("revisions").add({
        revisionId,
        projectId: project.projectId,
        revision: 0,
        createdAt: project.createdAt,
        ...(legacyVersion === 1 ? {} : { transactionId: "legacy-tx" }),
        document: stringifyProjectV1(project),
      });
      await legacy.table("projects").add({
        projectId: project.projectId,
        currentRevisionId: revisionId,
        revision: 0,
        updatedAt: project.updatedAt,
      });
      legacy.close();

      const repository = new ProjectRepository(databaseName);
      const restored = await repository.loadLatest();
      expect(restored?.name).toBe(`legacy-v${legacyVersion}`);
      expect(await repository.revisionCount(project.projectId)).toBe(1);
      expect(
        await repository.latestRevisionTransactionIdForTest(project.projectId),
      ).toBe(legacyVersion === 1 ? undefined : "legacy-tx");
      if (restored === null) throw new Error("legacy-project-missing");
      const store = new EditorStore(restored);
      store.paintCell(1, 1, "#E3614DFF");
      await repository.save(store.state);
      expect(await repository.revisionCount(project.projectId)).toBe(2);
      expect((await repository.loadLatest())?.cells.size).toBe(1);
      repository.close();
    },
  );
});
