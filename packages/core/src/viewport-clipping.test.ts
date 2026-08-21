import { describe, expect, it } from "vitest";
import { clipSegmentToRect } from "./viewport-clipping.js";

const viewport = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

describe("线段—视口裁切", () => {
  it("两端在内时保持原端点", () => {
    expect(
      clipSegmentToRect({ x: 10, y: 10 }, { x: 90, y: 90 }, viewport),
    ).toEqual([
      { x: 10, y: 10 },
      { x: 90, y: 90 },
    ]);
  });

  it("起点在外时只裁切起点", () => {
    expect(
      clipSegmentToRect({ x: -50, y: 50 }, { x: 50, y: 50 }, viewport),
    ).toEqual([
      { x: 0, y: 50 },
      { x: 50, y: 50 },
    ]);
  });

  it("两端在外但穿过视口时返回可见段", () => {
    expect(
      clipSegmentToRect({ x: -20, y: 50 }, { x: 120, y: 50 }, viewport),
    ).toEqual([
      { x: 0, y: 50 },
      { x: 100, y: 50 },
    ]);
  });

  it("两端在外且不相交时返回 null", () => {
    expect(
      clipSegmentToRect({ x: -20, y: -10 }, { x: 120, y: -10 }, viewport),
    ).toBeNull();
  });
});
