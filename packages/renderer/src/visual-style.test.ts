import { describe, expect, it } from "vitest";
import {
  arrowPolygon,
  arrowShaftSegment,
  connectionLabelPoint,
} from "./visual-style.js";

describe("箭头线段几何", () => {
  it("按三角形底边同时截短双向箭杆", () => {
    const segment = arrowShaftSegment(
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      true,
      true,
      10,
    );
    expect(segment).toEqual([
      { x: 10, y: 0 },
      { x: 90, y: 0 },
    ]);
    expect(arrowPolygon({ x: 0, y: 0 }, { x: 100, y: 0 }, 10)).toEqual([
      { x: 100, y: 0 },
      { x: 90, y: 4.5 },
      { x: 90, y: -4.5 },
    ]);
  });

  it("短于两个箭头占用长度时不再绘制箭杆", () => {
    expect(
      arrowShaftSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, true, true, 10),
    ).toBeNull();
  });
});

describe("连线短标签几何", () => {
  it("水平线标签位于线体上方", () => {
    expect(
      connectionLabelPoint({ x: 0, y: 20 }, { x: 100, y: 20 }, 32, 4),
    ).toEqual({ x: 50, y: 12.96 });
  });

  it("竖直线无论端点方向都固定放在右侧", () => {
    const downward = connectionLabelPoint(
      { x: 20, y: 0 },
      { x: 20, y: 100 },
      32,
      4,
    );
    const upward = connectionLabelPoint(
      { x: 20, y: 100 },
      { x: 20, y: 0 },
      32,
      4,
    );
    expect(downward).toEqual({ x: 27.04, y: 50 });
    expect(upward).toEqual(downward);
  });

  it("斜线标签沿屏幕上方法向偏移且不落在线上", () => {
    const point = connectionLabelPoint(
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      32,
      4,
    );
    expect(point.x).toBeGreaterThan(50);
    expect(point.y).toBeLessThan(50);
    expect(point.x - point.y).toBeCloseTo(32 * 0.22 * Math.SQRT2);
  });
});
