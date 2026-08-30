import { describe, expect, it } from "vitest";
import { cellCenter, cellPolygon, hitTestCell } from "@tessera/core";
import {
  MAX_ZOOM,
  MAX_ROTATION,
  MIN_ZOOM,
  MIN_ROTATION,
  applyCameraViewTransform,
  clampRotation,
  clampZoom,
  mapToScreen,
  rotateCameraAt,
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

  it("旋转限制在 -360°–360° 并拒绝非有限值", () => {
    expect(clampRotation(-720)).toBe(MIN_ROTATION);
    expect(clampRotation(720)).toBe(MAX_ROTATION);
    expect(clampRotation(12.5)).toBe(12.5);
    expect(() => clampRotation(Number.POSITIVE_INFINITY)).toThrow(
      "rotation-not-finite",
    );
  });

  it("指针中心缩放前后保持同一地图坐标", () => {
    const anchor = { x: 417.25, y: 203.5 };
    const before = { x: -70, y: 35 };
    const mapPoint = screenToMap(anchor, before, 1);
    const next = zoomCameraAt(before, 1, 3.75, anchor);
    expect(screenToMap(anchor, next.camera, next.zoom)).toEqual(mapPoint);
    expect(mapToScreen(mapPoint, next.camera, next.zoom)).toEqual(anchor);
  });

  it.each([0, 37.5, -120, 360, -360])(
    "%s° 下地图与屏幕坐标往返一致",
    (rotation) => {
      const mapPoint = { x: 83.25, y: -41.75 };
      const camera = { x: 417, y: 203 };
      const screen = mapToScreen(mapPoint, camera, 2.25, rotation);
      const roundTrip = screenToMap(screen, camera, 2.25, rotation);
      expect(roundTrip.x).toBeCloseTo(mapPoint.x, 10);
      expect(roundTrip.y).toBeCloseTo(mapPoint.y, 10);
    },
  );

  it("围绕屏幕锚点旋转时保持锚点地图坐标", () => {
    const anchor = { x: 650, y: 340 };
    const camera = { x: 80, y: -25 };
    const mapBefore = screenToMap(anchor, camera, 1.75, -30);
    const next = rotateCameraAt(camera, 1.75, -30, 127.5, anchor);
    const mapAfter = screenToMap(anchor, next.camera, 1.75, next.rotation);
    expect(mapAfter.x).toBeCloseTo(mapBefore.x, 10);
    expect(mapAfter.y).toBeCloseTo(mapBefore.y, 10);
  });

  it("内容层与地图坐标预览层可复用完全相同的 Pixi 变换", () => {
    const snapshots: {
      x?: number;
      y?: number;
      zoom?: number;
      rotation?: number;
    }[] = [{}, {}];
    const targets = snapshots.map((snapshot) => ({
      position: {
        set: (x: number, y: number) => Object.assign(snapshot, { x, y }),
      },
      scale: {
        set: (zoom: number) => Object.assign(snapshot, { zoom }),
      },
      get rotation() {
        return snapshot.rotation ?? 0;
      },
      set rotation(rotation: number) {
        snapshot.rotation = rotation;
      },
    }));
    for (const target of targets)
      applyCameraViewTransform(target, { x: 42, y: -17 }, 1.5, -45);
    expect(snapshots[0]).toEqual(snapshots[1]);
    expect(snapshots[0]).toMatchObject({ x: 42, y: -17, zoom: 1.5 });
    expect(snapshots[0]?.rotation).toBeCloseTo(-Math.PI / 4, 10);
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
      for (const zoom of [0.25, 1, 4])
        for (const rotation of [0, 45, -135, 360]) {
          const camera = { x: 83, y: -41 };
          const screen = mapToScreen(target.center, camera, zoom, rotation);
          const point = screenToMap(screen, camera, zoom, rotation);
          expect(hitTestCell([target], point)?.cellId).toBe(target.cellId);
        }
    },
  );
});
