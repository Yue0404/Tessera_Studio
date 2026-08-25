import { describe, expect, it } from "vitest";
import {
  DOMAIN_GROUP_LAYOUT_EXTENSION_KEY,
  domainGroupExtensionsWithLayout,
  domainGroupGeometry,
  resolveDomainGroupLayout,
} from "./domain-group.js";
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

  it("接受 2 与 4096 个成员，拒绝 4097 个成员和非连通集合", () => {
    expect(() =>
      domainGroupGeometry(square, ["cell:square:0:0", "cell:square:0:1"]),
    ).not.toThrow();
    const startedAt = performance.now();
    const maximumGeometry = domainGroupGeometry(
      { ...square, width: 4097 },
      Array.from({ length: 4096 }, (_, column) => `cell:square:0:${column}`),
    );
    expect(maximumGeometry.memberCellIds).toHaveLength(4_096);
    expect(maximumGeometry.boundaryEdges).toHaveLength(8_194);
    // 给低性能 CI 留出充足余量，同时防止不慎退化成依赖地图理论面积的算法。
    expect(performance.now() - startedAt).toBeLessThan(5_000);
    expect(() =>
      domainGroupGeometry(
        { ...square, width: 4098 },
        Array.from({ length: 4097 }, (_, column) => `cell:square:0:${column}`),
      ),
    ).toThrow("domain-group-member-count-invalid");
    expect(() =>
      domainGroupGeometry(square, ["cell:square:0:0", "cell:square:9:9"]),
    ).toThrow("domain-group-members-disconnected");
  });

  it.each([
    [
      square,
      ["cell:square:1:1", "cell:square:1:2", "cell:square:2:2"],
      ["cell:square:6:7", "cell:square:6:8", "cell:square:7:8"],
      "row-column",
    ],
    [
      hex,
      ["cell:hex-pointy:1:1", "cell:hex-pointy:1:2", "cell:hex-pointy:2:1"],
      ["cell:hex-pointy:4:5", "cell:hex-pointy:4:6", "cell:hex-pointy:5:4"],
      "axial-q-r",
    ],
  ] as const)(
    "%s 平移仅重写锚点，relativeOffsets 保持不变",
    (grid, sourceMembers, translatedMembers, coordinateSystem) => {
      const sourceExtensions = domainGroupExtensionsWithLayout(
        grid,
        sourceMembers,
        { "vendor.example:opaque": { keep: true } },
      );
      const source = resolveDomainGroupLayout(
        grid,
        sourceMembers,
        sourceExtensions,
      );
      const translatedExtensions = domainGroupExtensionsWithLayout(
        grid,
        translatedMembers,
        { "vendor.example:opaque": { keep: true } },
      );
      const translated = resolveDomainGroupLayout(
        grid,
        translatedMembers,
        translatedExtensions,
      );

      expect(source.coordinateSystem).toBe(coordinateSystem);
      expect(translated.relativeOffsets).toEqual(source.relativeOffsets);
      expect(translated.anchorCellId).not.toBe(source.anchorCellId);
      expect(translatedExtensions["vendor.example:opaque"]).toEqual({
        keep: true,
      });
      expect(translatedExtensions[DOMAIN_GROUP_LAYOUT_EXTENSION_KEY]).toEqual(
        translated,
      );
    },
  );

  it("旧事实确定性推导锚点，显式 layout 与 memberCellIds 不一致时拒绝", () => {
    const members = ["cell:square:4:5", "cell:square:4:6"];
    const legacy = resolveDomainGroupLayout(square, members, {});
    expect(legacy.anchorCellId).toBe("cell:square:4:5");
    const extensions = domainGroupExtensionsWithLayout(square, members, {});
    const layout = extensions[DOMAIN_GROUP_LAYOUT_EXTENSION_KEY] as any;
    expect(() =>
      resolveDomainGroupLayout(square, members, {
        ...extensions,
        [DOMAIN_GROUP_LAYOUT_EXTENSION_KEY]: {
          ...layout,
          anchorCellId: "cell:square:5:5",
        },
      }),
    ).toThrow("domain-group-layout-members-mismatch");
  });
});
