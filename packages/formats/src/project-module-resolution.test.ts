import { createProject, TESSERA_APP_VERSION } from "@tessera/core";
import { describe, expect, it } from "vitest";
import {
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
      elements: [],
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
});
