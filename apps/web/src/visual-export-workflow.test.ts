import { createProject, EditorStore } from "@tessera/core";
import {
  captureVisualExportSnapshot,
  planVisualExport,
  resolveVisualExportBounds,
  VisualExportError,
  type VisualExportCanvasCapabilities,
  type VisualExportResult,
} from "@tessera/renderer/visual-export";
import { describe, expect, it, vi } from "vitest";
import {
  downloadVisualExportResult,
  startVisualExportWorkflow,
  visualExportErrorPresentation,
  type VisualExportWorkflowEngine,
} from "./visual-export-workflow.js";

function project() {
  return createProject({
    name: "图片/导出",
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

const interaction = {
  viewportBounds: { minX: 0, minY: 0, maxX: 48, maxY: 48 },
  selectionBounds: { minX: 0, minY: 0, maxX: 24, maxY: 24 },
};

describe("visual export workflow", () => {
  it("点击开始同步冻结 snapshot，后续编辑不进入 SVG", async () => {
    const store = new EditorStore(project());
    const session = startVisualExportWorkflow(store.state, {
      format: "svg",
      range: { kind: "viewport" },
      interaction,
      background: { kind: "transparent" },
      showGrid: false,
      scale: 1,
    });
    store.paintCell(0, 0, "#FF0000FF");
    const result = await session.result;
    expect(session.plan.snapshot.cells).toHaveLength(0);
    expect(await result.blob.text()).not.toContain("#FF0000");
  });

  it("使用实际检测能力规划，并把同一能力交给任务执行器", () => {
    const capabilities: VisualExportCanvasCapabilities = {
      maxWidth: 4096,
      maxHeight: 4096,
      maxPixels: 16_777_216,
      worker: false,
      offscreenCanvas2d: false,
      offscreenConvertToBlob: false,
    };
    const cancel = vi.fn();
    const start = vi.fn(() => ({
      taskId: "task-test",
      subscribeProgress: () => () => undefined,
      cancel,
      result: new Promise<VisualExportResult>(() => undefined),
    }));
    const engine: VisualExportWorkflowEngine = {
      captureVisualExportSnapshot,
      resolveVisualExportBounds,
      detectVisualExportCanvasCapabilities: () => capabilities,
      planVisualExport,
      startVisualExport: start,
    };
    const session = startVisualExportWorkflow(
      project(),
      {
        format: "png",
        range: { kind: "selection" },
        interaction,
        background: { kind: "color", color: "#11223344" },
        showGrid: true,
        scale: 4,
      },
      engine,
    );
    expect(session.capabilities).toBe(capabilities);
    expect(session.plan.request).toMatchObject({
      format: "png",
      scale: 4,
      showGrid: true,
      background: { kind: "color", color: "#11223344" },
      range: { kind: "selection", bounds: interaction.selectionBounds },
    });
    expect(start).toHaveBeenCalledWith(session.plan, { capabilities });
    session.cancel();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("下载始终释放 URL，并提供稳定错误行动", () => {
    const revokeObjectURL = vi.fn();
    const result: VisualExportResult = {
      format: "png",
      mimeType: "image/png",
      blob: new Blob(["png"], { type: "image/png" }),
      width: 1,
      height: 1,
      executionMode: "fallback",
    };
    expect(() =>
      downloadVisualExportResult(result, "图片/导出", {
        createObjectURL: () => "blob:visual",
        revokeObjectURL,
        click: (_url, filename) => {
          expect(filename).toBe("图片_导出.png");
          throw new Error("blocked");
        },
      }),
    ).toThrow("visual-export-download-failed");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:visual");
    expect(
      visualExportErrorPresentation(
        new VisualExportError(
          "visual-export-png-side-limit-exceeded",
          {},
          "reduce-scale",
        ),
      ),
    ).toMatchObject({
      messageKey: "error.visualExportCapacity",
      actionKey: "visualExport.action.reduceScale",
      action: "reduce-scale",
      cancelled: false,
    });
    expect(
      visualExportErrorPresentation(
        new VisualExportError("visual-export-background-color-invalid"),
      ),
    ).toMatchObject({
      messageKey: "error.visualExportBackground",
      actionKey: "visualExport.action.resetBackground",
      action: "reset-background",
    });
    expect(
      visualExportErrorPresentation(
        new VisualExportError("visual-export-canvas-context-unavailable"),
      ),
    ).toMatchObject({
      messageKey: "error.visualExportPngUnavailable",
      actionKey: "visualExport.action.switchSvg",
      action: "switch-svg",
    });
  });
});
