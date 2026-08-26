import { describe, expect, it } from "vitest";
import { cellPolygon, cellCenter, type VisibleCell } from "@tessera/core";
import { FootprintPlacementState } from "./footprint-placement.js";

function squareCells(width: number, height: number): VisibleCell[] {
  const grid = { type: "square" as const, width, height, cellSize: 32 };
  return Array.from({ length: width * height }, (_, index) => {
    const row = Math.floor(index / width);
    const column = index % width;
    return {
      row,
      column,
      cellId: `cell:square:${row}:${column}`,
      center: cellCenter(grid, row, column),
      polygon: cellPolygon(grid, row, column),
    };
  });
}

function hexCells(width: number, height: number): VisibleCell[] {
  const grid = { type: "hex-pointy" as const, width, height, cellSize: 32 };
  return Array.from({ length: width * height }, (_, index) => {
    const row = Math.floor(index / width);
    const column = index % width;
    return {
      row,
      column,
      cellId: `cell:hex-pointy:${row}:${column}`,
      center: cellCenter(grid, row, column),
      polygon: cellPolygon(grid, row, column),
    };
  });
}

function requiredCell(
  cells: readonly VisibleCell[],
  index: number,
): VisibleCell {
  const cell = cells.at(index);
  if (cell === undefined) throw new Error(`test-cell-missing:${index}`);
  return cell;
}

describe("FootprintPlacementState", () => {
  it("单击提交一个地格，拖动提交连续的 2x3 footprint", () => {
    const cells = squareCells(10, 10);
    const state = new FootprintPlacementState();
    const start = requiredCell(cells, 11);
    const end = requiredCell(cells, 23);
    state.begin(1, start.center, start.cellId);
    expect(state.finish(1, start.center, start, cells)).toEqual({
      status: "committed",
      memberCellIds: ["cell:square:1:1"],
    });

    state.begin(2, start.center, start.cellId);
    expect(state.finish(2, end.center, end, cells)).toEqual({
      status: "committed",
      memberCellIds: [
        "cell:square:1:1",
        "cell:square:1:2",
        "cell:square:1:3",
        "cell:square:2:1",
        "cell:square:2:2",
        "cell:square:2:3",
      ],
    });
  });

  it("越界时复位，超大 footprint 在稀疏可见集合上限处拒绝", () => {
    const cells = squareCells(65, 65);
    const state = new FootprintPlacementState();
    const start = requiredCell(cells, 0);
    const end = requiredCell(cells, -1);
    state.begin(1, start.center, start.cellId);
    expect(state.finish(1, { x: -1, y: -1 }, undefined, cells)).toEqual({
      status: "rejected",
      code: "footprint-out-of-bounds",
    });
    expect(state.active).toBe(false);

    state.begin(2, start.center, start.cellId);
    expect(state.finish(2, end.center, end, cells)).toEqual({
      status: "rejected",
      code: "footprint-too-large",
    });
  });

  it("尖顶六边形拖动也提交一个连通的多格 footprint", () => {
    const cells = hexCells(8, 8);
    const state = new FootprintPlacementState();
    const start = requiredCell(cells, 9);
    const end = requiredCell(cells, 11);
    state.begin(1, start.center, start.cellId);
    expect(state.finish(1, end.center, end, cells)).toEqual({
      status: "committed",
      memberCellIds: [
        "cell:hex-pointy:1:1",
        "cell:hex-pointy:1:2",
        "cell:hex-pointy:1:3",
      ],
    });
  });
});
