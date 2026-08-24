import {
  MOD003_RESOURCE_PNG,
  MOD003_RESOURCE_WEBP,
  MOD003_RESOURCE_WOFF2,
} from "./mod003-resource-bytes.js";

export const MOD003_MODULE_VERSION = "1.0.0";
export const MOD003_MODULE_NAME = "风暴织图扩展";
export const MOD003_CATEGORY_NAME = "气象构件";

export function mod003ElementIds(moduleId: string) {
  return {
    cell: `${moduleId}:cell.rain`,
    connection: `${moduleId}:connection.flow`,
    domain: `${moduleId}:domain.storm`,
    edge: `${moduleId}:edge.front`,
    marker: `${moduleId}:marker.radar`,
    text: `${moduleId}:text.note`,
  } as const;
}

function attributeSchema(
  properties: Readonly<Record<string, unknown>> = {},
  required: readonly string[] = [],
) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  } as const;
}

/** 与 Civ6 无关的五种声明式 primitive 与领域对象，用于真实 ZIP、OPFS 与工程闭环验收。 */
export function mod003PackageFiles(
  moduleId: string,
): Readonly<Record<string, string | Uint8Array>> {
  const ids = mod003ElementIds(moduleId);
  const layerId = `${moduleId}.runtime`;
  const categoryId = `${moduleId}:category.weather`;
  const sourceId = `${moduleId}:source.e2e`;
  const source = {
    sourceId,
    rulesetId: `${moduleId}.rules.v1`,
    contentVersion: MOD003_MODULE_VERSION,
    retrievedAt: "2026-08-24T00:00:00.000Z",
  };
  const patternResourceId = `${moduleId}:image.pattern`;
  const markerResourceId = `${moduleId}:image.marker`;
  const fontResourceId = `${moduleId}:font.label`;
  const base = {
    categoryId,
    layerId,
    supportedGrids: ["square"],
    occupancy: [],
    constraintIds: [],
    resourceIds: [],
    source,
    extensions: {},
  };
  const elements = [
    {
      ...base,
      elementId: ids.cell,
      nameKey: { kind: "key", key: "element.cell.name" },
      descriptionKey: { kind: "key", key: "element.cell.description" },
      primitive: "cell-style",
      anchors: ["cell"],
      defaultStyle: {
        fillColor: "#287A4BFF",
        fillOpacity: 0.72,
        patternResourceId,
        patternScale: 12,
      },
      resourceIds: [patternResourceId],
      attributeSchema: attributeSchema(),
    },
    {
      ...base,
      elementId: ids.connection,
      nameKey: { kind: "key", key: "element.connection.name" },
      descriptionKey: {
        kind: "key",
        key: "element.connection.description",
      },
      primitive: "connection",
      anchors: ["map-point"],
      defaultStyle: {
        strokeColor: "#42A5F5FF",
        strokeOpacity: 0.9,
        strokeWidth: 4,
        lineCap: "round",
        arrowStart: false,
        arrowEnd: true,
        arrowSize: 12,
      },
      attributeSchema: attributeSchema(),
    },
    {
      ...base,
      elementId: ids.domain,
      nameKey: { kind: "key", key: "element.domain.name" },
      descriptionKey: { kind: "key", key: "element.domain.description" },
      primitive: "domain-object",
      anchors: ["cell"],
      defaultStyle: {
        representation: "cell-style",
        style: { fillColor: "#8E24AAFF", fillOpacity: 0.65 },
      },
      attributeSchema: attributeSchema(),
      group: {
        minMembers: 2,
        maxMembers: 64,
        connectivity: "edge",
        memberRules: [],
        extensions: {},
      },
    },
    {
      ...base,
      elementId: ids.edge,
      nameKey: { kind: "key", key: "element.edge.name" },
      descriptionKey: { kind: "key", key: "element.edge.description" },
      primitive: "edge-style",
      anchors: ["edge"],
      defaultStyle: {
        strokeColor: "#F4B942FF",
        strokeOpacity: 1,
        strokeWidth: 5,
        dashPattern: [8, 4],
        lineCap: "round",
      },
      attributeSchema: attributeSchema(),
    },
    {
      ...base,
      elementId: ids.marker,
      nameKey: { kind: "key", key: "element.marker.name" },
      descriptionKey: { kind: "key", key: "element.marker.description" },
      primitive: "marker",
      anchors: ["map-point"],
      defaultStyle: {
        shape: "diamond",
        color: "#E53935FF",
        opacity: 0.95,
        displaySize: 30,
        rotation: 15,
        resourceId: markerResourceId,
      },
      resourceIds: [markerResourceId],
      attributeSchema: attributeSchema(),
    },
    {
      ...base,
      elementId: ids.text,
      nameKey: { kind: "key", key: "element.text.name" },
      descriptionKey: { kind: "key", key: "element.text.description" },
      primitive: "text",
      anchors: ["map-point"],
      defaultStyle: {
        color: "#F7F7F7FF",
        opacity: 1,
        fontSize: 20,
        fontWeight: "bold",
        align: "center",
        rotation: 0,
        backgroundColor: "#17324DCC",
        fontResourceId,
      },
      resourceIds: [fontResourceId],
      attributeSchema: attributeSchema(
        {
          text: {
            type: "string",
            minLength: 0,
            maxLength: 256,
            default: "初始扩展文字",
          },
        },
        ["text"],
      ),
    },
  ];
  const manifest = {
    formatVersion: "1",
    kind: "module",
    moduleId,
    version: MOD003_MODULE_VERSION,
    nameKey: { kind: "key", key: "module.name" },
    descriptionKey: { kind: "key", key: "module.description" },
    authors: ["Tessera E2E"],
    appVersion: { min: "0.1.0" },
    supportedGrids: ["square"],
    dependencies: [],
    layers: [
      {
        layerId,
        nameKey: { kind: "key", key: "layer.runtime" },
        zIndex: 2600,
        allowedPrimitives: [
          "cell-style",
          "edge-style",
          "marker",
          "text",
          "connection",
          "domain-object",
        ],
        allowedAnchors: ["cell", "cell-center", "edge", "map-point"],
        defaultVisible: true,
        defaultLocked: false,
        defaultOpacity: 1,
        extensions: {},
      },
    ],
    elementFiles: ["elements/generic.json"],
    constraintFiles: [],
    migrationFiles: [],
    catalogManifestPath: "catalog/content.json",
    defaultLanguage: "zh-CN",
    locales: { "zh-CN": "locales/zh-CN.json" },
    resources: [
      {
        resourceId: patternResourceId,
        path: "assets/pattern.png",
        mimeType: "image/png",
        bytes: MOD003_RESOURCE_PNG.byteLength,
        license: {
          status: "redistributable",
          sourceName: "Tessera E2E",
        },
      },
      {
        resourceId: markerResourceId,
        path: "assets/marker.webp",
        mimeType: "image/webp",
        bytes: MOD003_RESOURCE_WEBP.byteLength,
        license: {
          status: "redistributable",
          sourceName: "Tessera E2E",
        },
      },
      {
        resourceId: fontResourceId,
        path: "assets/label.woff2",
        mimeType: "font/woff2",
        bytes: MOD003_RESOURCE_WOFF2.byteLength,
        license: {
          status: "redistributable",
          sourceName: "Roboto",
          sourceUrl: "https://fonts.google.com/specimen/Roboto",
          licenseId: "Apache-2.0",
        },
      },
    ],
    capabilities: [
      "cell-style",
      "edge-style",
      "anchored-overlay",
      "free-overlay",
      "connection",
      "domain-object",
      "content-catalog",
    ],
    packageSource: {
      kind: "user-file",
      publisher: "Tessera E2E",
      publishedAt: "2026-08-24T00:00:00.000Z",
    },
    extensions: {},
  };
  const catalog = {
    kind: "content-catalog",
    formatVersion: "1",
    moduleId,
    moduleVersion: MOD003_MODULE_VERSION,
    catalogId: `${moduleId}:catalog.main`,
    catalogVersion: MOD003_MODULE_VERSION,
    catalogSource: null,
    categories: [
      {
        categoryId,
        nameKey: { kind: "key", key: "category.weather" },
        count: elements.length,
        extensions: {},
      },
    ],
    entries: elements.map((element) => ({
      elementId: element.elementId,
      categoryId,
      sourceId,
      contentVersion: MOD003_MODULE_VERSION,
      resourceIds: element.resourceIds,
      extensions: {},
    })),
    extensions: {},
  };
  const locale = {
    "module.name": MOD003_MODULE_NAME,
    "module.description": "真实非 Civ6 通用扩展运行时回归",
    "layer.runtime": "扩展运行层",
    "category.weather": MOD003_CATEGORY_NAME,
    "element.cell.name": "雨区填充",
    "element.cell.description": "通用 cell-style 元素",
    "element.connection.name": "流向连线",
    "element.connection.description": "通用 connection 元素",
    "element.domain.name": "风暴领域",
    "element.domain.description": "共享边连通的通用 domain-object 元素",
    "element.edge.name": "锋面边界",
    "element.edge.description": "通用 edge-style 元素",
    "element.marker.name": "雷达标记",
    "element.marker.description": "通用 marker 元素",
    "element.text.name": "天气注记",
    "element.text.description": "通用 text 元素",
  };
  return {
    "module.json": JSON.stringify(manifest),
    "elements/generic.json": JSON.stringify(elements),
    "catalog/content.json": JSON.stringify(catalog),
    "locales/zh-CN.json": JSON.stringify(locale),
    "assets/pattern.png": MOD003_RESOURCE_PNG,
    "assets/marker.webp": MOD003_RESOURCE_WEBP,
    "assets/label.woff2": MOD003_RESOURCE_WOFF2,
  };
}
