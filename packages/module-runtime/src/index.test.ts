import { describe, expect, it } from "vitest";
import {
  BASIC_ELEMENTS,
  BASIC_LAYER_IDS,
  BASIC_MODULE_MANIFEST,
  BASIC_OPERATIONS,
  createMigrationPlan,
  validateBuiltInBasicModule,
} from "./index.js";

describe("内置基础模块", () => {
  it("使用精确版本和固定图层，并保留声明式迁移车间", () => {
    expect(validateBuiltInBasicModule()).toBe(true);
    expect(BASIC_MODULE_MANIFEST.version).toBe("1.0.0");
    expect(BASIC_MODULE_MANIFEST.layers.map((layer) => layer.layerId)).toEqual(
      BASIC_LAYER_IDS,
    );
    expect(BASIC_MODULE_MANIFEST.migrationFiles).toEqual([]);
    expect(createMigrationPlan()).toEqual({
      status: "not-required",
      steps: [],
    });
  });

  it("tessera.basic 声明全部 MVP 元素与操作", () => {
    expect(BASIC_ELEMENTS.map((element) => element.elementId)).toEqual([
      "tessera.basic:cell.color",
      "tessera.basic:edge.style",
      "tessera.basic:object",
      "tessera.basic:object.square",
      "tessera.basic:object.hex-cluster",
      "tessera.basic:marker",
      "tessera.basic:text",
      "tessera.basic:connection.line",
      "tessera.basic:connection.arrow",
    ]);
    expect(BASIC_OPERATIONS).toEqual(
      expect.arrayContaining([
        "select",
        "pan",
        "brush",
        "edge",
        "marker",
        "object",
        "connection",
        "box-select",
        "cell.paint",
        "cell.erase",
        "cell.fill",
        "edge.style",
        "overlay.text.create",
        "domain-object.create",
        "connection.line.create",
        "connection.arrow.create",
      ]),
    );
  });

  it("三个内置物体声明固定 footprint 与精确网格支持", () => {
    const byId = new Map(
      BASIC_ELEMENTS.map((element) => [element.elementId, element]),
    );
    for (const elementId of [
      "tessera.basic:object",
      "tessera.basic:object.square",
    ]) {
      expect(byId.get(elementId)?.supportedGrids).toEqual([
        "square",
        "hex-pointy",
      ]);
      expect(byId.get(elementId)?.group?.placementPreset).toEqual({
        square: [{ row: 0, column: 0 }],
        "hex-pointy": [{ q: 0, r: 0 }],
      });
    }
    expect(
      byId.get("tessera.basic:object.hex-cluster")?.supportedGrids,
    ).toEqual(["hex-pointy"]);
    expect(
      byId.get("tessera.basic:object.hex-cluster")?.defaultStyle,
    ).toMatchObject({
      representation: "cell-style",
      style: { fillColor: "#B66A4CCC", fillOpacity: 0.82 },
    });
    expect(
      byId.get("tessera.basic:object.hex-cluster")?.group?.placementPreset?.[
        "hex-pointy"
      ],
    ).toEqual([
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: -1, r: 0 },
      { q: 0, r: 1 },
      { q: 0, r: -1 },
      { q: 1, r: -1 },
      { q: -1, r: 1 },
    ]);
  });
});
