import {
  cellPolygon,
  createProject,
  EditorStore,
  type MapRect,
  type ProjectGrid,
} from "@tessera/core";
import { describe, expect, it } from "vitest";
import {
  fitBoundsPlan,
  gridMapBounds,
  projectContentBounds,
} from "./viewport-navigation.js";

const style = {
  canvasBackground: "#000000FF",
  defaultCellColor: "#111111FF",
  gridColor: "#222222FF",
  gridOpacity: 1,
  gridWidth: 1,
  defaultEdgeColor: "#222222FF",
};

function enumeratedGridBounds(grid: ProjectGrid): MapRect {
  const points = Array.from({ length: grid.height }, (_, row) =>
    Array.from({ length: grid.width }, (_, column) =>
      cellPolygon(grid, row, column),
    ),
  ).flat(2);
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

describe("视口导航", () => {
  it.each(["square", "hex-pointy"] as const)(
    "%s 地图边界由常数个角格精确计算",
    (type) => {
      const bounds = gridMapBounds({
        type,
        width: 40_000,
        height: 40_000,
        cellSize: 12,
      });
      expect(bounds.maxX).toBeGreaterThan(bounds.minX);
      expect(bounds.maxY).toBeGreaterThan(bounds.minY);
      expect(fitBoundsPlan(bounds, 1440, 900)).toMatchObject({
        status: "limited",
      });
    },
  );

  it("奇数高度点顶六边形边界与全部格多边形的合并边界一致", () => {
    const grid: ProjectGrid = {
      type: "hex-pointy",
      width: 2,
      height: 3,
      cellSize: 12,
    };
    const actual = gridMapBounds(grid);
    const expected = enumeratedGridBounds(grid);
    expect(actual.minX).toBeCloseTo(expected.minX, 12);
    expect(actual.minY).toBeCloseTo(expected.minY, 12);
    expect(actual.maxX).toBeCloseTo(expected.maxX, 12);
    expect(actual.maxY).toBeCloseTo(expected.maxY, 12);
  });

  it("内容范围只随稀疏对象变化并可正常适应", () => {
    const store = new EditorStore(
      createProject({
        name: "稀疏",
        grid: { type: "square", width: 40_000, height: 40_000, cellSize: 32 },
        style,
      }),
    );
    expect(projectContentBounds(store.state)).toBeNull();
    store.paintCell(3, 4, "#FFFFFFFF");
    const bounds = projectContentBounds(store.state);
    expect(bounds).toEqual({ minX: 128, minY: 96, maxX: 160, maxY: 128 });
    expect(fitBoundsPlan(bounds, 800, 600)).toMatchObject({
      status: "applied",
      zoom: 4,
    });
  });
});
