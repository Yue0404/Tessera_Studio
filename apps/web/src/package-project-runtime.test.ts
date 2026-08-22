import { describe, expect, it } from "vitest";
import { createProject, TESSERA_APP_VERSION } from "@tessera/core";
import {
  BASIC_MODULE_PACKAGE,
  BLANK_PRESET_PACKAGE,
  type PackageRegistry,
  type ParsedModulePackage,
  type ParsedPresetPackage,
} from "@tessera/module-runtime";
import {
  computeProjectContentBounds,
  restoreProjectV1,
  stringifyProjectDocumentV1,
  toProjectV1,
} from "@tessera/formats";
import {
  buildRegistryForInstalledModules,
  buildRegistryForInstalledPreset,
  createProjectFromModules,
  createProjectFromPreset,
  createRegistryModuleResolver,
  inspectInstalledPresetAvailability,
} from "./package-project-runtime.js";

const customModule = {
  ...BASIC_MODULE_PACKAGE,
  artifactId: "example.domain",
  manifest: {
    ...BASIC_MODULE_PACKAGE.manifest,
    moduleId: "example.domain",
    packageSource: {
      kind: "user-file",
      publisher: "测试发布者",
      publishedAt: "2026-08-22T00:00:00Z",
    },
    dependencies: [
      {
        moduleId: "tessera.basic",
        versionRange: "1.0.0",
        optional: false,
      },
    ],
    layers: [
      {
        layerId: "example.domain.groups",
        nameKey: { kind: "literal", language: "zh-CN", text: "领域层" },
        zIndex: 700,
        allowedPrimitives: ["domain-object"],
        allowedAnchors: ["cell"],
        defaultVisible: true,
        defaultLocked: false,
        defaultOpacity: 0.8,
        extensions: {},
      },
    ],
  },
  elements: [
    {
      ...BASIC_MODULE_PACKAGE.elements[0],
      elementId: "example.domain:city",
      categoryId: "example.domain:category.city",
      layerId: "example.domain.groups",
      primitive: "domain-object",
      anchors: ["cell"],
    },
  ],
} as unknown as ParsedModulePackage;

const preset = {
  ...BLANK_PRESET_PACKAGE,
  artifactId: "example.preset.domain",
  manifest: {
    ...BLANK_PRESET_PACKAGE.manifest,
    presetId: "example.preset.domain",
    packageSource: {
      kind: "user-file",
      publisher: "测试发布者",
      publishedAt: "2026-08-22T00:00:00Z",
    },
    modules: [
      {
        moduleId: "example.domain",
        versionRange: "1.0.0",
        required: true,
        extensions: {},
      },
      {
        moduleId: "tessera.basic",
        versionRange: "1.0.0",
        required: true,
        extensions: {},
      },
    ],
    layerStates: [
      {
        layerId: "example.domain.groups",
        visible: true,
        locked: false,
        opacity: 0.6,
      },
    ],
  },
} as unknown as ParsedPresetPackage;

function registry(): PackageRegistry {
  const basicState = {
    module: BASIC_MODULE_PACKAGE,
    optionalDependenciesMissing: [],
  };
  return {
    modules: new Map([
      ["tessera.basic", basicState],
      [
        "example.domain",
        { module: customModule, optionalDependenciesMissing: [] },
      ],
    ]),
    presets: new Map([
      [
        preset.artifactId,
        {
          preset,
          status: "available",
          moduleStates: [
            { moduleId: "example.domain", status: "available" },
            { moduleId: "tessera.basic", status: "available" },
          ],
        },
      ],
    ]),
    loadOrder: ["tessera.basic", "example.domain"],
    basicModule: basicState,
  };
}

function baseProject() {
  return createProject({
    name: "预设工程",
    grid: { type: "square", width: 4, height: 4, cellSize: 32 },
    style: {
      canvasBackground: "#000000FF",
      defaultCellColor: "#111111FF",
      gridColor: "#FFFFFFFF",
      gridOpacity: 1,
      gridWidth: 1,
      defaultEdgeColor: "#FFFFFFFF",
    },
  });
}

describe("Registry 与 Project runtime layer", () => {
  it("预设写入精确模块并按 zIndex 启用 domain-group 图层", () => {
    const value = createProjectFromPreset(
      baseProject(),
      registry(),
      preset.artifactId,
      TESSERA_APP_VERSION,
    );
    expect(value.layers.get("example.domain.groups")).toMatchObject({
      moduleVersion: "1.0.0",
      zIndex: 700,
      opacity: 0.6,
      allowedKinds: ["domain-group"],
    });
    const document = toProjectV1(value);
    expect(document.modules.map((module) => module.moduleId)).toEqual([
      "example.domain",
      "tessera.basic",
    ]);
    expect(document.layerStates.map((layer) => layer.zIndex)).toEqual([
      500, 700, 1500, 3000, 4300, 4400,
    ]);
  });

  it("已有 DomainGroup 作为 opaque 事实往返不丢", () => {
    const packageRegistry = registry();
    const created = createProjectFromPreset(
      baseProject(),
      packageRegistry,
      preset.artifactId,
      TESSERA_APP_VERSION,
    );
    const document = toProjectV1(created);
    document.domainGroups.push({
      kind: "domain-group",
      groupId: "00000000-0000-4000-8000-000000000099",
      elementId: "example.domain:city",
      layerId: "example.domain.groups",
      memberCellIds: ["cell:square:0:0"],
      attributes: { name: "测试城市" },
      styleOverrides: { color: "#FF0000FF" },
      extensions: { example: { keep: true } },
    });
    document.chunks.push({
      chunkRow: 0,
      chunkColumn: 0,
      cellOverrides: [],
      ownedEdgeIds: [],
      ownedOverlayIds: [],
      ownedDomainGroupIds: ["00000000-0000-4000-8000-000000000099"],
      extensions: {},
    });
    document.contentBounds = computeProjectContentBounds(document);
    const restored = restoreProjectV1(stringifyProjectDocumentV1(document), {
      moduleResolver: createRegistryModuleResolver(packageRegistry),
      currentAppVersion: TESSERA_APP_VERSION,
    });
    expect(toProjectV1(restored).domainGroups).toEqual(document.domainGroups);
  });

  it("connection 同一 element 同时暴露 line/arrow，edge 适配为 midpoint", () => {
    const contract = createRegistryModuleResolver(registry()).resolve({
      moduleId: "tessera.basic",
      version: "1.0.0",
      appVersion: TESSERA_APP_VERSION,
      gridType: "square",
    });
    const lineId = "tessera.basic:connection.line";
    expect(
      contract?.elements
        .filter((element) => element.elementId === lineId)
        .map((element) => element.primitive),
    ).toEqual(["line", "arrow"]);
    expect(
      contract?.layers.find(
        (layer) => layer.layerId === "tessera.basic.connection",
      )?.allowedAnchors,
    ).toContain("edge-midpoint");
  });

  it("应用版本常量与内置包、Project 输出一致", () => {
    expect(TESSERA_APP_VERSION).toBe("0.1.0");
    expect(BASIC_MODULE_PACKAGE.manifest.appVersion.min).toBe(
      TESSERA_APP_VERSION,
    );
    expect(BLANK_PRESET_PACKAGE.manifest.appVersion.min).toBe(
      TESSERA_APP_VERSION,
    );
    expect(toProjectV1(baseProject()).createdWithAppVersion).toBe(
      TESSERA_APP_VERSION,
    );
  });

  it("预设尺寸上下限是硬约束且不覆盖用户 cellSize 与样式", () => {
    const packageRegistry = registry();
    const input = baseProject();
    input.grid.cellSize = 47;
    input.style.canvasBackground = "#123456FF";
    const created = createProjectFromPreset(
      input,
      packageRegistry,
      preset.artifactId,
      TESSERA_APP_VERSION,
    );
    expect(created.grid.cellSize).toBe(47);
    expect(created.style.canvasBackground).toBe("#123456FF");

    input.grid.width = 40_000;
    const constrainedRegistry = registry();
    const presetState = constrainedRegistry.presets.get(preset.artifactId);
    if (presetState === undefined) throw new Error("测试预设缺失");
    const constrainedPreset = {
      ...presetState.preset,
      manifest: {
        ...presetState.preset.manifest,
        grid: { ...presetState.preset.manifest.grid, maxWidth: 100 },
      },
    };
    const withLimit: PackageRegistry = {
      ...constrainedRegistry,
      presets: new Map([
        [preset.artifactId, { ...presetState, preset: constrainedPreset }],
      ]),
    };
    expect(() =>
      createProjectFromPreset(
        input,
        withLimit,
        preset.artifactId,
        TESSERA_APP_VERSION,
      ),
    ).toThrowError(
      expect.objectContaining({ code: "package-grid-incompatible" }),
    );
  });

  it("不选预设时将显式选择的精确模块与图层写入工程", async () => {
    const packageRegistry = await buildRegistryForInstalledModules(
      [customModule],
      ["module:example.domain@1.0.0"],
      TESSERA_APP_VERSION,
      "square",
    );
    const created = createProjectFromModules(
      baseProject(),
      packageRegistry,
      TESSERA_APP_VERSION,
    );
    expect(toProjectV1(created).modules.map((item) => item.moduleId)).toEqual([
      "example.domain",
      "tessera.basic",
    ]);
    expect(created.layers.get("example.domain.groups")?.allowedKinds).toEqual([
      "domain-group",
    ]);
  });

  it("预设依赖范围同时匹配多个已安装版本时不隐式选择", async () => {
    const rangedPreset = {
      ...preset,
      manifest: {
        ...preset.manifest,
        modules: preset.manifest.modules.map((item) =>
          item.moduleId === "example.domain"
            ? { ...item, versionRange: "^1.0.0" }
            : item,
        ),
      },
    } as ParsedPresetPackage;
    const newer = {
      ...customModule,
      version: "1.1.0",
      manifest: { ...customModule.manifest, version: "1.1.0" },
    } as ParsedModulePackage;
    await expect(
      buildRegistryForInstalledPreset(
        [customModule, newer, rangedPreset],
        "preset:example.preset.domain@1.0.0",
        TESSERA_APP_VERSION,
        "square",
      ),
    ).rejects.toMatchObject({ code: "package-conflict" });
  });

  it("预设可选依赖允许缺失、单版本选入，多版本仍拒绝消歧", async () => {
    const optionalPreset = {
      ...preset,
      manifest: {
        ...preset.manifest,
        modules: preset.manifest.modules.map((item) =>
          item.moduleId === "example.domain"
            ? { ...item, required: false, versionRange: "^1.0.0" }
            : item,
        ),
      },
    } as ParsedPresetPackage;
    const identity = "preset:example.preset.domain@1.0.0";
    const missing = await buildRegistryForInstalledPreset(
      [optionalPreset],
      identity,
      TESSERA_APP_VERSION,
      "square",
    );
    expect([...missing.modules.keys()]).toEqual(["tessera.basic"]);

    const one = await buildRegistryForInstalledPreset(
      [customModule, optionalPreset],
      identity,
      TESSERA_APP_VERSION,
      "square",
    );
    expect(one.modules.has("example.domain")).toBe(true);

    const newer = {
      ...customModule,
      version: "1.1.0",
      manifest: { ...customModule.manifest, version: "1.1.0" },
    } as ParsedModulePackage;
    await expect(
      buildRegistryForInstalledPreset(
        [customModule, newer, optionalPreset],
        identity,
        TESSERA_APP_VERSION,
        "square",
      ),
    ).rejects.toMatchObject({ code: "package-conflict" });
  });

  it("新建前区分必需模块缺失、版本范围无匹配与多版本冲突", async () => {
    const identity = "preset:example.preset.domain@1.0.0";
    expect(
      await inspectInstalledPresetAvailability(
        [preset],
        identity,
        TESSERA_APP_VERSION,
        "square",
      ),
    ).toBe("required-unavailable");

    const outsideRange = {
      ...customModule,
      version: "2.0.0",
      manifest: { ...customModule.manifest, version: "2.0.0" },
    } as ParsedModulePackage;
    expect(
      await inspectInstalledPresetAvailability(
        [outsideRange, preset],
        identity,
        TESSERA_APP_VERSION,
        "square",
      ),
    ).toBe("required-unavailable");

    const gridIncompatible = {
      ...customModule,
      manifest: {
        ...customModule.manifest,
        supportedGrids: ["hex-pointy"],
      },
    } as ParsedModulePackage;
    expect(
      await inspectInstalledPresetAvailability(
        [gridIncompatible, preset],
        identity,
        TESSERA_APP_VERSION,
        "square",
      ),
    ).toBe("incompatible");

    const rangedPreset = {
      ...preset,
      manifest: {
        ...preset.manifest,
        modules: preset.manifest.modules.map((item) =>
          item.moduleId === "example.domain"
            ? { ...item, versionRange: "^1.0.0" }
            : item,
        ),
      },
    } as ParsedPresetPackage;
    const newer = {
      ...customModule,
      version: "1.1.0",
      manifest: { ...customModule.manifest, version: "1.1.0" },
    } as ParsedModulePackage;
    expect(
      await inspectInstalledPresetAvailability(
        [customModule, newer, rangedPreset],
        identity,
        TESSERA_APP_VERSION,
        "square",
      ),
    ).toBe("version-conflict");
  });
});
