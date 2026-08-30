import { describe, expect, it, vi } from "vitest";
import { createProject, EditorStore, type ToolState } from "@tessera/core";
import {
  TesseraRenderer,
  type RendererInteraction,
} from "./tessera-renderer.js";

const input = {
  name: "瞬时高亮",
  grid: { type: "square" as const, width: 20, height: 20, cellSize: 32 },
  style: {
    canvasBackground: "#09141DFF",
    defaultCellColor: "#14232DFF",
    gridColor: "#59656AFF",
    gridOpacity: 0.7,
    gridWidth: 1,
    defaultEdgeColor: "#59656AFF",
  },
};

describe("TesseraRenderer 瞬时高亮", () => {
  it("工具切换只同步一次并在 React 下一帧前清掉旧预览", () => {
    const store = new EditorStore(createProject(input));
    let toolState: ToolState = {
      tool: "brush",
      phase: "ready",
      startPoint: null,
      previewPoint: null,
      startCellId: null,
    };
    const interaction = {
      getToolState: () => toolState,
    } as unknown as RendererInteraction;
    const renderer = new TesseraRenderer(
      document.createElement("div"),
      store.state,
      interaction,
      "地图",
    );

    expect(renderer.synchronizeToolState()).toBe(false);
    toolState = { ...toolState, tool: "connection", phase: "choosing-start" };
    expect(renderer.synchronizeToolState()).toBe(true);
    expect(renderer.synchronizeToolState()).toBe(false);
    expect(renderer.synchronizeToolState({ force: true })).toBe(true);
    renderer.destroy();
  });

  it("设置与清除只更新预览，销毁后不会重新激活", () => {
    const store = new EditorStore(createProject(input));
    store.paintCell(1, 1, "#FFFFFFFF");
    const revision = store.state.revision;
    const transactionId = store.state.lastTransactionId;
    const toolState: ToolState = {
      tool: "eraser",
      phase: "ready",
      startPoint: null,
      previewPoint: null,
      startCellId: null,
    };
    const getToolState = vi.fn(() => toolState);
    const interaction = { getToolState } as unknown as RendererInteraction;
    const renderer = new TesseraRenderer(
      document.createElement("div"),
      store.state,
      interaction,
      "地图",
    );

    renderer.setTransientHighlight({
      kind: "cell",
      id: "cell:square:1:1",
    });
    renderer.setTransientHighlight(null);

    expect(store.state.revision).toBe(revision);
    expect(store.state.lastTransactionId).toBe(transactionId);
    expect(getToolState).toHaveBeenCalledTimes(2);

    renderer.destroy();
    renderer.setTransientHighlight({
      kind: "cell",
      id: "cell:square:1:1",
    });
    expect(getToolState).toHaveBeenCalledTimes(2);
  });
});
