import { describe, expect, it } from "vitest";
import { cellCenter, cellPolygon, hitTestCell } from "@tessera/core";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampZoom,
  mapToScreen,
  screenToMap,
  strokeAlignmentOffsetMapUnits,
  zoomCameraAt,
} from "./camera-transform.js";

describe("camera transform", () => {
  it("限制 25%–400%，并拒绝非有限值", () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(clampZoom(8)).toBe(MAX_ZOOM);
    expect(() => clampZoom(Number.NaN)).toThrow("zoom-not-finite");
  });

  it("指针中心缩放前后保持同一地图坐标", () => {
    const anchor = { x: 417.25, y: 203.5 };
    const before = { x: -70, y: 35 };
    const mapPoint = screenToMap(anchor, before, 1);
    const next = zoomCameraAt(before, 1, 3.75, anchor);
    expect(screenToMap(anchor, next.camera, next.zoom)).toEqual(mapPoint);
    expect(mapToScreen(mapPoint, next.camera, next.zoom)).toEqual(anchor);
  });

  it("按缩放与DPR计算半设备像素描边对齐量", () => {
    expect(strokeAlignmentOffsetMapUnits(1, 1)).toBe(0.5);
    expect(strokeAlignmentOffsetMapUnits(4, 2)).toBe(0.0625);
    expect(() => strokeAlignmentOffsetMapUnits(1, 0)).toThrow(
      "renderer-resolution-invalid",
    );
  });

  it.each(["square", "hex-pointy"] as const)(
    "%s 在所有倍率均命中同一地格",
    (type) => {
      const grid = { type, width: 20, height: 20, cellSize: 24 };
      const target = {
        row: 7,
        column: 8,
        cellId: `cell:${type}:7:8`,
        center: cellCenter(grid, 7, 8),
        polygon: cellPolygon(grid, 7, 8),
      };
      for (const zoom of [0.25, 1, 4]) {
        const camera = { x: 83, y: -41 };
        const screen = mapToScreen(target.center, camera, zoom);
        const point = screenToMap(screen, camera, zoom);
        expect(hitTestCell([target], point)?.cellId).toBe(target.cellId);
      }
    },
  );
});
