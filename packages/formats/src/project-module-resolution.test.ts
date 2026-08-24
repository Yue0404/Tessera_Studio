import {
  createProject,
  edgeIdentity,
  EditorStore,
  TESSERA_APP_VERSION,
} from "@tessera/core";
import { describe, expect, it } from "vitest";
import {
  computeProjectContentBounds,
  ProjectFormatError,
  restoreProjectV1,
  stringifyProjectV1,
  toProjectV1,
  type FragmentModuleResolver,
  type ProjectV1Document,
} from "./index.js";

function documentWithExternalLayer(): ProjectV1Document {
  const state = createProject({
    name: "外部模块",
    grid: { type: "square", width: 8, height: 8, cellSize: 32 },
    style: {
      canvasBackground: "#09141DFF",
      defaultCellColor: "#14232DFF",
      gridColor: "#59656AFF",
      gridOpacity: 0.7,
      gridWidth: 1,
      defaultEdgeColor: "#59656AFF",
    },
  });
  const document = structuredClone(toProjectV1(state)) as ProjectV1Document;
  document.modules = [
    {
      moduleId: "example.weather",
      version: "1.0.0",
      packageSourceKind: "user-file",
      extensions: { test: { preserved: true } },
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
      opacity: 0.8,
      extensions: { test: { preserved: true } },
    },
  ].sort(
    (left, right) =>
      left.zIndex - right.zIndex || left.layerId.localeCompare(right.layerId),
  );
  return document;
}

const resolver: FragmentModuleResolver = {
  resolve(request) {
    if (request.moduleId !== "example.weather" || request.version !== "1.0.0")
      return undefined;
    return {
      moduleId: request.moduleId,
      version: request.version,
      appVersionSupported: true,
      supportedGrids: ["square"],
      layers: [
        {
          layerId: "example.weather.surface",
          zIndex: 2500,
          allowedPrimitives: ["cell"],
          allowedAnchors: ["cell"],
        },
      ],
      elements: [
        {
          elementId: "example.weather:cell.surface",
          layerId: "example.weather.surface",
          primitive: "cell",
          supportedGrids: ["square"],
          anchors: ["cell"],
        },
      ],
    };
  },
};

const edgeResolver: FragmentModuleResolver = {
  resolve(request) {
    const contract = resolver.resolve(request);
    if (contract === undefined) return undefined;
    return {
      ...contract,
      layers: contract.layers.map((layer) => ({
        ...layer,
        allowedPrimitives: ["cell", "edge", "marker-overlay"],
        allowedAnchors: ["cell", "edge"],
      })),
      elements: [
        ...contract.elements,
        {
          elementId: "example.weather:edge.front",
          layerId: "example.weather.surface",
          primitive: "edge",
          supportedGrids: ["square"],
          anchors: ["edge"],
        },
        {
          elementId: "example.weather:marker.station",
          layerId: "example.weather.surface",
          primitive: "marker-overlay",
          supportedGrids: ["square"],
          anchors: ["edge"],
        },
      ],
    };
  },
};

function restore(document: ProjectV1Document, moduleResolver = resolver) {
  return restoreProjectV1(JSON.stringify(document), {
    moduleResolver,
    currentAppVersion: TESSERA_APP_VERSION,
    moduleResolutionMode: "strict",
  });
}

describe("Project 外部模块图层解析", () => {
  it("可用模块的声明图层与 Project 图层一一对应并进入运行时", () => {
    const state = restore(documentWithExternalLayer());
    expect(state.layers.get("example.weather.surface")).toMatchObject({
      moduleVersion: "1.0.0",
      zIndex: 2500,
      opacity: 0.8,
      allowedKinds: ["cell"],
    });
  });

  it("严格模式拒绝缺层、多余层与 zIndex/moduleVersion 不匹配", () => {
    const missing = documentWithExternalLayer();
    missing.layerStates = missing.layerStates.filter(
      (layer) => layer.layerId !== "example.weather.surface",
    );
    expect(() => restore(missing)).toThrowError(
      expect.objectContaining({ code: "project-module-layer-missing" }),
    );

    const unknown = documentWithExternalLayer();
    unknown.layerStates = [
      ...unknown.layerStates,
      {
        layerId: "example.weather.unknown",
        moduleVersion: "1.0.0",
        zIndex: 2600,
        visible: true,
        locked: false,
        opacity: 1,
        extensions: {},
      },
    ].sort(
      (left, right) =>
        left.zIndex - right.zIndex || left.layerId.localeCompare(right.layerId),
    );
    expect(() => restore(unknown)).toThrowError(
      expect.objectContaining({ code: "project-module-layer-unknown" }),
    );

    const zIndex = documentWithExternalLayer();
    const layer = zIndex.layerStates.find(
      (item) => item.layerId === "example.weather.surface",
    );
    expect(layer).toBeDefined();
    if (layer === undefined) throw new Error("测试外部层缺失");
    (layer as { zIndex: number }).zIndex = 2501;
    expect(() => restore(zIndex)).toThrowError(
      expect.objectContaining({ code: "project-module-layer-mismatch" }),
    );

    const version = documentWithExternalLayer();
    const versionLayer = version.layerStates.find(
      (item) => item.layerId === "example.weather.surface",
    );
    expect(versionLayer).toBeDefined();
    if (versionLayer === undefined) throw new Error("测试外部层缺失");
    (versionLayer as { moduleVersion: string }).moduleVersion = "1.0.1";
    expect(() => restore(version)).toThrow(ProjectFormatError);
  });

  it("无 resolver 时严格拒绝，容错生成锁定占位并可在重装后恢复", () => {
    const document = documentWithExternalLayer();
    expect(() =>
      restoreProjectV1(JSON.stringify(document), {
        moduleResolutionMode: "strict",
      }),
    ).toThrowError(
      expect.objectContaining({ code: "project-module-unavailable" }),
    );

    const missing = restoreProjectV1(JSON.stringify(document), {
      moduleResolutionMode: "tolerant",
    });
    expect(missing.layers.get("example.weather.surface")).toMatchObject({
      locked: true,
      allowedKinds: [],
      runtimeStatus: "missing",
    });
    const preserved = stringifyProjectV1(missing, { mode: "preserve" });
    expect(JSON.parse(preserved).modules[0].extensions).toEqual({
      test: { preserved: true },
    });
    expect(
      restoreProjectV1(preserved, {
        moduleResolver: resolver,
        currentAppVersion: TESSERA_APP_VERSION,
        moduleResolutionMode: "tolerant",
      }).layers.get("example.weather.surface"),
    ).toMatchObject({
      allowedKinds: ["cell"],
      locked: false,
    });
  });

  it("通用实例只 materialize 一次并按 Project v1 既有载体往返", () => {
    const document = documentWithExternalLayer();
    const instanceId = crypto.randomUUID();
    document.chunks = [
      {
        chunkRow: 0,
        chunkColumn: 0,
        cellOverrides: [
          {
            cellId: "cell:square:1:2",
            layerInstances: [
              {
                instanceId,
                elementId: "example.weather:cell.surface",
                layerId: "example.weather.surface",
                attributes: { intensity: 3 },
                styleOverrides: {},
                extensions: { source: "fixture" },
              },
            ],
            extensions: {},
          },
        ],
        ownedEdgeIds: [],
        ownedOverlayIds: [],
        ownedDomainGroupIds: [],
        extensions: {},
      },
    ];
    document.contentBounds = computeProjectContentBounds(document);

    const state = restore(document);
    expect(state.moduleInstances.get(instanceId)).toMatchObject({
      kind: "cell",
      cellId: "cell:square:1:2",
      attributes: { intensity: 3 },
      styleOverrides: {},
      runtimeStatus: "available",
    });
    const current = state.moduleInstances.get(instanceId);
    if (current === undefined) throw new Error("测试通用实例缺失");
    state.moduleInstances.replace({
      ...current,
      attributes: { intensity: 7 },
    });

    const saved = toProjectV1(state, { mode: "preserve" });
    const persisted = saved.chunks
      .flatMap((chunk) => chunk.cellOverrides)
      .flatMap((cell) => cell.layerInstances)
      .find((instance) => instance.instanceId === instanceId);
    expect(persisted).toEqual({
      instanceId,
      elementId: "example.weather:cell.surface",
      layerId: "example.weather.surface",
      attributes: { intensity: 7 },
      styleOverrides: {},
      extensions: { source: "fixture" },
    });
    expect(restore(saved).moduleInstances.get(instanceId)?.attributes).toEqual({
      intensity: 7,
    });
  });

  it("缺包通用实例作为只读占位完整保存，精确包恢复后重新可用", () => {
    const document = documentWithExternalLayer();
    const instanceId = crypto.randomUUID();
    document.chunks = [
      {
        chunkRow: 0,
        chunkColumn: 0,
        cellOverrides: [
          {
            cellId: "cell:square:3:4",
            layerInstances: [
              {
                instanceId,
                elementId: "example.weather:cell.surface",
                layerId: "example.weather.surface",
                attributes: { intensity: 5 },
                styleOverrides: {},
                extensions: {},
              },
            ],
            extensions: {},
          },
        ],
        ownedEdgeIds: [],
        ownedOverlayIds: [],
        ownedDomainGroupIds: [],
        extensions: {},
      },
    ];
    document.contentBounds = computeProjectContentBounds(document);

    const missing = restoreProjectV1(JSON.stringify(document), {
      moduleResolutionMode: "tolerant",
    });
    expect(missing.moduleInstances.get(instanceId)).toMatchObject({
      runtimeStatus: "missing",
      attributes: { intensity: 5 },
    });
    const preserved = stringifyProjectV1(missing, { mode: "preserve" });
    const restored = restoreProjectV1(preserved, {
      moduleResolver: resolver,
      currentAppVersion: TESSERA_APP_VERSION,
      moduleResolutionMode: "strict",
    });
    expect(restored.moduleInstances.get(instanceId)).toMatchObject({
      runtimeStatus: "available",
      attributes: { intensity: 5 },
    });
  });

  it("available 外部层的 visible/locked/opacity 修改可保存重载", () => {
    const store = new EditorStore(restore(documentWithExternalLayer()));
    store.setLayerState("example.weather.surface", {
      visible: false,
      locked: true,
      opacity: 0.35,
    });
    const restored = restore(toProjectV1(store.state, { mode: "preserve" }));
    expect(restored.layers.get("example.weather.surface")).toMatchObject({
      visible: false,
      locked: true,
      opacity: 0.35,
    });
  });

  it.each(["unknown-element", "wrong-container"] as const)(
    "strict 拒绝 %s，tolerant 将精确包实例降为只读 missing",
    (kind) => {
      const document = documentWithExternalLayer();
      const instanceId = crypto.randomUUID();
      document.chunks = [
        {
          chunkRow: 0,
          chunkColumn: 0,
          cellOverrides: [
            {
              cellId: "cell:square:1:1",
              layerInstances: [
                {
                  instanceId,
                  elementId:
                    kind === "unknown-element"
                      ? "example.weather:cell.unknown"
                      : "example.weather:edge.front",
                  layerId: "example.weather.surface",
                  attributes: {},
                  styleOverrides: {},
                  extensions: {},
                },
              ],
              extensions: {},
            },
          ],
          ownedEdgeIds: [],
          ownedOverlayIds: [],
          ownedDomainGroupIds: [],
          extensions: {},
        },
      ];
      document.contentBounds = computeProjectContentBounds(document);
      expect(() =>
        restoreProjectV1(JSON.stringify(document), {
          moduleResolver: edgeResolver,
          currentAppVersion: TESSERA_APP_VERSION,
          moduleResolutionMode: "strict",
        }),
      ).toThrowError(
        expect.objectContaining({ code: "project-module-element-mismatch" }),
      );
      const tolerant = restoreProjectV1(JSON.stringify(document), {
        moduleResolver: edgeResolver,
        currentAppVersion: TESSERA_APP_VERSION,
        moduleResolutionMode: "tolerant",
      });
      expect(tolerant.layers.get("example.weather.surface")).toMatchObject({
        locked: true,
        runtimeStatus: "missing",
        allowedKinds: [],
      });
      expect(tolerant.moduleInstances.get(instanceId)?.runtimeStatus).toBe(
        "missing",
      );
    },
  );

  it("跨模块目标图层仍按 element 所属模块降级为 missing", () => {
    const document = documentWithExternalLayer();
    const instanceId = crypto.randomUUID();
    document.modules = [
      {
        moduleId: "example.other",
        version: "1.0.0",
        packageSourceKind: "user-file",
        extensions: {},
      },
      ...document.modules,
    ];
    document.layerStates = [
      ...document.layerStates,
      {
        layerId: "example.other.surface",
        moduleVersion: "1.0.0",
        zIndex: 2600,
        visible: true,
        locked: false,
        opacity: 1,
        extensions: {},
      },
    ].sort(
      (left, right) =>
        left.zIndex - right.zIndex || left.layerId.localeCompare(right.layerId),
    );
    document.chunks = [
      {
        chunkRow: 0,
        chunkColumn: 0,
        cellOverrides: [
          {
            cellId: "cell:square:2:2",
            layerInstances: [
              {
                instanceId,
                elementId: "example.weather:cell.surface",
                layerId: "example.other.surface",
                attributes: {},
                styleOverrides: {},
                extensions: {},
              },
            ],
            extensions: {},
          },
        ],
        ownedEdgeIds: [],
        ownedOverlayIds: [],
        ownedDomainGroupIds: [],
        extensions: {},
      },
    ];
    document.contentBounds = computeProjectContentBounds(document);
    const dualResolver: FragmentModuleResolver = {
      resolve(request) {
        if (request.moduleId === "example.weather")
          return resolver.resolve(request);
        if (request.moduleId !== "example.other" || request.version !== "1.0.0")
          return undefined;
        return {
          moduleId: request.moduleId,
          version: request.version,
          appVersionSupported: true,
          supportedGrids: ["square"],
          layers: [
            {
              layerId: "example.other.surface",
              zIndex: 2600,
              allowedPrimitives: ["cell"],
              allowedAnchors: ["cell"],
            },
          ],
          elements: [],
        };
      },
    };

    const tolerant = restoreProjectV1(JSON.stringify(document), {
      moduleResolver: dualResolver,
      currentAppVersion: TESSERA_APP_VERSION,
      moduleResolutionMode: "tolerant",
    });
    expect(tolerant.layers.get("example.weather.surface")?.runtimeStatus).toBe(
      "missing",
    );
    expect(tolerant.layers.get("example.other.surface")?.runtimeStatus).toBe(
      undefined,
    );
    expect(tolerant.moduleInstances.get(instanceId)?.runtimeStatus).toBe(
      "missing",
    );
  });

  it.each([false, true])(
    "删除唯一 generic edge 时按引用闭包%s结构 edge",
    (referenced) => {
      const document = documentWithExternalLayer();
      const identity = edgeIdentity(
        { type: "square", width: 8, height: 8, cellSize: 32 },
        { row: 1, column: 1 },
        1,
      );
      const edgeInstanceId = crypto.randomUUID();
      document.managers.edgeManager.edges = [
        {
          kind: "edge",
          edgeId: identity.edgeId,
          adjacentCellIds: [...identity.adjacentCellIds],
          layerInstances: [
            {
              instanceId: edgeInstanceId,
              elementId: "example.weather:edge.front",
              layerId: "example.weather.surface",
              attributes: {},
              styleOverrides: {},
              extensions: {},
            },
          ],
          extensions: {},
        },
      ];
      const overlayId = crypto.randomUUID();
      document.managers.overlayManager.overlays = referenced
        ? [
            {
              kind: "anchored-overlay",
              overlayId,
              elementId: "example.weather:marker.station",
              layerId: "example.weather.surface",
              overlayType: "marker",
              anchor: { kind: "edge", edgeId: identity.edgeId, extensions: {} },
              styleOverrides: {},
              attributes: {},
              orderInLayer: 0,
              extensions: {},
            },
          ]
        : [];
      document.chunks = [
        {
          chunkRow: 0,
          chunkColumn: 0,
          cellOverrides: [],
          ownedEdgeIds: [identity.edgeId],
          ownedOverlayIds: referenced ? [overlayId] : [],
          ownedDomainGroupIds: [],
          extensions: {},
        },
      ];
      document.contentBounds = computeProjectContentBounds(document);
      const state = restoreProjectV1(JSON.stringify(document), {
        moduleResolver: edgeResolver,
        currentAppVersion: TESSERA_APP_VERSION,
        moduleResolutionMode: "strict",
      });
      expect(state.edges.get(identity.edgeId)).toMatchObject({
        edgeId: identity.edgeId,
        adjacentCellIds: identity.adjacentCellIds,
        persistence: "reference-only",
      });
      state.moduleInstances.delete(edgeInstanceId);

      const saved = toProjectV1(state, { mode: "preserve" });
      expect(
        saved.managers.edgeManager.edges.some(
          (edge) => edge.edgeId === identity.edgeId,
        ),
      ).toBe(referenced);
      expect(
        saved.chunks.some((chunk) =>
          chunk.ownedEdgeIds.includes(identity.edgeId),
        ),
      ).toBe(referenced);
      const firstReload = restoreProjectV1(JSON.stringify(saved), {
        moduleResolver: edgeResolver,
        currentAppVersion: TESSERA_APP_VERSION,
        moduleResolutionMode: "strict",
      });
      const savedAgain = toProjectV1(firstReload, { mode: "preserve" });
      const secondReload = restoreProjectV1(JSON.stringify(savedAgain), {
        moduleResolver: edgeResolver,
        currentAppVersion: TESSERA_APP_VERSION,
        moduleResolutionMode: "strict",
      });
      expect(secondReload.edges.get(identity.edgeId) !== undefined).toBe(
        referenced,
      );
      expect(
        savedAgain.chunks.some((chunk) =>
          chunk.ownedEdgeIds.includes(identity.edgeId),
        ),
      ).toBe(referenced);
    },
  );

  it("多模块大样本恢复按对象与定义线性完成", () => {
    const moduleCount = 512;
    const document = structuredClone(
      toProjectV1(
        createProject({
          name: "多模块性能回归",
          grid: { type: "square", width: 8, height: 8, cellSize: 32 },
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
    ) as ProjectV1Document;
    const modules = Array.from({ length: moduleCount }, (_, index) => {
      const moduleId = `example.perf${index.toString().padStart(3, "0")}`;
      return {
        moduleId,
        version: "1.0.0",
        packageSourceKind: "user-file" as const,
        extensions: {},
      };
    });
    document.modules = [...modules, ...document.modules];
    document.layerStates = [
      ...document.layerStates,
      ...modules.map((module, index) => ({
        layerId: `${module.moduleId}.surface`,
        moduleVersion: module.version,
        zIndex: 3000 + index,
        visible: true,
        locked: false,
        opacity: 1,
        extensions: {},
      })),
    ].sort(
      (left, right) =>
        left.zIndex - right.zIndex || left.layerId.localeCompare(right.layerId),
    );
    document.chunks = [
      {
        chunkRow: 0,
        chunkColumn: 0,
        cellOverrides: [
          {
            cellId: "cell:square:1:1",
            layerInstances: modules.map((module) => ({
              instanceId: crypto.randomUUID(),
              elementId: `${module.moduleId}:cell.surface`,
              layerId: `${module.moduleId}.surface`,
              attributes: {},
              styleOverrides: {},
              extensions: {},
            })),
            extensions: {},
          },
        ],
        ownedEdgeIds: [],
        ownedOverlayIds: [],
        ownedDomainGroupIds: [],
        extensions: {},
      },
    ];
    document.contentBounds = computeProjectContentBounds(document);
    const zByModuleId = new Map(
      modules.map((module, index) => [module.moduleId, 3000 + index]),
    );
    const manyModuleResolver: FragmentModuleResolver = {
      resolve(request) {
        if (
          request.version !== "1.0.0" ||
          !request.moduleId.startsWith("example.perf")
        )
          return undefined;
        return {
          moduleId: request.moduleId,
          version: request.version,
          appVersionSupported: true,
          supportedGrids: ["square"],
          layers: [
            {
              layerId: `${request.moduleId}.surface`,
              zIndex: zByModuleId.get(request.moduleId) ?? 0,
              allowedPrimitives: ["cell"],
              allowedAnchors: ["cell"],
            },
          ],
          elements: [
            {
              elementId: `${request.moduleId}:cell.surface`,
              layerId: `${request.moduleId}.surface`,
              primitive: "cell",
              supportedGrids: ["square"],
              anchors: ["cell"],
            },
          ],
        };
      },
    };

    const restored = restoreProjectV1(JSON.stringify(document), {
      moduleResolver: manyModuleResolver,
      currentAppVersion: TESSERA_APP_VERSION,
      moduleResolutionMode: "strict",
    });
    expect(restored.moduleInstances.size).toBe(moduleCount);
    expect(
      [...restored.moduleInstances.values()].every(
        (instance) => instance.runtimeStatus === "available",
      ),
    ).toBe(true);
  });
});
