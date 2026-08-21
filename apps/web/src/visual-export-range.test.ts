import { EditorStore, createProject } from "@tessera/core";
import { describe, expect, it } from "vitest";
import {
  VisualExportRangeSnapshotError,
  resolveVisualExportRangeSnapshot,
} from "./visual-export-range.js";

function store() {
  return new EditorStore(
    createProject({
      name: "导出范围",
      grid: { type: "square", width: 10, height: 8, cellSize: 20 },
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
}

describe("visual export range snapshot", () => {
  it("viewport、完成框选与 custom 均复用导出边界裁切规则", async () => {
    const current = store();
    const interaction = {
      viewportBounds: { minX: -10, minY: 5, maxX: 50, maxY: 70 },
      selectionBounds: { minX: 80, minY: 90, maxX: 30, maxY: 20 },
    };
    await expect(
      resolveVisualExportRangeSnapshot(
        current.state,
        { kind: "viewport" },
        interaction,
      ),
    ).resolves.toEqual({
      kind: "viewport",
      bounds: { minX: 0, minY: 5, maxX: 50, maxY: 70 },
    });
    await expect(
      resolveVisualExportRangeSnapshot(
        current.state,
        { kind: "custom", bounds: { minX: 10, minY: 10, maxX: 40, maxY: 50 } },
        interaction,
      ),
    ).resolves.toEqual({
      kind: "custom",
      bounds: { minX: 10, minY: 10, maxX: 40, maxY: 50 },
    });
    await expect(
      resolveVisualExportRangeSnapshot(
        current.state,
        { kind: "selection" },
        interaction,
      ),
    ).rejects.toMatchObject({ code: "visual-export-range-invalid" });
  });

  it("缺少最近完成框选、空内容与 full map 返回稳定结果", async () => {
    const current = store();
    const interaction = {
      viewportBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      selectionBounds: null,
    };
    await expect(
      resolveVisualExportRangeSnapshot(
        current.state,
        { kind: "selection" },
        interaction,
      ),
    ).rejects.toBeInstanceOf(VisualExportRangeSnapshotError);
    await expect(
      resolveVisualExportRangeSnapshot(
        current.state,
        { kind: "content-bounds" },
        interaction,
      ),
    ).rejects.toMatchObject({ code: "visual-export-content-empty" });
    await expect(
      resolveVisualExportRangeSnapshot(
        current.state,
        { kind: "full-map" },
        interaction,
      ),
    ).resolves.toEqual({
      kind: "full-map",
      bounds: { minX: 0, minY: 0, maxX: 200, maxY: 160 },
    });
  });
});
