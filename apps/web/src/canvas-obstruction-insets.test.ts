import { describe, expect, it } from "vitest";
import { canvasObstructionInsets } from "./canvas-obstruction-insets.js";

const viewport = { x: 100, y: 50, width: 1000, height: 700 };
const left = {
  side: "left" as const,
  rect: { x: 112, y: 76, width: 316, height: 600 },
};
const right = {
  side: "right" as const,
  rect: { x: 724, y: 76, width: 304, height: 600 },
};

describe("画布遮挡边距", () => {
  it.each([
    ["两侧都关闭", [], { left: 0, right: 0 }],
    ["仅左侧打开", [left], { left: 328, right: 0 }],
    ["仅右侧打开", [right], { left: 0, right: 376 }],
    ["两侧都打开", [left, right], { left: 328, right: 376 }],
  ] as const)("%s", (_name, obstructions, expected) => {
    expect(canvasObstructionInsets(viewport, obstructions)).toMatchObject(
      expected,
    );
  });
});
