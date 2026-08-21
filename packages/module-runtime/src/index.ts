import type { GridType } from "@tessera/core";

export type PackageAvailability =
  "enabled" | "available" | "missing" | "incompatible" | "corrupted";

export interface PackageChoice {
  moduleId: string;
  version: string;
  required: boolean;
  supportedGrids: readonly GridType[];
  appVersion: { min: string; maxExclusive?: string };
  status: PackageAvailability;
  nameKey: string;
  statusKey: string;
}

export const BASIC_MODULE: PackageChoice = {
  moduleId: "tessera.basic",
  version: "1.0.0",
  required: true,
  supportedGrids: ["square", "hex-pointy"],
  appVersion: { min: "0.1.0" },
  status: "enabled",
  nameKey: "package.basic.name",
  statusKey: "package.status.alwaysEnabled",
};

export const BASIC_LAYER_IDS = [
  "tessera.basic.cell-style",
  "tessera.basic.edge-style",
  "tessera.basic.placed-object",
  "tessera.basic.connection",
  "tessera.basic.annotation",
] as const;

/** 与 Module Format v1 对齐的内置基础模块清单；内置资源由应用包提供。 */
export const BASIC_MODULE_MANIFEST = {
  formatVersion: "1",
  kind: "module",
  moduleId: BASIC_MODULE.moduleId,
  version: BASIC_MODULE.version,
  nameKey: { key: "package.basic.name" },
  descriptionKey: { key: "package.basic.description" },
  authors: ["Tessera Studio"],
  appVersion: { min: "0.1.0" },
  supportedGrids: [...BASIC_MODULE.supportedGrids],
  dependencies: [],
  layers: BASIC_LAYER_IDS.map((layerId, index) => ({
    layerId,
    nameKey: { key: `layer.${layerId}` },
    zIndex: [500, 1500, 3000, 4300, 4400][index],
    extensions: {},
  })),
  elementFiles: ["elements/basic.json"],
  constraintFiles: [],
  migrationFiles: [],
  catalogManifestPath: null,
  defaultLanguage: "zh-CN",
  locales: { "zh-CN": "locales/zh-CN.json" },
  resources: [],
  capabilities: ["cell-style", "edge-style", "anchored-overlay", "connection"],
  packageSource: { kind: "built-in" },
  extensions: {},
} as const;

export function validateBuiltInBasicModule(): boolean {
  return (
    BASIC_MODULE_MANIFEST.formatVersion === "1" &&
    BASIC_MODULE_MANIFEST.moduleId === "tessera.basic" &&
    BASIC_MODULE_MANIFEST.version === "1.0.0" &&
    BASIC_MODULE_MANIFEST.migrationFiles.length === 0 &&
    BASIC_MODULE_MANIFEST.layers.map((layer) => layer.layerId).join("|") ===
      BASIC_LAYER_IDS.join("|")
  );
}

export const OPTIONAL_PACKAGE_PLACEHOLDERS: readonly PackageChoice[] = [
  {
    moduleId: "tessera.civ6",
    version: "1.0.0",
    required: false,
    supportedGrids: ["hex-pointy"],
    appVersion: { min: "0.1.0" },
    status: "missing",
    nameKey: "package.civ6.name",
    statusKey: "package.status.notInstalled",
  },
];

export function packageSupportsGrid(
  choice: PackageChoice,
  grid: GridType,
): boolean {
  return choice.supportedGrids.includes(grid);
}

/** M0 保留迁移车间入口，当前只产生零步计划。 */
export function createMigrationPlan(): {
  status: "not-required";
  steps: readonly never[];
} {
  return { status: "not-required", steps: [] };
}
