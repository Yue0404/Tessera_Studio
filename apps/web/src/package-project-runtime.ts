import {
  BASIC_MODULE_PACKAGE,
  ModuleRuntimeError,
  appVersionCompatible,
  buildPackageRegistry,
  moduleVersionSatisfies,
  type PackageRegistry,
  type ParsedExtensionPackage,
  type ParsedModulePackage,
  type ParsedPresetPackage,
} from "@tessera/module-runtime";
import type { GridType, ProjectState } from "@tessera/core";
import {
  restoreProjectV1,
  stringifyProjectDocumentV1,
  toProjectV1,
  type FragmentModuleResolver,
  type ResolvedElementContract,
  type ResolvedLayerContract,
  type ProjectV1Document,
} from "@tessera/formats";

function primitiveForElement(
  module: ParsedModulePackage,
  element: ParsedModulePackage["elements"][number],
): ResolvedElementContract["primitive"] {
  switch (element.primitive) {
    case "cell-style":
      return "cell";
    case "edge-style":
      return "edge";
    case "marker":
      return "marker-overlay";
    case "text":
      return "text-overlay";
    case "domain-object":
      return "domain-group";
    case "connection":
      return "line";
    default:
      throw new ModuleRuntimeError(
        "package-resource-invalid",
        "elements/" + element.elementId,
        { reason: "runtime-primitive-unknown", moduleId: module.artifactId },
      );
  }
}

function primitivesForLayer(
  module: ParsedModulePackage,
  layer: ParsedModulePackage["manifest"]["layers"][number],
): ResolvedLayerContract["allowedPrimitives"] {
  const result = new Set<ResolvedLayerContract["allowedPrimitives"][number]>();
  for (const primitive of layer.allowedPrimitives) {
    if (primitive === "cell-style") result.add("cell");
    else if (primitive === "edge-style") result.add("edge");
    else if (primitive === "marker") result.add("marker-overlay");
    else if (primitive === "text") result.add("text-overlay");
    else if (primitive === "domain-object") result.add("domain-group");
    else if (primitive === "connection") {
      result.add("line");
      result.add("arrow");
    } else {
      throw new ModuleRuntimeError(
        "package-resource-invalid",
        "layers/" + layer.layerId,
        { reason: "runtime-primitive-unknown", moduleId: module.artifactId },
      );
    }
  }
  return [...result];
}

function resolvedElements(
  module: ParsedModulePackage,
  element: ParsedModulePackage["elements"][number],
): readonly ResolvedElementContract[] {
  const common = {
    elementId: element.elementId,
    layerId: element.layerId,
    supportedGrids: element.supportedGrids,
  };
  if (element.primitive === "connection") {
    const endpoints = element.anchors.map((anchor) =>
      anchor === "cell" || anchor === "cell-center"
        ? "cell-center"
        : anchor === "edge"
          ? "edge-midpoint"
          : "map-point",
    );
    return (["line", "arrow"] as const).map((primitive) =>
      Object.freeze({ ...common, primitive, endpoints }),
    );
  }
  return [
    Object.freeze({
      ...common,
      primitive: primitiveForElement(module, element),
      anchors: element.anchors.map((anchor) =>
        anchor === "cell-center" ? "cell" : anchor,
      ),
    }),
  ];
}

function anchorsForLayer(
  layer: ParsedModulePackage["manifest"]["layers"][number],
): ResolvedLayerContract["allowedAnchors"] {
  const result = new Set<ResolvedLayerContract["allowedAnchors"][number]>();
  const connection = layer.allowedPrimitives.includes("connection");
  const other = layer.allowedPrimitives.some(
    (primitive) => primitive !== "connection",
  );
  for (const anchor of layer.allowedAnchors) {
    if (other) result.add(anchor === "cell-center" ? "cell" : anchor);
    if (connection) {
      result.add(
        anchor === "cell" || anchor === "cell-center"
          ? "cell-center"
          : anchor === "edge"
            ? "edge-midpoint"
            : "map-point",
      );
    }
  }
  return [...result];
}

function packageSourceKind(module: ParsedModulePackage) {
  return module.manifest.packageSource.kind;
}

function moduleResolver(
  lookup: (
    moduleId: string,
    version: string,
  ) => ParsedModulePackage | undefined,
): FragmentModuleResolver {
  return Object.freeze({
    resolve(request: Parameters<FragmentModuleResolver["resolve"]>[0]) {
      const module = lookup(request.moduleId, request.version);
      if (
        module === undefined ||
        module.version !== request.version ||
        !module.manifest.supportedGrids.includes(request.gridType)
      ) {
        return undefined;
      }
      return Object.freeze({
        moduleId: module.artifactId,
        version: module.version,
        appVersionSupported: appVersionCompatible(
          request.appVersion,
          module.manifest.appVersion,
        ),
        supportedGrids: module.manifest.supportedGrids,
        layers: Object.freeze(
          module.manifest.layers.map((layer) =>
            Object.freeze({
              layerId: layer.layerId,
              zIndex: layer.zIndex,
              allowedPrimitives: primitivesForLayer(module, layer),
              allowedAnchors: anchorsForLayer(layer),
            }),
          ),
        ),
        elements: Object.freeze(
          module.elements.flatMap((element) =>
            resolvedElements(module, element),
          ),
        ),
      });
    },
  });
}

/** 多版本安装库只按 moduleId 与 exactVersion 解析，不隐式激活任一版本。 */
export function createInstalledModuleResolver(
  packages: readonly ParsedExtensionPackage[],
): FragmentModuleResolver {
  const exact = new Map(
    packages
      .filter((item): item is ParsedModulePackage => item.kind === "module")
      .map((module) => [module.artifactId + "@" + module.version, module]),
  );
  return moduleResolver((moduleId, version) =>
    exact.get(moduleId + "@" + version),
  );
}

function packageIdentityKey(item: ParsedExtensionPackage): string {
  return `${item.kind}:${item.artifactId}@${item.version}`;
}

/**
 * 从已安装的精确预设版本构建 Registry。若同一依赖范围匹配多个版本，必须由用户先
 * 清理或明确选择，绝不按列表顺序隐式激活。
 */
export async function buildRegistryForInstalledPreset(
  packages: readonly ParsedExtensionPackage[],
  presetIdentity: string,
  currentAppVersion: string,
  grid: GridType,
  additionalModuleIdentities: readonly string[] = [],
): Promise<PackageRegistry> {
  const preset = packages.find(
    (item): item is ParsedPresetPackage =>
      item.kind === "preset" && packageIdentityKey(item) === presetIdentity,
  );
  if (preset === undefined) {
    throw new ModuleRuntimeError("package-preset-unavailable", "preset", {
      presetIdentity,
    });
  }
  const selected: ParsedModulePackage[] = [];
  for (const requirement of preset.manifest.modules) {
    const candidates =
      requirement.moduleId === BASIC_MODULE_PACKAGE.artifactId
        ? [BASIC_MODULE_PACKAGE]
        : packages.filter(
            (item): item is ParsedModulePackage =>
              item.kind === "module" &&
              item.artifactId === requirement.moduleId &&
              moduleVersionSatisfies(item.version, requirement.versionRange) &&
              appVersionCompatible(
                currentAppVersion,
                item.manifest.appVersion,
              ) &&
              item.manifest.supportedGrids.includes(grid),
          );
    if (candidates.length === 0 && !requirement.required) continue;
    if (candidates.length !== 1) {
      throw new ModuleRuntimeError(
        candidates.length === 0
          ? "package-preset-unavailable"
          : "package-conflict",
        `preset/${preset.artifactId}/modules/${requirement.moduleId}`,
        { matchingVersions: candidates.map((item) => item.version).sort() },
      );
    }
    const candidate = candidates[0];
    if (candidate === undefined) {
      throw new ModuleRuntimeError(
        "package-preset-unavailable",
        `preset/${preset.artifactId}/modules/${requirement.moduleId}`,
      );
    }
    selected.push(candidate);
  }
  for (const identity of additionalModuleIdentities) {
    const module = packages.find(
      (item): item is ParsedModulePackage =>
        item.kind === "module" && packageIdentityKey(item) === identity,
    );
    if (module === undefined) {
      throw new ModuleRuntimeError("package-preset-unavailable", "modules", {
        identity,
      });
    }
    if (
      !selected.some(
        (item) =>
          item.artifactId === module.artifactId &&
          item.version === module.version,
      )
    ) {
      selected.push(module);
    }
  }
  return buildPackageRegistry([...selected, preset], {
    currentAppVersion,
    grid,
  });
}

export type InstalledPresetAvailability =
  "available" | "required-unavailable" | "version-conflict" | "incompatible";

/**
 * 新建页只消费稳定状态，不依赖错误消息文本。
 * 这里复用实际 Registry 构建，保证提交前提示与最终创建使用同一套依赖规则。
 */
export async function inspectInstalledPresetAvailability(
  packages: readonly ParsedExtensionPackage[],
  presetIdentity: string,
  currentAppVersion: string,
  grid: GridType,
): Promise<InstalledPresetAvailability> {
  const preset = packages.find(
    (item): item is ParsedPresetPackage =>
      item.kind === "preset" && packageIdentityKey(item) === presetIdentity,
  );
  if (preset === undefined) return "required-unavailable";
  for (const requirement of preset.manifest.modules) {
    const sameId =
      requirement.moduleId === BASIC_MODULE_PACKAGE.artifactId
        ? [BASIC_MODULE_PACKAGE]
        : packages.filter(
            (item): item is ParsedModulePackage =>
              item.kind === "module" &&
              item.artifactId === requirement.moduleId,
          );
    const matchingVersion = sameId.filter((item) =>
      moduleVersionSatisfies(item.version, requirement.versionRange),
    );
    const compatible = matchingVersion.filter(
      (item) =>
        appVersionCompatible(currentAppVersion, item.manifest.appVersion) &&
        item.manifest.supportedGrids.includes(grid),
    );
    if (compatible.length > 1) return "version-conflict";
    if (compatible.length === 0 && requirement.required) {
      return matchingVersion.length > 0
        ? "incompatible"
        : "required-unavailable";
    }
  }
  try {
    await buildRegistryForInstalledPreset(
      packages,
      presetIdentity,
      currentAppVersion,
      grid,
    );
    return "available";
  } catch (error) {
    const code =
      error instanceof ModuleRuntimeError
        ? error.code
        : "package-preset-unavailable";
    if (code === "package-conflict") return "version-conflict";
    if (
      code === "package-app-version-incompatible" ||
      code === "package-grid-incompatible"
    )
      return "incompatible";
    return "required-unavailable";
  }
}

/** 无预设时也必须用用户明确选择的精确模块版本建立 Registry。 */
export async function buildRegistryForInstalledModules(
  packages: readonly ParsedExtensionPackage[],
  moduleIdentities: readonly string[],
  currentAppVersion: string,
  grid: GridType,
): Promise<PackageRegistry> {
  const selected: ParsedExtensionPackage[] = [BASIC_MODULE_PACKAGE];
  for (const identity of moduleIdentities) {
    const module = packages.find(
      (item): item is ParsedModulePackage =>
        item.kind === "module" && packageIdentityKey(item) === identity,
    );
    if (module === undefined) {
      throw new ModuleRuntimeError("package-preset-unavailable", "modules", {
        identity,
      });
    }
    selected.push(module);
  }
  return buildPackageRegistry(selected, { currentAppVersion, grid });
}

/** Registry 到 Project/Fragment 共用 resolver 的只读适配。 */
export function createRegistryModuleResolver(
  registry: PackageRegistry,
): FragmentModuleResolver {
  return moduleResolver((moduleId, version) => {
    const module = registry.modules.get(moduleId)?.module;
    return module?.version === version ? module : undefined;
  });
}

function projectFromSelectedModules(
  state: ProjectState,
  registry: PackageRegistry,
  selected: readonly ParsedModulePackage[],
  currentAppVersion: string,
  layerOverrides: ReadonlyMap<
    string,
    {
      readonly visible: boolean;
      readonly locked: boolean;
      readonly opacity: number;
    }
  > = new Map(),
): ProjectState {
  const document = structuredClone(toProjectV1(state)) as ProjectV1Document;
  document.modules = selected
    .map((module) => ({
      moduleId: module.artifactId,
      version: module.version,
      packageSourceKind: packageSourceKind(module),
      extensions: {},
    }))
    .sort((left, right) => left.moduleId.localeCompare(right.moduleId));
  document.layerStates = selected
    .flatMap((module) =>
      module.manifest.layers.map((layer) => {
        const override = layerOverrides.get(layer.layerId);
        return {
          layerId: layer.layerId,
          moduleVersion: module.version,
          zIndex: layer.zIndex,
          visible: override?.visible ?? layer.defaultVisible,
          locked: override?.locked ?? layer.defaultLocked,
          opacity: override?.opacity ?? layer.defaultOpacity,
          extensions: {},
        };
      }),
    )
    .sort(
      (left, right) =>
        left.zIndex - right.zIndex || left.layerId.localeCompare(right.layerId),
    );
  return restoreProjectV1(stringifyProjectDocumentV1(document), {
    moduleResolver: createRegistryModuleResolver(registry),
    currentAppVersion,
    moduleResolutionMode: "strict",
  });
}

/** 将显式选择的模块写入工程；不依赖预设。 */
export function createProjectFromModules(
  state: ProjectState,
  registry: PackageRegistry,
  currentAppVersion: string,
): ProjectState {
  return projectFromSelectedModules(
    state,
    registry,
    [...registry.modules.values()].map((item) => item.module),
    currentAppVersion,
  );
}

/** 将预设选定的精确模块版本和固定层写入 Project v1，再经统一恢复器启用。 */
export function createProjectFromPreset(
  state: ProjectState,
  registry: PackageRegistry,
  presetId: string,
  currentAppVersion: string,
): ProjectState {
  const presetState = registry.presets.get(presetId);
  if (presetState === undefined || presetState.status !== "available") {
    throw new ModuleRuntimeError("package-preset-unavailable", "preset", {
      presetId,
    });
  }
  const preset = presetState.preset;
  if (!appVersionCompatible(currentAppVersion, preset.manifest.appVersion)) {
    throw new ModuleRuntimeError(
      "package-app-version-incompatible",
      "preset/" + presetId,
    );
  }
  if (!preset.manifest.grid.supportedGrids.includes(state.grid.type)) {
    throw new ModuleRuntimeError(
      "package-grid-incompatible",
      "preset/" + presetId,
      { grid: state.grid.type },
    );
  }
  if (
    state.grid.width < preset.manifest.grid.minWidth ||
    state.grid.width > preset.manifest.grid.maxWidth ||
    state.grid.height < preset.manifest.grid.minHeight ||
    state.grid.height > preset.manifest.grid.maxHeight
  ) {
    throw new ModuleRuntimeError(
      "package-grid-incompatible",
      "preset/" + presetId,
      {
        width: state.grid.width,
        height: state.grid.height,
        minWidth: preset.manifest.grid.minWidth,
        maxWidth: preset.manifest.grid.maxWidth,
        minHeight: preset.manifest.grid.minHeight,
        maxHeight: preset.manifest.grid.maxHeight,
      },
    );
  }
  const selected = preset.manifest.modules.flatMap((requirement) => {
    const module = registry.modules.get(requirement.moduleId)?.module;
    if (module === undefined) return [];
    if (!moduleVersionSatisfies(module.version, requirement.versionRange)) {
      return [];
    }
    return [module];
  });
  if (!selected.some((module) => module.artifactId === "tessera.basic")) {
    throw new ModuleRuntimeError("package-basic-required", "modules");
  }
  const presetLayers = new Map(
    preset.manifest.layerStates.map((layer) => [layer.layerId, layer]),
  );
  return projectFromSelectedModules(
    state,
    registry,
    selected,
    currentAppVersion,
    presetLayers,
  );
}
