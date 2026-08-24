import basicLocale from "./locales/basic.zh-CN.json";
import blankPresetLocale from "./locales/blank-preset.zh-CN.json";
import { parseBuiltInPackageFileSet } from "./parser.js";
import type {
  ModuleElementDefinition,
  ModuleManifest,
  ParsedModulePackage,
  ParsedPresetPackage,
  PresetManifest,
} from "./types.js";

export const BASIC_LAYER_IDS = [
  "tessera.basic.cell-style",
  "tessera.basic.edge-style",
  "tessera.basic.placed-object",
  "tessera.basic.connection",
  "tessera.basic.annotation",
] as const;

const emptyAttributes = {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
} as const;

const source = {
  sourceId: "tessera.basic:source.core",
  rulesetId: "tessera.basic.rules.v1",
  contentVersion: "1.0.0",
  retrievedAt: "2026-08-21T00:00:00Z",
} as const;

export const BASIC_ELEMENTS: readonly ModuleElementDefinition[] = Object.freeze(
  [
    {
      elementId: "tessera.basic:cell.color",
      categoryId: "tessera.basic:category.cell",
      nameKey: { kind: "key", key: "element.cellColor.name" },
      descriptionKey: { kind: "key", key: "element.cellColor.description" },
      primitive: "cell-style",
      layerId: "tessera.basic.cell-style",
      anchors: ["cell"],
      supportedGrids: ["square", "hex-pointy"],
      defaultStyle: { fillColor: "#14232DFF", fillOpacity: 1 },
      attributeSchema: {
        type: "object",
        properties: {
          label: { type: "string", minLength: 0, maxLength: 256 },
        },
        required: [],
        additionalProperties: false,
      },
      occupancy: [],
      constraintIds: [],
      resourceIds: [],
      source,
    },
    {
      elementId: "tessera.basic:edge.style",
      categoryId: "tessera.basic:category.edge",
      nameKey: { kind: "key", key: "element.edgeStyle.name" },
      descriptionKey: { kind: "key", key: "element.edgeStyle.description" },
      primitive: "edge-style",
      layerId: "tessera.basic.edge-style",
      anchors: ["edge"],
      supportedGrids: ["square", "hex-pointy"],
      defaultStyle: {
        strokeColor: "#59656AFF",
        strokeOpacity: 1,
        strokeWidth: 2,
        lineCap: "round",
      },
      attributeSchema: emptyAttributes,
      occupancy: [],
      constraintIds: [],
      resourceIds: [],
      source,
    },
    {
      elementId: "tessera.basic:marker",
      categoryId: "tessera.basic:category.overlay",
      nameKey: { kind: "key", key: "element.marker.name" },
      descriptionKey: { kind: "key", key: "element.marker.description" },
      primitive: "marker",
      layerId: "tessera.basic.placed-object",
      anchors: ["cell", "edge", "map-point"],
      supportedGrids: ["square", "hex-pointy"],
      defaultStyle: {
        shape: "circle",
        color: "#E3614DFF",
        opacity: 1,
        displaySize: 18,
        rotation: 0,
      },
      attributeSchema: emptyAttributes,
      occupancy: [],
      constraintIds: [],
      resourceIds: [],
      source,
    },
    {
      elementId: "tessera.basic:text",
      categoryId: "tessera.basic:category.annotation",
      nameKey: { kind: "key", key: "element.text.name" },
      descriptionKey: { kind: "key", key: "element.text.description" },
      primitive: "text",
      layerId: "tessera.basic.annotation",
      anchors: ["cell", "edge", "map-point"],
      supportedGrids: ["square", "hex-pointy"],
      defaultStyle: {
        color: "#F4EFE4FF",
        opacity: 1,
        fontSize: 18,
        fontWeight: "normal",
        align: "center",
        rotation: 0,
      },
      attributeSchema: {
        type: "object",
        properties: {
          text: { type: "string", minLength: 0, maxLength: 256, default: "" },
        },
        required: ["text"],
        additionalProperties: false,
      },
      occupancy: [],
      constraintIds: [],
      resourceIds: [],
      source,
    },
    {
      elementId: "tessera.basic:connection.line",
      categoryId: "tessera.basic:category.connection",
      nameKey: { kind: "key", key: "element.connectionLine.name" },
      descriptionKey: {
        kind: "key",
        key: "element.connectionLine.description",
      },
      primitive: "connection",
      layerId: "tessera.basic.connection",
      anchors: ["cell-center", "edge", "map-point"],
      supportedGrids: ["square", "hex-pointy"],
      defaultStyle: {
        strokeColor: "#D9B866FF",
        strokeOpacity: 1,
        strokeWidth: 2,
        lineCap: "round",
        arrowStart: false,
        arrowEnd: false,
        arrowSize: 8,
      },
      attributeSchema: emptyAttributes,
      occupancy: [],
      constraintIds: [],
      resourceIds: [],
      source,
    },
    {
      elementId: "tessera.basic:connection.arrow",
      categoryId: "tessera.basic:category.connection",
      nameKey: { kind: "key", key: "element.connectionArrow.name" },
      descriptionKey: {
        kind: "key",
        key: "element.connectionArrow.description",
      },
      primitive: "connection",
      layerId: "tessera.basic.connection",
      anchors: ["cell-center", "edge", "map-point"],
      supportedGrids: ["square", "hex-pointy"],
      defaultStyle: {
        strokeColor: "#D9B866FF",
        strokeOpacity: 1,
        strokeWidth: 2,
        lineCap: "round",
        arrowStart: false,
        arrowEnd: true,
        arrowSize: 8,
      },
      attributeSchema: emptyAttributes,
      occupancy: [],
      constraintIds: [],
      resourceIds: [],
      source,
    },
  ],
);

export const BASIC_MODULE_MANIFEST: ModuleManifest = {
  formatVersion: "1",
  kind: "module",
  moduleId: "tessera.basic",
  version: "1.0.0",
  nameKey: { kind: "key", key: "module.name" },
  descriptionKey: { kind: "key", key: "module.description" },
  authors: ["Tessera Studio"],
  appVersion: { min: "0.1.0" },
  supportedGrids: ["square", "hex-pointy"],
  dependencies: [],
  layers: [
    {
      layerId: "tessera.basic.cell-style",
      nameKey: { kind: "key", key: "layer.cellStyle" },
      zIndex: 500,
      allowedPrimitives: ["cell-style"],
      allowedAnchors: ["cell"],
      defaultVisible: true,
      defaultLocked: false,
      defaultOpacity: 1,
      extensions: {},
    },
    {
      layerId: "tessera.basic.edge-style",
      nameKey: { kind: "key", key: "layer.edgeStyle" },
      zIndex: 1500,
      allowedPrimitives: ["edge-style"],
      allowedAnchors: ["edge"],
      defaultVisible: true,
      defaultLocked: false,
      defaultOpacity: 1,
      extensions: {},
    },
    {
      layerId: "tessera.basic.placed-object",
      nameKey: { kind: "key", key: "layer.placedObject" },
      zIndex: 3000,
      allowedPrimitives: ["marker"],
      allowedAnchors: ["cell", "edge", "map-point"],
      defaultVisible: true,
      defaultLocked: false,
      defaultOpacity: 1,
      extensions: {},
    },
    {
      layerId: "tessera.basic.connection",
      nameKey: { kind: "key", key: "layer.connection" },
      zIndex: 4300,
      allowedPrimitives: ["connection"],
      allowedAnchors: ["cell-center", "edge", "map-point"],
      defaultVisible: true,
      defaultLocked: false,
      defaultOpacity: 1,
      extensions: {},
    },
    {
      layerId: "tessera.basic.annotation",
      nameKey: { kind: "key", key: "layer.annotation" },
      zIndex: 4400,
      allowedPrimitives: ["text"],
      allowedAnchors: ["cell", "edge", "map-point"],
      defaultVisible: true,
      defaultLocked: false,
      defaultOpacity: 1,
      extensions: {},
    },
  ],
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
    "connection",
  ],
  packageSource: { kind: "built-in" },
  extensions: {},
};

export const BLANK_PRESET_MANIFEST: PresetManifest = {
  formatVersion: "1",
  kind: "preset",
  presetId: "tessera.preset.blank",
  version: "1.0.0",
  nameKey: { kind: "key", key: "preset.name" },
  descriptionKey: { kind: "key", key: "preset.description" },
  authors: ["Tessera Studio"],
  appVersion: { min: "0.1.0" },
  modules: [
    {
      moduleId: "tessera.basic",
      versionRange: "^1.0.0",
      required: true,
      extensions: {},
    },
  ],
  grid: {
    supportedGrids: ["square", "hex-pointy"],
    defaultGrid: "square",
    minWidth: 1,
    maxWidth: 40000,
    minHeight: 1,
    maxHeight: 40000,
    cellSize: 32,
    mapStyle: {},
    extensions: {},
  },
  layerStates: BASIC_MODULE_MANIFEST.layers.map((layer) => ({
    layerId: layer.layerId,
    visible: layer.defaultVisible,
    locked: layer.defaultLocked,
    opacity: layer.defaultOpacity,
    extensions: {},
  })),
  panelLayout: {
    openCategories: ["tessera.basic:category.cell"],
    extensions: {},
  },
  defaultLanguage: "zh-CN",
  locales: { "zh-CN": "locales/zh-CN.json" },
  packageSource: { kind: "built-in" },
  extensions: {},
};

const encoder = new TextEncoder();
const jsonBytes = (value: unknown) => encoder.encode(JSON.stringify(value));

export const BASIC_MODULE_PACKAGE: ParsedModulePackage =
  parseBuiltInPackageFileSet({
    origin: "built-in",
    files: [
      { path: "module.json", bytes: jsonBytes(BASIC_MODULE_MANIFEST) },
      { path: "elements/basic.json", bytes: jsonBytes(BASIC_ELEMENTS) },
      { path: "locales/zh-CN.json", bytes: jsonBytes(basicLocale) },
    ],
  }) as ParsedModulePackage;

export const BLANK_PRESET_PACKAGE: ParsedPresetPackage =
  parseBuiltInPackageFileSet({
    origin: "built-in",
    files: [
      { path: "preset.json", bytes: jsonBytes(BLANK_PRESET_MANIFEST) },
      { path: "locales/zh-CN.json", bytes: jsonBytes(blankPresetLocale) },
    ],
  }) as ParsedPresetPackage;

export function validateBuiltInBasicModule(): boolean {
  return (
    Object.isFrozen(BASIC_MODULE_PACKAGE) &&
    Object.isFrozen(BASIC_MODULE_PACKAGE.manifest) &&
    BASIC_MODULE_PACKAGE.artifactId === "tessera.basic" &&
    BLANK_PRESET_PACKAGE.artifactId === "tessera.preset.blank"
  );
}
