import { describe, expect, it } from "vitest";
import {
  cellPolygon,
  cellCenter,
  type ProjectGrid,
  type VisibleCell,
} from "@tessera/core";
import {
  FootprintPlacementState,
  planFixedFootprint,
  type FixedFootprintPlacementPreset,
} from "./footprint-placement.js";

function cells(grid: ProjectGrid): VisibleCell[] {
  return Array.from({ length: grid.width * grid.height }, (_, index) => {
    const row = Math.floor(index / grid.width);
    const column = index % grid.width;
    return {
      row,
      column,
      cellId: `cell:${grid.type}:${row}:${column}`,
      center: cellCenter(grid, row, column),
      polygon: cellPolygon(grid, row, column),
    };
  });
}

const squareSingle: FixedFootprintPlacementPreset = {
  gridType: "square",
  offsets: [{ row: 0, column: 0 }],
};
const hexSeven: FixedFootprintPlacementPreset = {
  gridType: "hex-pointy",
  offsets: [
    { q: 0, r: 0 },
    { q: 1, r: 0 },
    { q: -1, r: 0 },
    { q: 0, r: 1 },
    { q: 0, r: -1 },
    { q: 1, r: -1 },
    { q: -1, r: 1 },
  ],
};

describe("固定对象 footprint", () => {
  it("方格单格预设只计算中心格", () => {
    const grid = {
      type: "square" as const,
      width: 10,
      height: 10,
      cellSize: 32,
    };
    expect(
      planFixedFootprint(grid, { row: 4, column: 6 }, squareSingle),
    ).toEqual({
      status: "committed",
      memberCellIds: ["cell:square:4:6"],
    });
  });

  it("尖顶六边形七格预设精确计算中心格和六个相邻格", () => {
    const grid = {
      type: "hex-pointy" as const,
      width: 10,
      height: 10,
      cellSize: 32,
    };
    const result = planFixedFootprint(grid, { row: 4, column: 4 }, hexSeven);
    expect(result.status).toBe("committed");
    expect(
      result.status === "committed" ? new Set(result.memberCellIds) : null,
    ).toEqual(
      new Set([
        "cell:hex-pointy:4:4",
        "cell:hex-pointy:4:5",
        "cell:hex-pointy:4:3",
        "cell:hex-pointy:5:4",
        "cell:hex-pointy:3:4",
        "cell:hex-pointy:3:3",
        "cell:hex-pointy:5:3",
      ]),
    );
  });

  it("七格预设任一成员越界时整次拒绝而不截断", () => {
    const grid = {
      type: "hex-pointy" as const,
      width: 5,
      height: 5,
      cellSize: 32,
    };
    expect(planFixedFootprint(grid, { row: 0, column: 0 }, hexSeven)).toEqual({
      status: "rejected",
      code: "footprint-out-of-bounds",
    });
  });

  it("按住拖动不改变 footprint，且只在结束时提交一次", () => {
    const grid = { type: "square" as const, width: 8, height: 8, cellSize: 32 };
    const visible = cells(grid);
    const state = new FootprintPlacementState();
    state.begin(7, grid, { row: 2, column: 3 }, squareSingle);
    expect(state.preview(visible).map((cell) => cell.cellId)).toEqual([
      "cell:square:2:3",
    ]);
    expect(state.move(7)).toBe(false);
    expect(state.preview(visible).map((cell) => cell.cellId)).toEqual([
      "cell:square:2:3",
    ]);
    expect(state.finish(7)).toEqual({
      status: "committed",
      memberCellIds: ["cell:square:2:3"],
    });
    expect(state.finish(7)).toEqual({ status: "ignored" });
  });

  it("固定预设计算量只取决于 offset 数量", () => {
    const huge = {
      type: "square" as const,
      width: 40_000,
      height: 40_000,
      cellSize: 32,
    };
    expect(
      planFixedFootprint(huge, { row: 39_999, column: 39_999 }, squareSingle),
    ).toEqual({
      status: "committed",
      memberCellIds: ["cell:square:39999:39999"],
    });
  });
});
