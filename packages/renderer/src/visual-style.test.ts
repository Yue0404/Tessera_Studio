import { describe, expect, it } from "vitest";
import { arrowPolygon, arrowShaftSegment } from "./visual-style.js";

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
