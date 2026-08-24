import { describe, expect, it } from "vitest";
import { InteractionRangeState } from "./interaction-range-state.js";

describe("InteractionRangeState", () => {
  it("resize 与 pan 后返回准确 viewport，且调用方不能修改内部值", () => {
    const ranges = new InteractionRangeState();
    ranges.updateViewport({ x: -20, y: 15 }, 800, 600);
    const first = ranges.getViewportBounds();
    expect(first).toEqual({ minX: 20, minY: -15, maxX: 820, maxY: 585 });
    first.minX = 999;
    expect(ranges.getViewportBounds().minX).toBe(20);

    ranges.updateViewport({ x: 40, y: -10 }, 1024, 768);
    expect(ranges.getViewportBounds()).toEqual({
      minX: -40,
      minY: 10,
      maxX: 984,
      maxY: 778,
    });
  });

  it("只保存最近一次有效的已完成框选，不把退化拖拽写成范围", () => {
    const ranges = new InteractionRangeState();
    expect(ranges.getSelectionBounds()).toBeNull();
    expect(ranges.commitSelection({ x: 30, y: 40 }, { x: 10, y: 5 })).toEqual({
      minX: 10,
      minY: 5,
      maxX: 30,
      maxY: 40,
    });
    const copy = ranges.getSelectionBounds();
    if (copy === null) throw new Error("缺少已完成框选");
    copy.maxX = 500;
    expect(ranges.getSelectionBounds()?.maxX).toBe(30);
    expect(ranges.commitSelection({ x: 1, y: 1 }, { x: 1, y: 2 })).toBeNull();
    expect(ranges.getSelectionBounds()?.maxX).toBe(30);
  });

  it("缩放后返回地图坐标范围且不把屏幕尺寸误当地图尺寸", () => {
    const ranges = new InteractionRangeState();
    ranges.updateViewport({ x: -200, y: 100 }, 800, 600, 2);
    expect(ranges.getViewportBounds()).toEqual({
      minX: 100,
      minY: -50,
      maxX: 500,
      maxY: 250,
    });
    expect(() => ranges.updateViewport({ x: 0, y: 0 }, 10, 10, 0)).toThrow(
      "viewport-zoom-invalid",
    );
  });
});
