import { describe, expect, it } from "vitest";

import {
  EditorStore,
  createProject,
  normalizeRotationDegrees,
} from "./index.js";

function createStore(): EditorStore {
  return new EditorStore(
    createProject({
      name: "旋转测试",
      grid: { type: "square", width: 8, height: 8, cellSize: 32 },
      style: {
        canvasBackground: "#101820FF",
        defaultCellColor: "#223344FF",
        gridColor: "#FFFFFFFF",
        gridOpacity: 1,
        gridWidth: 1,
        defaultEdgeColor: "#FFFFFFFF",
      },
    }),
  );
}

describe("模型旋转角", () => {
  it("统一规范化为 [0, 360) 的度数", () => {
    expect(normalizeRotationDegrees(450)).toBe(90);
    expect(normalizeRotationDegrees(-90)).toBe(270);
    expect(normalizeRotationDegrees(360)).toBe(0);
    expect(() => normalizeRotationDegrees(Number.NaN)).toThrow(
      "rotation-not-finite",
    );
  });

  it("放置和更新文字时都保存规范化后的度数", () => {
    const store = createStore();
    const overlayId = store.placeText({ x: 64, y: 64 }, "文字", {
      rotation: 450,
    });
    const placed = store.state.overlays.get(overlayId);
    expect(placed?.style.rotation).toBe(90);
    if (placed === undefined || placed.overlayType !== "text") {
      throw new Error("overlay-missing");
    }
    store.updateOverlay(overlayId, {
      ...placed,
      style: { ...placed.style, rotation: -90 },
    });
    expect(store.state.overlays.get(overlayId)?.style.rotation).toBe(270);
  });
});
