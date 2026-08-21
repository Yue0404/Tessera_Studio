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

export const BASIC_ELEMENTS = Object.freeze([
  {
    elementId: "tessera.basic:cell.color",
    layerId: "tessera.basic.cell-style",
    primitive: "cell-style",
    anchors: ["cell"],
  },
  {
    elementId: "tessera.basic:edge.style",
    layerId: "tessera.basic.edge-style",
    primitive: "edge-style",
    anchors: ["edge"],
  },
  {
    elementId: "tessera.basic:marker",
    layerId: "tessera.basic.placed-object",
    primitive: "overlay",
    anchors: ["cell", "edge", "map-point"],
  },
  {
    elementId: "tessera.basic:text",
    layerId: "tessera.basic.annotation",
    primitive: "overlay",
    anchors: ["cell", "edge", "map-point"],
  },
  {
    elementId: "tessera.basic:connection.line",
    layerId: "tessera.basic.connection",
    primitive: "connection",
    anchors: ["cell-center", "edge-midpoint", "map-point"],
  },
  {
    elementId: "tessera.basic:connection.arrow",
    layerId: "tessera.basic.connection",
    primitive: "connection",
    anchors: ["cell-center", "edge-midpoint", "map-point"],
  },
]);

export const BASIC_TOOL_IDS = Object.freeze([
  "select",
  "pan",
  "brush",
  "edge",
  "marker",
  "connection",
  "box-select",
]);

export const BASIC_OPERATIONS = Object.freeze([
  ...BASIC_TOOL_IDS,
  "cell.paint",
  "cell.erase",
  "cell.fill",
  "edge.style",
  "overlay.marker.create",
  "overlay.text.create",
  "overlay.update",
  "overlay.delete",
  "connection.line.create",
  "connection.arrow.create",
  "connection.update",
  "connection.delete",
]);

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
  capabilities: [
    "cell-style",
    "edge-style",
    "anchored-overlay",
    "free-overlay",
    "text",
    "marker",
    "connection",
    "arrow",
  ],
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
