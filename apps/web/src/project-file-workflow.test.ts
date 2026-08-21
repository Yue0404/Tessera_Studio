import { EditorStore, createProject } from "@tessera/core";
import {
  createPartialProjectV1,
  prepareExternalProjectV1,
  PROJECT_V1_MAX_FILE_BYTES,
  stringifyProjectDocumentV1,
  stringifyProjectV1,
  toProjectV1,
} from "@tessera/formats";
import { describe, expect, it, vi } from "vitest";
import {
  importProjectFile,
  type ProjectFileSource,
} from "./project-file-workflow.js";

function project(name = "当前工程") {
  return createProject({
    name,
    grid: { type: "square", width: 10, height: 10, cellSize: 32 },
    style: {
      canvasBackground: "#09141DFF",
      defaultCellColor: "#14232DFF",
      gridColor: "#59656AFF",
      gridOpacity: 0.7,
      gridWidth: 1,
      defaultEdgeColor: "#59656AFF",
    },
  });
}

function file(text: string): ProjectFileSource & { textCalls: number } {
  return {
    size: new TextEncoder().encode(text).byteLength,
    textCalls: 0,
    async text() {
      this.textCalls += 1;
      return text;
    },
  };
}

describe("project file workflow", () => {
  it("512 MiB 预检失败时绝不调用 File.text", async () => {
    const source = {
      size: PROJECT_V1_MAX_FILE_BYTES + 1,
      text: vi.fn(async () => "{}"),
    };
    await expect(
      importProjectFile({
        file: source,
        currentProjectId: null,
        repository: { save: vi.fn() },
      }),
    ).rejects.toMatchObject({
      code: "project-file-size-invalid",
    });
    expect(source.text).not.toHaveBeenCalled();
  });

  it("controller 只调用一次文本解析入口，并复用其已验证文档", async () => {
    const prepare = vi.fn((text: string) => prepareExternalProjectV1(text));
    const prepared = prepareExternalProjectV1(stringifyProjectV1(project()));
    const toState = vi.fn(prepared.toState);
    const save = vi.fn(async () => undefined);
    await importProjectFile(
      {
        file: file(stringifyProjectV1(project())),
        currentProjectId: null,
        repository: { save },
      },
      {
        prepareExternalProject(text) {
          prepare(text);
          return { metadata: prepared.metadata, toState };
        },
      },
    );
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(toState).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("保存前活性守卫失效时不触碰 repository", async () => {
    const save = vi.fn(async () => undefined);
    const result = await importProjectFile(
      {
        file: file(stringifyProjectV1(project())),
        currentProjectId: null,
        repository: { save },
      },
      { beforeSave: () => false },
    );
    expect(result).toEqual({ status: "cancelled" });
    expect(save).not.toHaveBeenCalled();
  });

  it("full 同 ID 默认生成副本，显式确认后才允许 replace", async () => {
    const current = new EditorStore(project());
    const source = file(stringifyProjectV1(current.state));
    const save = vi.fn(async () => undefined);
    const copied = await importProjectFile({
      file: source,
      currentProjectId: current.state.projectId,
      repository: { save },
    });
    expect(copied.status).toBe("loaded");
    if (copied.status !== "loaded") throw new Error("应载入副本");
    expect(copied.identity).toBe("copy");
    expect(copied.store.state.projectId).not.toBe(current.state.projectId);

    const replaced = await importProjectFile({
      file: source,
      currentProjectId: current.state.projectId,
      repository: { save },
      decideSameProjectId: async () => "replace" as const,
    });
    expect(replaced.status).toBe("loaded");
    if (replaced.status !== "loaded") throw new Error("应替换同 ID 工程");
    expect(replaced.identity).toBe("replace");
    expect(replaced.store.state.projectId).toBe(current.state.projectId);
  });

  it("partial 始终生成副本且不询问同 ID 决策", async () => {
    const current = new EditorStore(project());
    current.paintCell(0, 0, "#FF0000FF");
    const partial = createPartialProjectV1(toProjectV1(current.state), {
      bounds: { minX: 0, minY: 0, maxX: 32, maxY: 32 },
      includedLayerIds: ["tessera.basic.cell-style"],
    });
    const decide = vi.fn(async () => "replace" as const);
    const loaded = await importProjectFile({
      file: file(stringifyProjectDocumentV1(partial)),
      currentProjectId: current.state.projectId,
      repository: { save: vi.fn(async () => undefined) },
      decideSameProjectId: decide,
    });
    expect(loaded.status).toBe("loaded");
    if (loaded.status !== "loaded") throw new Error("应载入 partial 副本");
    expect(loaded.identity).toBe("copy");
    expect(loaded.store.state.projectId).not.toBe(current.state.projectId);
    expect(loaded.store.state.formatSource.exportScope).toBe("partial");
    expect(decide).not.toHaveBeenCalled();
  });

  it("取消、损坏文件和保存失败都不产生可替换当前工程的结果", async () => {
    const current = new EditorStore(project());
    const originalState = current.state;
    const save = vi.fn(async () => undefined);
    const cancelled = await importProjectFile({
      file: file(stringifyProjectV1(current.state)),
      currentProjectId: current.state.projectId,
      repository: { save },
      decideSameProjectId: async () => "cancel" as const,
    });
    expect(cancelled).toEqual({ status: "cancelled" });
    expect(save).not.toHaveBeenCalled();
    expect(current.state).toBe(originalState);

    await expect(
      importProjectFile({
        file: file("{broken"),
        currentProjectId: current.state.projectId,
        repository: { save },
      }),
    ).rejects.toMatchObject({ code: "project-file-invalid" });
    expect(current.state).toBe(originalState);

    await expect(
      importProjectFile({
        file: file(stringifyProjectV1(project("另一个工程"))),
        currentProjectId: current.state.projectId,
        repository: {
          save: vi.fn(async () => {
            throw new Error("disk-full");
          }),
        },
      }),
    ).rejects.toMatchObject({ code: "project-file-save-failed" });
    expect(current.state).toBe(originalState);
  });
});
