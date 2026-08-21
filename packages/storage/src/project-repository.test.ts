import { createProject, edgeIdentity, EditorStore } from "@tessera/core";
import { describe, expect, it } from "vitest";
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
});
