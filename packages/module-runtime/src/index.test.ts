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
});
