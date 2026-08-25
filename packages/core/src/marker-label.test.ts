import { describe, expect, it } from "vitest";
import { createProject, EditorStore } from "./index.js";

const input = {
  name: "标记附文",
  grid: { type: "square" as const, width: 8, height: 8, cellSize: 32 },
  style: {
    canvasBackground: "#09141DFF",
    defaultCellColor: "#14232DFF",
    gridColor: "#59656AFF",
    gridOpacity: 0.7,
    gridWidth: 1,
    defaultEdgeColor: "#59656AFF",
  },
};

describe("基础标记附文", () => {
  it("放置、移动、编辑和删除始终作为同一个 Overlay 撤销重做", () => {
    const store = new EditorStore(createProject(input));
    const markerId = store.placeMarker(
      { x: 40, y: 50 },
      "#D9B866FF",
      "pin",
      "城市中心",
    );
    const placed = store.state.overlays.get(markerId);
    expect(placed).toMatchObject({
      overlayId: markerId,
      overlayType: "marker",
      label: "城市中心",
      point: { x: 40, y: 50 },
    });
    if (
      placed === undefined ||
      placed.overlayType !== "marker" ||
      placed.kind !== "free-overlay"
    )
      throw new Error("marker-missing");

    store.updateOverlay(markerId, {
      ...placed,
      point: { x: 80, y: 90 },
      label: "新城",
    });
    expect(store.state.overlays.get(markerId)).toMatchObject({
      overlayId: markerId,
      label: "新城",
      point: { x: 80, y: 90 },
    });
    store.undo();
    expect(store.state.overlays.get(markerId)).toEqual(placed);
    store.redo();
    expect(store.state.overlays.get(markerId)).toMatchObject({
      overlayId: markerId,
      label: "新城",
    });

    store.select([{ kind: "overlay", id: markerId }]);
    store.deleteSelection();
    expect(store.state.overlays.get(markerId)).toBeUndefined();
    store.undo();
    expect(store.state.overlays.get(markerId)).toMatchObject({ label: "新城" });
    store.redo();
    expect(store.state.overlays.get(markerId)).toBeUndefined();
  });

  it("附文变更会同步刷新空间索引，且沿用工程文字安全上限", () => {
    const store = new EditorStore(createProject(input));
    const markerId = store.placeMarker(
      { x: 32, y: 32 },
      undefined,
      undefined,
      "很长的附文",
    );
    expect(
      store.state.overlays.query({ minX: 0, minY: 40, maxX: 100, maxY: 70 }),
    ).toEqual([expect.objectContaining({ overlayId: markerId })]);
    const marker = store.state.overlays.get(markerId);
    if (marker === undefined || marker.overlayType !== "marker")
      throw new Error("marker-missing");
    expect(() =>
      store.updateOverlay(markerId, { ...marker, label: "字".repeat(257) }),
    ).toThrow("overlay-label-too-long");
  });
});
