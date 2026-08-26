import {
  EditorStore,
  createProject,
  edgeIdentity,
  type FixedLayerState,
  type ModuleRuntimeInstance,
} from "@tessera/core";
import {
  computeProjectContentBounds,
  restoreProjectV1,
  toProjectV1,
  type ProjectV1Document,
} from "@tessera/formats";
import {
  BASIC_MODULE_PACKAGE,
  type ModuleElementDefinition,
  type ParsedModulePackage,
} from "@tessera/module-runtime";
import { describe, expect, it, vi } from "vitest";
import {
  captureVisualExportSnapshot,
  executeVisualExportPng,
  planVisualExport,
} from "@tessera/renderer/visual-export";
import {
  ActiveProjectModuleSession,
  validateActiveProjectModuleInstances,
} from "./active-project-module-session.js";
import { createInstalledModuleResolver } from "./package-project-runtime.js";
import { importProjectFile } from "./project-file-workflow.js";

const emptyAttributes = {
  type: "object" as const,
  properties: {},
  required: [],
  additionalProperties: false as const,
};

function pngCanvasContext(): CanvasRenderingContext2D {
  const noop = () => undefined;
  return {
    save: noop,
    restore: noop,
    setTransform: noop,
    beginPath: noop,
    rect: noop,
    clip: noop,
    fillRect: noop,
    moveTo: noop,
    lineTo: noop,
    closePath: noop,
    fill: noop,
    stroke: noop,
    setLineDash: noop,
    translate: noop,
    rotate: noop,
    arc: noop,
    roundRect: noop,
    fillText: noop,
    globalAlpha: 1,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    lineDashOffset: 0,
    font: "",
    textAlign: "start",
    textBaseline: "alphabetic",
  } as unknown as CanvasRenderingContext2D;
}

function element(
  definition: Partial<ModuleElementDefinition> &
    Pick<ModuleElementDefinition, "elementId" | "primitive" | "defaultStyle">,
): ModuleElementDefinition {
  return {
    categoryId: "example.weather:terrain",
    nameKey: { kind: "key", key: `${definition.elementId}.name` },
    descriptionKey: { kind: "key", key: `${definition.elementId}.description` },
    layerId: "example.weather.surface",
    anchors:
      definition.primitive === "cell-style" ||
      definition.primitive === "domain-object"
        ? ["cell"]
        : definition.primitive === "edge-style"
          ? ["edge"]
          : definition.primitive === "connection"
            ? ["cell-center"]
            : ["map-point"],
    supportedGrids: ["square"],
    attributeSchema: emptyAttributes,
    occupancy: [],
    constraintIds: [],
    resourceIds: [],
    source: {
      sourceId: "example.weather:fixture",
      rulesetId: "fixture",
      contentVersion: "1",
      retrievedAt: "2026-08-24T00:00:00.000Z",
    },
    ...definition,
  };
}

const elements = [
  element({
    elementId: "example.weather:cell.rain",
    primitive: "cell-style",
    defaultStyle: { fillColor: "#2255AAFF", fillOpacity: 0.6 },
    attributeSchema: {
      type: "object",
      properties: {
        intensity: { type: "integer", minimum: 0, maximum: 10, default: 3 },
      },
      required: ["intensity"],
      additionalProperties: false,
    },
  }),
  element({
    elementId: "example.weather:edge.front",
    primitive: "edge-style",
    nameKey: { kind: "literal", language: "en", text: "Front line" },
    defaultStyle: {
      strokeColor: "#FFFFFFFF",
      strokeOpacity: 1,
      strokeWidth: 2,
      dashPattern: [3, 5],
      lineCap: "butt",
    },
  }),
  element({
    elementId: "example.weather:edge.solid",
    primitive: "edge-style",
    nameKey: { kind: "literal", language: "en", text: "Solid edge" },
    descriptionKey: {
      kind: "literal",
      language: "en",
      text: "Solid edge",
    },
    defaultStyle: {
      strokeColor: "#ABCDEFEE",
      strokeOpacity: 1,
      strokeWidth: 3,
      lineCap: "round",
    },
  }),
  element({
    elementId: "example.weather:marker.radar",
    primitive: "marker",
    defaultStyle: {
      resourceId: "example.weather:image.radar",
      color: "#FFFFFFFF",
      opacity: 1,
      displaySize: 20,
      rotation: 0,
    },
    resourceIds: ["example.weather:image.radar"],
  }),
  element({
    elementId: "example.weather:text.note",
    primitive: "text",
    defaultStyle: {
      color: "#FFFFFFFF",
      opacity: 1,
      fontSize: 16,
      fontWeight: "normal",
      align: "center",
      rotation: 0,
      backgroundColor: "#00000088",
      wrapWidth: 24,
    },
    attributeSchema: {
      type: "object",
      properties: {
        text: { type: "string", minLength: 0, maxLength: 256 },
      },
      required: ["text"],
      additionalProperties: false,
    },
  }),
  element({
    elementId: "example.weather:domain.zone",
    primitive: "domain-object",
    defaultStyle: {
      representation: "cell-style",
      style: { fillColor: "#FFFFFFFF", fillOpacity: 1 },
    },
    group: {
      minMembers: 2,
      maxMembers: 64,
      connectivity: "edge",
      memberRules: [],
    },
  }),
  element({
    elementId: "example.weather:connection.flow",
    primitive: "connection",
    defaultStyle: {
      strokeColor: "#FFFFFFFF",
      strokeOpacity: 1,
      strokeWidth: 2,
      dashPattern: [7, 2],
      lineCap: "square",
      arrowStart: false,
      arrowEnd: true,
      arrowSize: 8,
    },
  }),
  element({
    elementId: "example.weather:connection.solid",
    primitive: "connection",
    nameKey: { kind: "literal", language: "en", text: "Solid connection" },
    descriptionKey: {
      kind: "literal",
      language: "en",
      text: "Solid connection",
    },
    defaultStyle: {
      strokeColor: "#55AAFFFF",
      strokeOpacity: 1,
      strokeWidth: 3,
      lineCap: "round",
      arrowStart: false,
      arrowEnd: false,
      arrowSize: 8,
    },
  }),
] as const;

const modulePackage = {
  kind: "module",
  artifactId: "example.weather",
  version: "1.0.0",
  manifest: {
    formatVersion: "1",
    kind: "module",
    moduleId: "example.weather",
    version: "1.0.0",
    nameKey: { kind: "key", key: "module.name" },
    descriptionKey: { kind: "key", key: "module.description" },
    authors: ["test"],
    appVersion: { min: "0.1.0" },
    supportedGrids: ["square"],
    dependencies: [],
    layers: [
      {
        layerId: "example.weather.surface",
        nameKey: { kind: "key", key: "layer.name" },
        zIndex: 2500,
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
      },
    ],
    elementFiles: ["elements.json"],
    constraintFiles: [],
    migrationFiles: [],
    catalogManifestPath: null,
    defaultLanguage: "en",
    locales: { en: "locales/en.json", "zh-CN": "locales/zh-CN.json" },
    resources: [
      {
        resourceId: "example.weather:image.radar",
        path: "assets/radar.png",
        mimeType: "image/png",
        bytes: 1,
        license: {
          status: "redistributable",
          sourceName: "test",
        },
      },
    ],
    capabilities: ["content-catalog"],
    packageSource: {
      kind: "user-file",
      publisher: "test",
      publishedAt: "2026-08-24T00:00:00.000Z",
    },
  },
  elements,
  constraints: [],
  migrations: [],
  catalog: null,
  locales: {
    en: {
      "module.name": "Weather",
      "module.description": "Weather module",
      "layer.name": "Surface",
      "example.weather:cell.rain.name": "Rain",
      "example.weather:cell.rain.description": "Rain cell",
      "example.weather:edge.front.description": "Front edge",
      "example.weather:marker.radar.name": "Radar",
      "example.weather:marker.radar.description": "Radar marker",
      "example.weather:text.note.name": "Note",
      "example.weather:text.note.description": "Text note",
      "example.weather:domain.zone.name": "Zone",
      "example.weather:domain.zone.description": "Domain zone",
      "example.weather:connection.flow.name": "Flow",
      "example.weather:connection.flow.description": "Flow connection",
    },
    "zh-CN": {
      "module.name": "天气",
      "module.description": "天气模块",
      "layer.name": "地表",
      "example.weather:cell.rain.name": "降雨",
      "example.weather:cell.rain.description": "降雨地格",
      "example.weather:edge.front.description": "锋面边",
      "example.weather:marker.radar.name": "雷达",
      "example.weather:marker.radar.description": "雷达标记",
      "example.weather:text.note.name": "注记",
      "example.weather:text.note.description": "文字注记",
      "example.weather:domain.zone.name": "区域",
      "example.weather:domain.zone.description": "领域区域",
      "example.weather:connection.flow.name": "流向",
      "example.weather:connection.flow.description": "流向连线",
    },
  },
  resources: BASIC_MODULE_PACKAGE.resources,
} as ParsedModulePackage;

function moduleWithDomain(
  representation: "cell-style" | "edge-style" | "marker" | "text",
  style: Readonly<Record<string, unknown>>,
  attributeSchema: ModuleElementDefinition["attributeSchema"] = emptyAttributes,
): ParsedModulePackage {
  return {
    ...modulePackage,
    elements: modulePackage.elements.map((candidate) =>
      candidate.elementId === "example.weather:domain.zone"
        ? {
            ...candidate,
            defaultStyle: {
              representation,
              style,
            } as ModuleElementDefinition["defaultStyle"],
            attributeSchema,
          }
        : candidate,
    ),
  };
}

const ruleSlotId = "example.weather:slot.front";
const ruleConstraintId = "example.weather:constraint.intensity";

function modulePackageWithRules(): ParsedModulePackage {
  return {
    ...modulePackage,
    elements: modulePackage.elements.map((item) => {
      if (item.elementId === "example.weather:cell.rain")
        return { ...item, constraintIds: [ruleConstraintId] };
      if (
        item.elementId === "example.weather:edge.front" ||
        item.elementId === "example.weather:edge.solid"
      )
        return {
          ...item,
          occupancy: [
            {
              slotId: ruleSlotId,
              anchor: "edge" as const,
              min: 0,
              max: 1,
              conflict: "warning" as const,
            },
          ],
        };
      return item;
    }),
    constraints: [
      {
        constraintId: ruleConstraintId,
        severity: "error",
        messageKey: {
          kind: "literal",
          language: "zh-CN",
          text: "降雨强度超出规划范围",
        },
        appliesTo: ["example.weather:cell.rain"],
        maxRadius: 0,
        rulesetVersion: "1",
        condition: {
          op: "number-range",
          path: "attributes.intensity",
          min: 0,
          max: 4,
        },
        extensions: {},
      },
    ],
  };
}

function activeDocument(): ProjectV1Document {
  const document = structuredClone(
    toProjectV1(
      createProject({
        name: "模块工程",
        grid: { type: "square", width: 16, height: 16, cellSize: 32 },
        style: {
          canvasBackground: "#09141DFF",
          defaultCellColor: "#14232DFF",
          gridColor: "#59656AFF",
          gridOpacity: 0.7,
          gridWidth: 1,
          defaultEdgeColor: "#59656AFF",
        },
      }),
    ),
  );
  document.modules = [
    {
      moduleId: modulePackage.artifactId,
      version: modulePackage.version,
      packageSourceKind: "user-file",
      extensions: {},
    },
    ...document.modules,
  ];
  document.layerStates = [
    ...document.layerStates,
    {
      layerId: "example.weather.surface",
      moduleVersion: "1.0.0",
      zIndex: 2500,
      visible: true,
      locked: false,
      opacity: 1,
      extensions: {},
    },
  ].sort((left, right) => left.zIndex - right.zIndex);
  document.contentBounds = computeProjectContentBounds(document);
  return document;
}

function storeWithActiveModule(): EditorStore {
  return new EditorStore(
    restoreProjectV1(JSON.stringify(activeDocument()), {
      moduleResolver: createInstalledModuleResolver([modulePackage]),
      currentAppVersion: "0.1.0",
      moduleResolutionMode: "strict",
    }),
  );
}

describe("ActiveProjectModuleSession", () => {
  it("初始模块对象不依赖 opaque 启用记录，始终可发现并放置", () => {
    const store = new EditorStore(
      createProject({
        name: "基础对象",
        grid: { type: "square", width: 4, height: 4, cellSize: 32 },
        style: {
          canvasBackground: "#09141DFF",
          defaultCellColor: "#14232DFF",
          gridColor: "#59656AFF",
          gridOpacity: 0.7,
          gridWidth: 1,
          defaultEdgeColor: "#59656AFF",
        },
      }),
    );
    const session = new ActiveProjectModuleSession(store, [], "zh-CN");
    expect(session.get("tessera.basic:object")?.disabledReason).toBeNull();
    expect(
      store.state.moduleInstances.get(
        session.placeDomainGroup("tessera.basic:object", ["cell:square:1:1"]),
      ),
    ).toMatchObject({ memberCellIds: ["cell:square:1:1"] });
  });

  it("按精确启用模块发现本地化目录，并显式标记不安全声明", () => {
    const session = new ActiveProjectModuleSession(
      storeWithActiveModule(),
      [modulePackage],
      "zh-CN",
    );
    expect(session.elements.map((item) => item.displayName)).toContain("降雨");
    expect(session.get("example.weather:edge.front")?.displayName).toBe(
      "Front line",
    );
    expect(session.get("example.weather:marker.radar")?.disabledReason).toBe(
      null,
    );
    expect(
      session.get("example.weather:domain.zone")?.disabledReason,
    ).toBeNull();
  });

  it("合法图片样式保留模块精确版本与资源身份", () => {
    const store = storeWithActiveModule();
    const session = new ActiveProjectModuleSession(
      store,
      [modulePackage],
      "zh-CN",
    );
    const instanceId = session.placeOverlay("example.weather:marker.radar", {
      kind: "map-point",
      point: { x: 20, y: 30 },
    });
    const instance = store.state.moduleInstances.get(instanceId);
    if (instance === undefined) throw new Error("marker-instance-missing");
    expect(session.resolveVisual(instance)).toMatchObject({
      kind: "marker",
      image: {
        moduleId: "example.weather",
        version: "1.0.0",
        resourceId: "example.weather:image.radar",
      },
    });
  });

  it("模块 marker 仅在 attributeSchema 显式声明时接受并解析 label", () => {
    const allowedPackage: ParsedModulePackage = {
      ...modulePackage,
      elements: modulePackage.elements.map((candidate) =>
        candidate.elementId === "example.weather:marker.radar"
          ? {
              ...candidate,
              attributeSchema: {
                type: "object",
                properties: {
                  label: { type: "string", minLength: 0, maxLength: 256 },
                },
                required: [],
                additionalProperties: false,
              },
            }
          : candidate,
      ),
    };
    const allowedStore = storeWithActiveModule();
    const allowed = new ActiveProjectModuleSession(
      allowedStore,
      [allowedPackage],
      "zh-CN",
    );
    const allowedId = allowed.placeOverlay("example.weather:marker.radar", {
      kind: "map-point",
      point: { x: 20, y: 30 },
    });
    allowed.updateInstance(allowedId, { attributes: { label: "雷达站" } });
    const allowedInstance = allowedStore.state.moduleInstances.get(allowedId);
    if (allowedInstance === undefined)
      throw new Error("marker-instance-missing");
    expect(allowed.resolveVisual(allowedInstance)).toMatchObject({
      kind: "marker",
      label: "雷达站",
    });

    const deniedStore = storeWithActiveModule();
    const denied = new ActiveProjectModuleSession(
      deniedStore,
      [modulePackage],
      "zh-CN",
    );
    const deniedId = denied.placeOverlay("example.weather:marker.radar", {
      kind: "map-point",
      point: { x: 20, y: 30 },
    });
    expect(() =>
      denied.updateInstance(deniedId, { attributes: { label: "越权附文" } }),
    ).toThrowError(expect.objectContaining({ code: "attribute-invalid" }));
  });

  it("DomainGroup 创建保持实例 ID，支持撤销重做与保存重载", () => {
    const store = storeWithActiveModule();
    const session = new ActiveProjectModuleSession(
      store,
      [modulePackage],
      "zh-CN",
    );
    const memberCellIds = ["cell:square:2:2", "cell:square:2:3"];
    const instanceId = session.placeDomainGroup(
      "example.weather:domain.zone",
      memberCellIds,
    );
    expect(store.state.moduleInstances.get(instanceId)).toMatchObject({
      kind: "domain-group",
      instanceId,
      memberCellIds,
    });
    store.undo();
    expect(store.state.moduleInstances.get(instanceId)).toBeUndefined();
    store.redo();
    expect(store.state.moduleInstances.get(instanceId)).toBeDefined();

    const document = toProjectV1(store.state);
    expect(document.domainGroups).toEqual([
      expect.objectContaining({ groupId: instanceId, memberCellIds }),
    ]);
    const restored = new EditorStore(
      restoreProjectV1(JSON.stringify(document), {
        moduleResolver: createInstalledModuleResolver([modulePackage]),
        currentAppVersion: "0.1.0",
        moduleResolutionMode: "strict",
      }),
    );
    expect(restored.state.moduleInstances.get(instanceId)).toMatchObject({
      kind: "domain-group",
      memberCellIds,
    });

    const disconnected = structuredClone(document);
    (
      disconnected.domainGroups[0] as { memberCellIds: string[] }
    ).memberCellIds = ["cell:square:2:2", "cell:square:8:8"];
    expect(() =>
      restoreProjectV1(JSON.stringify(disconnected), {
        moduleResolver: createInstalledModuleResolver([modulePackage]),
        currentAppVersion: "0.1.0",
        moduleResolutionMode: "strict",
      }),
    ).toThrowError(
      expect.objectContaining({ code: "domain-group-members-disconnected" }),
    );

    const overLimit = structuredClone(document);
    overLimit.grid.width = 65;
    const overLimitGroup = overLimit.domainGroups[0];
    if (overLimitGroup === undefined) throw new Error("domain-group-missing");
    overLimitGroup.memberCellIds = Array.from(
      { length: 65 },
      (_, index) => `cell:square:0:${index}`,
    );
    // 本用例只验证模块声明的 64 成员上限，避免旧显式布局先触发事实不一致。
    overLimitGroup.extensions = {};
    overLimit.contentBounds = computeProjectContentBounds(overLimit);
    const restoredOverLimit = restoreProjectV1(JSON.stringify(overLimit), {
      moduleResolver: createInstalledModuleResolver([modulePackage]),
      currentAppVersion: "0.1.0",
      moduleResolutionMode: "strict",
    });
    expect(() =>
      validateActiveProjectModuleInstances(new EditorStore(restoredOverLimit), [
        modulePackage,
      ]),
    ).toThrowError(
      expect.objectContaining({
        code: "domain-group-member-count-invalid",
        details: expect.objectContaining({ count: 65, maxMembers: 64 }),
      }),
    );
  });

  it("初始模块物体支持单格、多格、整体删除与保存重载", () => {
    const store = storeWithActiveModule();
    const session = new ActiveProjectModuleSession(
      store,
      [BASIC_MODULE_PACKAGE, modulePackage],
      "zh-CN",
    );
    const singleId = session.placeDomainGroup("tessera.basic:object", [
      "cell:square:1:1",
    ]);
    const footprint = [
      "cell:square:3:2",
      "cell:square:3:3",
      "cell:square:3:4",
      "cell:square:4:2",
      "cell:square:4:3",
      "cell:square:4:4",
    ];
    const multiId = session.placeDomainGroup("tessera.basic:object", footprint);
    expect(store.state.moduleInstances.get(singleId)).toMatchObject({
      kind: "domain-group",
      memberCellIds: ["cell:square:1:1"],
    });
    expect(store.state.moduleInstances.get(multiId)).toMatchObject({
      kind: "domain-group",
      memberCellIds: footprint,
    });

    store.select([{ kind: "module-instance", id: multiId }]);
    store.deleteSelection();
    expect(store.state.moduleInstances.get(multiId)).toBeUndefined();
    store.undo();
    expect(store.state.moduleInstances.get(multiId)).toBeDefined();
    store.redo();
    expect(store.state.moduleInstances.get(multiId)).toBeUndefined();
    store.undo();

    const document = toProjectV1(store.state);
    expect(document.domainGroups).toHaveLength(2);
    const restored = new EditorStore(
      restoreProjectV1(JSON.stringify(document), {
        moduleResolver: createInstalledModuleResolver([
          BASIC_MODULE_PACKAGE,
          modulePackage,
        ]),
        currentAppVersion: "0.1.0",
        moduleResolutionMode: "strict",
      }),
    );
    expect(restored.state.moduleInstances.get(singleId)).toBeDefined();
    expect(restored.state.moduleInstances.get(multiId)).toMatchObject({
      memberCellIds: footprint,
    });
  });

  it("DomainGroup 成员更新跨分块同步索引，支持撤销重做且非法更新回滚", () => {
    const document = activeDocument();
    document.grid.width = 128;
    document.grid.height = 128;
    const store = new EditorStore(
      restoreProjectV1(JSON.stringify(document), {
        moduleResolver: createInstalledModuleResolver([modulePackage]),
        currentAppVersion: "0.1.0",
        moduleResolutionMode: "strict",
      }),
    );
    const session = new ActiveProjectModuleSession(
      store,
      [modulePackage],
      "zh-CN",
    );
    const before = ["cell:square:2:2", "cell:square:2:3"];
    const after = ["cell:square:70:2", "cell:square:70:3"];
    const instanceId = session.placeDomainGroup(
      "example.weather:domain.zone",
      before,
    );
    const versionBeforeUpdate = store.version;

    session.updateDomainGroupMembers(instanceId, after);

    expect(store.version).toBe(versionBeforeUpdate + 1);
    expect(store.state.moduleInstances.get(instanceId)).toMatchObject({
      instanceId,
      memberCellIds: after,
    });
    expect(
      store.state.moduleInstances.queryDomainGroups({
        minX: 64,
        minY: 64,
        maxX: 128,
        maxY: 128,
      }),
    ).toEqual([]);
    expect(
      store.state.moduleInstances
        .queryDomainGroups({
          minX: 64,
          minY: 2_220,
          maxX: 128,
          maxY: 2_300,
        })
        .map((instance) => instance.instanceId),
    ).toEqual([instanceId]);

    store.undo();
    expect(store.state.moduleInstances.get(instanceId)).toMatchObject({
      memberCellIds: before,
    });
    store.redo();
    expect(store.state.moduleInstances.get(instanceId)).toMatchObject({
      memberCellIds: after,
    });

    const versionBeforeReject = store.version;
    expect(() =>
      session.updateDomainGroupMembers(instanceId, [
        "cell:square:10:10",
        "cell:square:12:12",
      ]),
    ).toThrowError(
      expect.objectContaining({ code: "domain-group-members-disconnected" }),
    );
    expect(store.version).toBe(versionBeforeReject);
    expect(store.state.moduleInstances.get(instanceId)).toMatchObject({
      memberCellIds: after,
    });
  });

  it("DomainGroup 接受 64 格并非破坏性拒绝 65 格与非连通集合", () => {
    const store = storeWithActiveModule();
    const session = new ActiveProjectModuleSession(
      store,
      [modulePackage],
      "zh-CN",
    );
    const rectangle = (count: number) =>
      Array.from(
        { length: count },
        (_, index) => `cell:square:${Math.floor(index / 8)}:${index % 8}`,
      );
    expect(() =>
      session.placeDomainGroup("example.weather:domain.zone", rectangle(64)),
    ).not.toThrow();
    const version = store.version;
    expect(() =>
      session.placeDomainGroup("example.weather:domain.zone", rectangle(65)),
    ).toThrowError(
      expect.objectContaining({ code: "domain-group-member-count-invalid" }),
    );
    expect(() =>
      session.placeDomainGroup("example.weather:domain.zone", [
        "cell:square:10:10",
        "cell:square:12:12",
      ]),
    ).toThrowError(
      expect.objectContaining({ code: "domain-group-members-disconnected" }),
    );
    expect(store.version).toBe(version);
  });

  it.each([
    [
      "cell-style",
      { fillColor: "#123456FF", fillOpacity: 0.7 },
      emptyAttributes,
      2,
      "polygon",
    ],
    [
      "edge-style",
      {
        strokeColor: "#123456FF",
        strokeOpacity: 1,
        strokeWidth: 2,
        lineCap: "round",
      },
      emptyAttributes,
      6,
      "stroke",
    ],
    [
      "marker",
      {
        shape: "diamond",
        color: "#123456FF",
        opacity: 1,
        displaySize: 20,
        rotation: 0,
      },
      emptyAttributes,
      1,
      "marker",
    ],
    [
      "text",
      {
        color: "#123456FF",
        opacity: 1,
        fontSize: 16,
        fontWeight: "normal",
        align: "center",
        rotation: 0,
      },
      {
        type: "object",
        properties: {
          text: {
            type: "string",
            minLength: 0,
            maxLength: 256,
            default: "领域",
          },
        },
        required: ["text"],
        additionalProperties: false,
      },
      1,
      "text",
    ],
  ] as const)(
    "DomainGroup %s 表示按成员/外边界/中心生成确定导出 primitive",
    (representation, style, attributeSchema, count, kind) => {
      const packageWithRepresentation = moduleWithDomain(
        representation,
        style,
        attributeSchema,
      );
      const store = storeWithActiveModule();
      const session = new ActiveProjectModuleSession(
        store,
        [packageWithRepresentation],
        "zh-CN",
      );
      const instanceId = session.placeDomainGroup(
        "example.weather:domain.zone",
        ["cell:square:2:2", "cell:square:2:3"],
      );
      const edgeManagerSize = store.state.edges.size;
      const snapshot = captureVisualExportSnapshot(
        store.state,
        session.visualExportCaptureOptions(),
      );
      expect(store.state.edges.size).toBe(edgeManagerSize);
      const primitives = snapshot.extensions
        .flatMap((extension) => extension.descriptors)
        .filter((primitive) => primitive.stableId.startsWith(instanceId));
      expect(primitives).toHaveLength(count);
      expect(primitives.every((primitive) => primitive.kind === kind)).toBe(
        true,
      );
      if (representation === "marker" || representation === "text") {
        expect(primitives[0]).toMatchObject({
          point: { x: 96, y: 80 },
        });
      }
    },
  );

  it("occupancy 与 constraint 不禁用元素且保存重载后提示等价", () => {
    const packageWithRules = modulePackageWithRules();
    const restore = (document: ProjectV1Document) =>
      new EditorStore(
        restoreProjectV1(JSON.stringify(document), {
          moduleResolver: createInstalledModuleResolver([packageWithRules]),
          currentAppVersion: "0.1.0",
          moduleResolutionMode: "strict",
        }),
      );
    const store = restore(activeDocument());
    const session = new ActiveProjectModuleSession(
      store,
      [packageWithRules],
      "zh-CN",
    );
    expect(session.get("example.weather:cell.rain")?.disabledReason).toBeNull();
    expect(
      session.get("example.weather:edge.front")?.disabledReason,
    ).toBeNull();

    const cellInstanceId = session.placeCell(
      "example.weather:cell.rain",
      "cell:square:2:2",
    );
    session.updateInstance(cellInstanceId, { attributes: { intensity: 8 } });
    const edge = edgeIdentity(store.state.grid, { row: 3, column: 3 }, 1);
    const frontId = session.placeEdge(
      "example.weather:edge.front",
      edge.edgeId,
      edge.adjacentCellIds,
    );
    const solidId = session.placeEdge(
      "example.weather:edge.solid",
      edge.edgeId,
      edge.adjacentCellIds,
    );
    expect(session.ruleHintsForInstance(cellInstanceId)).toEqual([
      expect.objectContaining({
        severity: "error",
        message: "降雨强度超出规划范围",
      }),
    ]);
    expect(session.ruleHintsForInstance(frontId)).toEqual([
      expect.objectContaining({
        kind: "occupancy",
        severity: "warning",
        count: 2,
      }),
    ]);

    const restoredStore = restore(toProjectV1(store.state));
    const restoredSession = new ActiveProjectModuleSession(
      restoredStore,
      [packageWithRules],
      "zh-CN",
    );
    expect(restoredSession.ruleHintsForInstance(cellInstanceId)).toEqual(
      session.ruleHintsForInstance(cellInstanceId),
    );
    expect(restoredSession.ruleHintsForInstance(frontId)).toEqual(
      session.ruleHintsForInstance(frontId),
    );
    expect(restoredSession.ruleHintsForInstance(solidId)).toEqual(
      session.ruleHintsForInstance(solidId),
    );
  });

  it("仅把 tessera.basic 的领域物体暴露给 generic 会话", () => {
    const session = new ActiveProjectModuleSession(
      storeWithActiveModule(),
      [BASIC_MODULE_PACKAGE, modulePackage],
      "zh-CN",
    );
    expect(
      session.elements
        .filter((element) => element.moduleId === "tessera.basic")
        .map((element) => element.elementId),
    ).toEqual(["tessera.basic:object"]);
    expect(
      session.elements.some(
        (element) => element.moduleId === "example.weather",
      ),
    ).toBe(true);
  });

  it("session 身份稳定时动态响应图层锁定、隐藏与恢复", () => {
    const store = storeWithActiveModule();
    const session = new ActiveProjectModuleSession(
      store,
      [modulePackage],
      "en",
    );
    const layerId = "example.weather.surface";
    const layers = store.state.layers as Map<string, FixedLayerState>;
    const initial = layers.get(layerId);
    if (initial === undefined) throw new Error("surface-layer-missing");

    layers.set(layerId, { ...initial, locked: true });
    expect(session.get("example.weather:cell.rain")?.disabledReason).toBe(
      "layer-readonly",
    );
    expect(() =>
      session.placeCell("example.weather:cell.rain", "cell:square:2:2"),
    ).toThrowError(expect.objectContaining({ code: "layer-readonly" }));

    layers.set(layerId, { ...initial, locked: false });
    const instanceId = session.placeCell(
      "example.weather:cell.rain",
      "cell:square:2:2",
    );
    const instance = store.state.moduleInstances.get(instanceId);
    if (instance === undefined) throw new Error("module-instance-missing");
    layers.set(layerId, { ...initial, visible: false });
    expect(session.get("example.weather:cell.rain")?.disabledReason).toBe(
      "layer-readonly",
    );

    layers.set(layerId, { ...initial, visible: true });
    expect(session.get("example.weather:cell.rain")?.disabledReason).toBeNull();
    expect(session.resolveVisual(instance)).toMatchObject({
      kind: "cell-style",
      fillColor: "#2255AAFF",
      fillOpacity: 0.6,
    });
  });

  it("包目录先卸载时保留当前实例且不会击穿编辑器会话", () => {
    const store = storeWithActiveModule();
    const available = new ActiveProjectModuleSession(
      store,
      [modulePackage],
      "zh-CN",
    );
    const instanceId = available.placeCell(
      "example.weather:cell.rain",
      "cell:square:2:2",
    );

    expect(
      () => new ActiveProjectModuleSession(store, [], "zh-CN"),
    ).not.toThrow();
    expect(store.state.moduleInstances.get(instanceId)).toBeDefined();
  });

  it("安全 cell 放置只写默认属性，styleOverrides 初始为空且恢复默认删除覆盖", () => {
    const store = storeWithActiveModule();
    const session = new ActiveProjectModuleSession(
      store,
      [modulePackage],
      "en",
    );
    const instanceId = session.placeCell(
      "example.weather:cell.rain",
      "cell:square:2:3",
    );
    expect(store.state.moduleInstances.get(instanceId)).toMatchObject({
      attributes: { intensity: 3 },
      styleOverrides: {},
    });
    session.updateInstance(instanceId, {
      styleOverrides: { fillColor: "#FFFFFFFF" },
    });
    expect(store.state.moduleInstances.get(instanceId)?.styleOverrides).toEqual(
      {
        fillColor: "#FFFFFFFF",
      },
    );
    session.updateInstance(instanceId, {
      styleOverrides: { fillColor: "#2255AAFF" },
    });
    expect(store.state.moduleInstances.get(instanceId)?.styleOverrides).toEqual(
      {
        fillColor: "#2255AAFF",
      },
    );
    session.restoreStyleDefaults(instanceId, ["fillColor"]);
    expect(store.state.moduleInstances.get(instanceId)?.styleOverrides).toEqual(
      {},
    );
    expect(
      session.effectiveStyle(
        instanceId.startsWith("x") ? "" : "example.weather:cell.rain",
        {},
      ),
    ).toMatchObject({
      fillColor: "#2255AAFF",
      fillOpacity: 0.6,
    });
  });

  it.each([
    ["非法颜色", { fillColor: "red" }],
    ["超范围透明度", { fillOpacity: 2 }],
    ["错误透明度类型", { fillOpacity: "opaque" }],
  ] as const)("样式覆盖%s时原子拒绝且不产生历史", (_name, styleOverrides) => {
    const store = storeWithActiveModule();
    const session = new ActiveProjectModuleSession(
      store,
      [modulePackage],
      "en",
    );
    const instanceId = session.placeCell(
      "example.weather:cell.rain",
      "cell:square:2:3",
    );
    const version = store.version;
    const before = store.state.moduleInstances.get(instanceId);

    expect(() =>
      session.updateInstance(instanceId, { styleOverrides }),
    ).toThrowError(expect.objectContaining({ code: "style-override-invalid" }));
    expect(store.version).toBe(version);
    expect(store.state.moduleInstances.get(instanceId)).toBe(before);
    expect(store.state.moduleInstances.get(instanceId)?.styleOverrides).toEqual(
      {},
    );
  });

  it("connection 表示严格由 defaultStyle 的箭头声明决定", () => {
    const store = storeWithActiveModule();
    const session = new ActiveProjectModuleSession(
      store,
      [modulePackage],
      "en",
    );
    const instanceId = session.placeConnection(
      "example.weather:connection.flow",
      { kind: "cell-center", cellId: "cell:square:1:1", extensions: {} },
      { kind: "cell-center", cellId: "cell:square:1:2", extensions: {} },
    );
    expect(store.state.moduleInstances.get(instanceId)).toMatchObject({
      kind: "connection",
      objectKind: "arrow",
      arrowStart: false,
      arrowEnd: true,
      styleOverrides: {},
      label: null,
    });
  });

  it("required text 无默认仍可选择，放置时按字素与跨平台换行原子校验", () => {
    const store = storeWithActiveModule();
    const session = new ActiveProjectModuleSession(
      store,
      [modulePackage],
      "zh-CN",
    );
    expect(session.get("example.weather:text.note")).toMatchObject({
      displayName: "注记",
      disabledReason: null,
    });
    const text = "👩‍🚀e\u0301";
    const instanceId = session.placeOverlay(
      "example.weather:text.note",
      { kind: "map-point", point: { x: 64, y: 96 } },
      text,
    );
    expect(store.state.moduleInstances.get(instanceId)).toMatchObject({
      kind: "overlay",
      overlayType: "text",
      attributes: { text },
      styleOverrides: {},
    });
    const version = store.version;
    expect(() =>
      session.placeOverlay(
        "example.weather:text.note",
        { kind: "map-point", point: { x: 96, y: 96 } },
        "1\r2\r3\r4\r5\r6\r7\r8\r9",
      ),
    ).toThrowError(expect.objectContaining({ code: "attribute-invalid" }));
    expect(store.version).toBe(version);
  });

  it("connection label 空串归一为 null 且拒绝超过八行", () => {
    const store = storeWithActiveModule();
    const session = new ActiveProjectModuleSession(
      store,
      [modulePackage],
      "en",
    );
    const empty = session.placeConnection(
      "example.weather:connection.flow",
      { kind: "cell-center", cellId: "cell:square:1:1", extensions: {} },
      { kind: "cell-center", cellId: "cell:square:1:2", extensions: {} },
      [],
      "",
    );
    expect(store.state.moduleInstances.get(empty)).toMatchObject({
      label: null,
    });
    const version = store.version;
    expect(() =>
      session.placeConnection(
        "example.weather:connection.flow",
        { kind: "cell-center", cellId: "cell:square:1:1", extensions: {} },
        { kind: "cell-center", cellId: "cell:square:1:2", extensions: {} },
        [],
        "1\n2\n3\n4\n5\n6\n7\n8\n9",
      ),
    ).toThrowError(expect.objectContaining({ code: "attribute-invalid" }));
    expect(store.version).toBe(version);
  });

  it("cell/edge brush 对同元素同图层同载体重复事件幂等且一次撤销清理", () => {
    const store = storeWithActiveModule();
    const session = new ActiveProjectModuleSession(
      store,
      [modulePackage],
      "en",
    );
    const cellFirst = session.placeCell(
      "example.weather:cell.rain",
      "cell:square:2:3",
    );
    const versionAfterCell = store.version;
    const cellSecond = session.placeCell(
      "example.weather:cell.rain",
      "cell:square:2:3",
    );
    expect(cellSecond).toBe(cellFirst);
    expect(store.version).toBe(versionAfterCell);
    store.undo();
    expect(store.state.moduleInstances.get(cellFirst)).toBeUndefined();

    const edge = edgeIdentity(store.state.grid, { row: 2, column: 3 }, 1);
    const edgeFirst = session.placeEdge(
      "example.weather:edge.front",
      edge.edgeId,
      edge.adjacentCellIds,
    );
    const versionAfterEdge = store.version;
    const edgeSecond = session.placeEdge(
      "example.weather:edge.front",
      edge.edgeId,
      edge.adjacentCellIds,
    );
    expect(edgeSecond).toBe(edgeFirst);
    expect(store.version).toBe(versionAfterEdge);
    expect(store.state.edges.get(edge.edgeId)?.persistence).toBe(
      "reference-only",
    );
    store.undo();
    expect(store.state.moduleInstances.get(edgeFirst)).toBeUndefined();
    expect(store.state.edges.get(edge.edgeId)).toBeUndefined();

    store.beginBatch();
    const strokeFirst = session.placeCell(
      "example.weather:cell.rain",
      "cell:square:4:4",
    );
    expect(
      session.placeCell("example.weather:cell.rain", "cell:square:4:4"),
    ).toBe(strokeFirst);
    const strokeSecond = session.placeCell(
      "example.weather:cell.rain",
      "cell:square:4:5",
    );
    expect(
      session.placeCell("example.weather:cell.rain", "cell:square:4:5"),
    ).toBe(strokeSecond);
    store.commitBatch();
    store.undo();
    expect(store.state.moduleInstances.get(strokeFirst)).toBeUndefined();
    expect(store.state.moduleInstances.get(strokeSecond)).toBeUndefined();

    const strokeEdges = [
      edgeIdentity(store.state.grid, { row: 4, column: 4 }, 1),
      edgeIdentity(store.state.grid, { row: 4, column: 5 }, 1),
    ] as const;
    store.beginBatch();
    const edgeStrokeFirst = session.placeEdge(
      "example.weather:edge.front",
      strokeEdges[0].edgeId,
      strokeEdges[0].adjacentCellIds,
    );
    expect(
      session.placeEdge(
        "example.weather:edge.front",
        strokeEdges[0].edgeId,
        strokeEdges[0].adjacentCellIds,
      ),
    ).toBe(edgeStrokeFirst);
    const edgeStrokeSecond = session.placeEdge(
      "example.weather:edge.front",
      strokeEdges[1].edgeId,
      strokeEdges[1].adjacentCellIds,
    );
    expect(
      session.placeEdge(
        "example.weather:edge.front",
        strokeEdges[1].edgeId,
        strokeEdges[1].adjacentCellIds,
      ),
    ).toBe(edgeStrokeSecond);
    store.commitBatch();
    store.undo();
    for (const [index, instanceId] of [
      edgeStrokeFirst,
      edgeStrokeSecond,
    ].entries()) {
      expect(store.state.moduleInstances.get(instanceId)).toBeUndefined();
      expect(
        store.state.edges.get(strokeEdges[index]?.edgeId ?? ""),
      ).toBeUndefined();
    }
    store.redo();
    expect(store.state.moduleInstances.get(edgeStrokeFirst)).toBeDefined();
    expect(store.state.moduleInstances.get(edgeStrokeSecond)).toBeDefined();
    expect(store.state.edges.get(strokeEdges[0].edgeId)).toBeDefined();
    expect(store.state.edges.get(strokeEdges[1].edgeId)).toBeDefined();
  });

  it("视觉导出 capture 与 PNG executor 接受五种 primitive 及 solid 描边", async () => {
    const store = storeWithActiveModule();
    const session = new ActiveProjectModuleSession(
      store,
      [modulePackage],
      "en",
    );
    session.placeCell("example.weather:cell.rain", "cell:square:2:2");
    const edge = edgeIdentity(store.state.grid, { row: 2, column: 2 }, 1);
    session.placeEdge(
      "example.weather:edge.front",
      edge.edgeId,
      edge.adjacentCellIds,
    );
    const solidEdge = edgeIdentity(store.state.grid, { row: 2, column: 3 }, 1);
    const solidEdgeId = session.placeEdge(
      "example.weather:edge.solid",
      solidEdge.edgeId,
      solidEdge.adjacentCellIds,
    );
    session.placeOverlay(
      "example.weather:text.note",
      { kind: "map-point", point: { x: 96, y: 96 } },
      "导出注记",
    );
    session.placeConnection(
      "example.weather:connection.flow",
      { kind: "cell-center", cellId: "cell:square:1:1", extensions: {} },
      { kind: "cell-center", cellId: "cell:square:1:3", extensions: {} },
      [],
      "导出连线",
    );
    const solidConnectionId = session.placeConnection(
      "example.weather:connection.solid",
      { kind: "cell-center", cellId: "cell:square:3:1", extensions: {} },
      { kind: "cell-center", cellId: "cell:square:3:3", extensions: {} },
      [],
      null,
    );
    store.addModuleInstance({
      kind: "overlay",
      objectKind: "free-overlay",
      overlayType: "marker",
      instanceId: "missing-marker",
      elementId: "example.missing:marker.placeholder",
      layerId: "example.weather.surface",
      point: { x: 128, y: 96 },
      orderInLayer: 0,
      attributes: {},
      styleOverrides: {},
      extensions: {},
      runtimeStatus: "missing",
    });
    store.addModuleInstance({
      kind: "overlay",
      objectKind: "free-overlay",
      overlayType: "text",
      instanceId: "missing-text",
      elementId: "example.missing:text.note",
      layerId: "example.weather.surface",
      point: { x: 160, y: 96 },
      orderInLayer: 1,
      attributes: { text: "opaque" },
      styleOverrides: {},
      extensions: {},
      runtimeStatus: "missing",
    });
    store.addModuleInstance({
      kind: "connection",
      objectKind: "line",
      instanceId: "missing-connection",
      elementId: "example.missing:connection.front",
      layerId: "example.weather.surface",
      start: {
        kind: "map-point",
        point: { x: 32, y: 160 },
        extensions: {},
      },
      end: {
        kind: "map-point",
        point: { x: 160, y: 160 },
        extensions: {},
      },
      label: null,
      attributes: {},
      styleOverrides: {},
      extensions: {},
      runtimeStatus: "missing",
    });
    const hiddenLayer = "example.weather.hidden";
    const visibleLayer = store.state.layers.get("example.weather.surface");
    if (visibleLayer === undefined) throw new Error("visible-layer-missing");
    (store.state.layers as Map<string, FixedLayerState>).set(hiddenLayer, {
      ...visibleLayer,
      layerId: hiddenLayer,
      visible: false,
    });
    store.state.moduleInstances.add({
      kind: "cell",
      instanceId: "hidden-missing-cell",
      elementId: "example.missing:cell.hidden",
      layerId: hiddenLayer,
      cellId: "cell:square:1:1",
      attributes: {},
      styleOverrides: {},
      extensions: {},
      runtimeStatus: "missing",
    });

    const snapshot = captureVisualExportSnapshot(
      store.state,
      session.visualExportCaptureOptions(),
    );
    const primitives = snapshot.extensions.flatMap(
      (extension) => extension.descriptors,
    );
    expect(new Set(primitives.map((primitive) => primitive.kind))).toEqual(
      new Set(["polygon", "stroke", "marker", "text"]),
    );
    expect(
      primitives.some(
        (primitive) =>
          primitive.kind === "text" && primitive.text === "导出注记",
      ),
    ).toBe(true);
    expect(
      primitives.some(
        (primitive) =>
          primitive.stableId === "missing-text" && primitive.kind === "marker",
      ),
    ).toBe(true);
    expect(
      primitives.some(
        (primitive) =>
          primitive.stableId === "missing-connection" &&
          primitive.kind === "stroke" &&
          primitive.lineStyle === "dashed",
      ),
    ).toBe(true);
    expect(
      primitives.some(
        (primitive) => primitive.stableId === "hidden-missing-cell",
      ),
    ).toBe(false);
    expect(
      primitives.filter(
        (primitive) =>
          primitive.kind === "stroke" &&
          primitive.lineCap === "butt" &&
          primitive.dashPattern?.join(",") === "3,5",
      ),
    ).toHaveLength(1);
    expect(
      primitives.some(
        (primitive) =>
          primitive.kind === "stroke" &&
          primitive.lineCap === "butt" &&
          primitive.dashPattern?.join(",") === "7,2",
      ),
    ).toBe(true);
    expect(
      primitives.some(
        (primitive) =>
          primitive.kind === "text" &&
          primitive.text === "导出注记" &&
          primitive.backgroundColor === "#00000088" &&
          primitive.wrapWidth === 24,
      ),
    ).toBe(true);
    expect(
      primitives.some(
        (primitive) =>
          primitive.kind === "text" && primitive.text === "导出连线",
      ),
    ).toBe(true);
    for (const stableId of [solidEdgeId, solidConnectionId]) {
      expect(
        primitives.find(
          (primitive) =>
            primitive.kind === "stroke" && primitive.stableId === stableId,
        ),
      ).toMatchObject({ lineStyle: "solid", lineCap: "round" });
      expect(
        primitives.find(
          (primitive) =>
            primitive.kind === "stroke" && primitive.stableId === stableId,
        ),
      ).not.toHaveProperty("dashPattern");
    }
    const plan = planVisualExport(snapshot, {
      format: "png",
      range: { kind: "full-map" },
      background: { kind: "transparent" },
      showGrid: false,
      scale: 1,
    });
    await expect(
      executeVisualExportPng(
        plan,
        {
          context: pngCanvasContext(),
          encodePng: async () =>
            new Blob([new Uint8Array([137, 80, 78, 71])], {
              type: "image/png",
            }),
        },
        {
          isCancelled: () => false,
          onProgress: () => undefined,
          now: () => 0,
          yieldControl: async () => undefined,
          batchSize: 128,
          executionMode: "fallback",
        },
      ),
    ).resolves.toMatchObject({ format: "png", mimeType: "image/png" });
  });

  it("大量元素的视觉导出按 elementId 桶读取且不为每个 renderer 全扫对象", () => {
    const store = storeWithActiveModule();
    const session = new ActiveProjectModuleSession(
      store,
      [modulePackage],
      "en",
    );
    for (let index = 0; index < 256; index += 1) {
      store.state.moduleInstances.add({
        kind: "cell",
        instanceId: `missing-${index}`,
        elementId: `example.missing:cell.${index}`,
        layerId: "example.weather.surface",
        cellId: `cell:square:${index % 10}:${index % 10}`,
        attributes: {},
        styleOverrides: {},
        extensions: {},
        runtimeStatus: "missing",
      });
    }
    const options = session.visualExportCaptureOptions();
    const values = vi
      .spyOn(store.state.moduleInstances, "values")
      .mockImplementation(() => {
        throw new Error("unexpected-full-instance-scan");
      });

    const snapshot = captureVisualExportSnapshot(store.state, options);

    expect(snapshot.extensions).toHaveLength(256);
    expect(values).not.toHaveBeenCalled();
    values.mockRestore();
  });

  it.each([
    [
      "element",
      (instance: ModuleRuntimeInstance) => ({
        ...instance,
        elementId: "example.weather:cell.unknown",
      }),
    ],
    [
      "primitive",
      (instance: ModuleRuntimeInstance) => ({
        ...instance,
        kind: "edge",
        edgeId: "edge:square:test",
        adjacentCellIds: ["cell:square:2:3"],
      }),
    ],
    [
      "schema",
      (instance: ModuleRuntimeInstance) => ({
        ...instance,
        attributes: { intensity: 99 },
      }),
    ],
    [
      "style",
      (instance: ModuleRuntimeInstance) => ({
        ...instance,
        styleOverrides: { unknown: true },
      }),
    ],
  ] as const)(
    "精确包实例 %s 契约不匹配时拒绝候选且不保存",
    async (_name, corrupt) => {
      const store = storeWithActiveModule();
      const session = new ActiveProjectModuleSession(
        store,
        [modulePackage],
        "en",
      );
      const instanceId = session.placeCell(
        "example.weather:cell.rain",
        "cell:square:2:3",
      );
      const current = store.state.moduleInstances.get(instanceId);
      if (current === undefined) throw new Error("module-instance-missing");
      store.state.moduleInstances.delete(instanceId);
      store.state.moduleInstances.add(
        corrupt(current) as ModuleRuntimeInstance,
      );
      const save = vi.fn(async () => undefined);

      await expect(
        importProjectFile(
          {
            file: { size: 2, text: async () => "{}" },
            currentProjectId: null,
            repository: { save },
          },
          {
            prepareExternalProject: () => ({
              metadata: {
                projectId: store.state.projectId,
                name: store.state.name,
                exportScope: "full",
                isComplete: true,
              },
              toState: () => store.state,
            }),
            validateState: (candidate) =>
              validateActiveProjectModuleInstances(
                new EditorStore(candidate as never),
                [modulePackage],
              ),
          },
        ),
      ).rejects.toMatchObject({ code: "project-file-invalid" });
      expect(save).not.toHaveBeenCalled();
    },
  );

  it("安全候选通过精确实例校验后才保存", async () => {
    const store = storeWithActiveModule();
    const save = vi.fn(async () => undefined);
    await importProjectFile(
      {
        file: { size: 2, text: async () => "{}" },
        currentProjectId: null,
        repository: { save },
      },
      {
        prepareExternalProject: () => ({
          metadata: {
            projectId: store.state.projectId,
            name: store.state.name,
            exportScope: "full",
            isComplete: true,
          },
          toState: () => store.state,
        }),
        validateState: (candidate) =>
          validateActiveProjectModuleInstances(
            new EditorStore(candidate as never),
            [modulePackage],
          ),
      },
    );
    expect(save).toHaveBeenCalledOnce();
  });
});
