import { describe, expect, it } from "vitest";
import {
  BASIC_LAYER_IDS,
  BASIC_MODULE_MANIFEST,
  createMigrationPlan,
  validateBuiltInBasicModule,
} from "./index.js";

describe("内置基础模块", () => {
  it("使用精确版本和五个固定图层，并保留声明式迁移车间", () => {
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
});
