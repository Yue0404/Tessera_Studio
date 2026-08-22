import { createProject, EditorStore } from "@tessera/core";
import {
  parseFragmentV1,
  restoreProjectV1,
  type ProjectV1Document,
} from "@tessera/formats";
import { describe, expect, it, vi } from "vitest";
import {
  createDataExportArtifact,
  downloadDataExportArtifact,
} from "./data-export-workflow.js";

function project() {
  return createProject({
    name: "导出/测试",
    grid: { type: "square", width: 4, height: 4, cellSize: 24 },
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

describe("data export workflow", () => {
  it("partial 来源导出 full 不修改编辑态，并保留隐藏图层与 lineage", async () => {
    const base = new EditorStore(project());
    base.paintCell(0, 0, "#AA0000FF");
    const partialArtifact = createDataExportArtifact(base.state, {
      kind: "partial-project",
      bounds: { minX: 0, minY: 0, maxX: 24, maxY: 24 },
      includedLayerIds: ["tessera.basic.cell-style"],
    });
    const partial = restoreProjectV1(await partialArtifact.blob.text());
    const partialStore = new EditorStore(partial);
    partialStore.setLayerState("tessera.basic.cell-style", { visible: false });
    const sourceBefore = structuredClone(partialStore.state.formatSource);

    const artifact = createDataExportArtifact(partialStore.state, {
      kind: "full-project",
    });
    const document = JSON.parse(
      await artifact.blob.text(),
    ) as ProjectV1Document;

    expect(document.exportScope).toBe("full");
    expect(document.isComplete).toBe(true);
    expect(document.lineage?.sourceProjectId).toBe(base.state.projectId);
    expect(
      document.layerStates.find(
        (layer) => layer.layerId === "tessera.basic.cell-style",
      )?.visible,
    ).toBe(false);
    expect(partialStore.state.formatSource).toEqual(sourceBefore);
    expect(artifact.filename).toBe("导出_测试.tessera-project.json");
  });

  it("partial 与 Fragment 使用指定范围和固定图层", async () => {
    const store = new EditorStore(project());
    store.paintCell(0, 0, "#AA0000FF");
    store.paintCell(3, 3, "#00AA00FF");
    const selection = {
      bounds: { minX: 0, minY: 0, maxX: 24, maxY: 24 },
      includedLayerIds: ["tessera.basic.cell-style"],
    };
    expect(() =>
      createDataExportArtifact(store.state, {
        kind: "partial-project",
        bounds: selection.bounds,
        includedLayerIds: [...store.state.layers.keys()].filter(
          (layerId) => layerId !== "tessera.system.grid",
        ),
      }),
    ).not.toThrow();
    const partial = JSON.parse(
      await createDataExportArtifact(store.state, {
        kind: "partial-project",
        ...selection,
      }).blob.text(),
    ) as ProjectV1Document;
    const fragment = parseFragmentV1(
      await createDataExportArtifact(store.state, {
        kind: "fragment",
        fragmentId: crypto.randomUUID(),
        ...selection,
      }).blob.text(),
    );
    expect(partial.lineage?.includedLayerIds).toEqual([
      "tessera.basic.cell-style",
    ]);
    expect(partial.chunks.flatMap((chunk) => chunk.cellOverrides)).toHaveLength(
      1,
    );
    expect(fragment.requiredLayerIds).toEqual(["tessera.basic.cell-style"]);
    expect(fragment.objects.cellOverrides).toHaveLength(1);
  });

  it("下载失败仍释放 Object URL", () => {
    const revokeObjectURL = vi.fn();
    expect(() =>
      downloadDataExportArtifact(
        createDataExportArtifact(project(), { kind: "full-project" }),
        {
          createObjectURL: () => "blob:test",
          revokeObjectURL,
          click: () => {
            throw new Error("blocked");
          },
        },
      ),
    ).toThrow("data-export-download-failed");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });

  it("下载成功释放 Object URL，URL 创建失败不产生待回收引用", () => {
    const revokeObjectURL = vi.fn();
    const artifact = createDataExportArtifact(project(), {
      kind: "full-project",
    });
    downloadDataExportArtifact(artifact, {
      createObjectURL: () => "blob:success",
      revokeObjectURL,
      click: vi.fn(),
    });
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:success");

    expect(() =>
      downloadDataExportArtifact(artifact, {
        createObjectURL: () => {
          throw new Error("allocation-failed");
        },
        revokeObjectURL,
        click: vi.fn(),
      }),
    ).toThrow("data-export-download-failed");
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });
});
