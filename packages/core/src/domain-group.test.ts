import { describe, expect, it } from "vitest";
import { domainGroupGeometry } from "./domain-group.js";
import type { ProjectGrid } from "./types.js";

const square: ProjectGrid = {
  type: "square",
  width: 100,
  height: 100,
  cellSize: 32,
};
const hex: ProjectGrid = { ...square, type: "hex-pointy" };

describe("DomainGroup 几何契约", () => {
  it.each([
    [square, ["cell:square:1:1", "cell:square:1:2"], 6, { x: 64, y: 48 }],
    [
      hex,
      ["cell:hex-pointy:1:1", "cell:hex-pointy:1:2"],
      10,
      { x: 80 * Math.sqrt(3), y: 80 },
    ],
  ] as const)(
    "%s 网格以共享结构边连通并只返回外边界",
    (grid, cells, edges, expectedCenter) => {
      const geometry = domainGroupGeometry(grid, cells);
      expect(geometry.memberCellIds).toEqual(cells);
      expect(geometry.boundaryEdges).toHaveLength(edges);
      expect(geometry.center.x).toBeCloseTo(expectedCenter.x);
      expect(geometry.center.y).toBeCloseTo(expectedCenter.y);
    },
  );

  it("接受 2 与 64 个成员，拒绝 65 个成员和非连通集合", () => {
    expect(() =>
      domainGroupGeometry(square, ["cell:square:0:0", "cell:square:0:1"]),
    ).not.toThrow();
    expect(() =>
      domainGroupGeometry(
        square,
        Array.from({ length: 64 }, (_, column) => `cell:square:0:${column}`),
      ),
    ).not.toThrow();
    expect(() =>
      domainGroupGeometry(
        square,
        Array.from({ length: 65 }, (_, column) => `cell:square:0:${column}`),
      ),
    ).toThrow("domain-group-member-count-invalid");
    expect(() =>
      domainGroupGeometry(square, ["cell:square:0:0", "cell:square:9:9"]),
    ).toThrow("domain-group-members-disconnected");
  });
});
