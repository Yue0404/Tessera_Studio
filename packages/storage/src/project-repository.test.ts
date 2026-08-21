import { createProject, EditorStore } from "@tessera/core";
import { describe, expect, it } from "vitest";
import { ProjectRepository } from "./index.js";

describe("ProjectRepository", () => {
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
});
