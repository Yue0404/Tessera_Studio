import { describe, expect, it } from "vitest";
import { connectionFeedbackTarget } from "./connection-interaction-feedback.js";

const bounds = { minX: 0, minY: 0, maxX: 96, maxY: 96 };
const cell = {
  row: 1,
  column: 2,
  cellId: "cell:square:1:2",
  center: { x: 80, y: 48 },
  polygon: [],
};

describe("连线目标反馈", () => {
  it("保留有效地格中心和边的真实命中身份", () => {
    expect(
      connectionFeedbackTarget(
        { x: 80, y: 48 },
        cell,
        { kind: "cell-center", cellId: cell.cellId },
        bounds,
      ),
    ).toMatchObject({ hit: "cell-center", row: 1, column: 2 });
    expect(
      connectionFeedbackTarget(
        { x: 95, y: 48 },
        cell,
        { kind: "edge-midpoint", edgeId: "edge:square:v:1:3" },
        bounds,
      ),
    ).toMatchObject({
      hit: "cell-edge",
      row: 1,
      column: 2,
      edgeId: "edge:square:v:1:3",
    });
  });

  it("区分地图内未命中与地图外无效位置", () => {
    expect(
      connectionFeedbackTarget({ x: 12, y: 12 }, undefined, null, bounds).hit,
    ).toBe("map-position");
    expect(
      connectionFeedbackTarget({ x: -1, y: 12 }, undefined, null, bounds).hit,
    ).toBe("outside-map");
  });
});
