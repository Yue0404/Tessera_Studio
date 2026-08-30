import {
  cellPolygon,
  createProject,
  EditorStore,
  type MapRect,
  type ProjectGrid,
} from "@tessera/core";
import { describe, expect, it } from "vitest";
import {
  centerBoundsPlan,
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

  it.each([
    ["两侧都关闭", { left: 0, right: 0 }, 500],
    ["仅左侧打开", { left: 300, right: 0 }, 650],
    ["仅右侧打开", { left: 0, right: 200 }, 400],
    ["两侧都打开", { left: 300, right: 200 }, 550],
  ] as const)("居中在%s时使用剩余可用区域中心", (_name, sides, centerX) => {
    expect(
      centerBoundsPlan(
        { minX: 0, minY: 0, maxX: 100, maxY: 100 },
        1_000,
        800,
        1,
        { top: 0, bottom: 0, ...sides },
      ),
    ).toMatchObject({
      status: "applied",
      camera: { x: centerX - 50, y: 350 },
    });
  });

  it("旋转后居中仍把地图中心放到工具栏之间的有效中心", () => {
    expect(
      centerBoundsPlan(
        { minX: 0, minY: 0, maxX: 100, maxY: 100 },
        1_000,
        800,
        1,
        { top: 0, right: 200, bottom: 0, left: 300 },
        90,
      ),
    ).toMatchObject({
      status: "applied",
      camera: { x: 600, y: 350 },
    });
  });

  it("适应范围按旋转后包围盒尺寸计算并使用有效可视区域", () => {
    const plan = fitBoundsPlan(
      { minX: 0, minY: 0, maxX: 100, maxY: 50 },
      500,
      180,
      0,
      90,
      { top: 0, right: 100, bottom: 0, left: 100 },
    );
    expect(plan).toMatchObject({ status: "applied", zoom: 1.8 });
    if (plan.status !== "applied") throw new Error("旋转适应计划未应用");
    expect(plan.camera.x).toBeCloseTo(295, 10);
    expect(plan.camera.y).toBeCloseTo(0, 10);
  });
});
