import type { GridType } from "@tessera/core";
import { runtimeError } from "./errors.js";
import { deepFreeze, ImmutableMap } from "./immutable.js";
import { appVersionCompatible, moduleVersionSatisfies } from "./semantic.js";
import { packageSourcesEquivalent } from "./source.js";
import type {
  PackageRegistry,
  ParsedExtensionPackage,
  ParsedModulePackage,
  ParsedPresetPackage,
  RegistryModuleState,
  RegistryPresetState,
} from "./types.js";

export interface BuildPackageRegistryOptions {
  readonly currentAppVersion: string;
  readonly grid?: GridType;
}

async function uniqueArtifacts(
  packages: readonly ParsedExtensionPackage[],
): Promise<readonly ParsedExtensionPackage[]> {
  const byIdentity = new Map<string, ParsedExtensionPackage>();
  const byArtifact = new Map<string, ParsedExtensionPackage>();
  for (const artifact of packages) {
    const identity = `${artifact.kind}:${artifact.artifactId}@${artifact.version}`;
    const existing = byIdentity.get(identity);
    if (existing !== undefined) {
      if (!(await packageSourcesEquivalent(existing, artifact))) {
        runtimeError("package-version-reuse", "packages", {
          kind: artifact.kind,
          artifactId: artifact.artifactId,
          version: artifact.version,
        });
      }
      continue;
    }
    const other = byArtifact.get(artifact.artifactId);
    if (other !== undefined) {
      runtimeError("package-conflict", "packages", {
        artifactId: artifact.artifactId,
        identities: [
          `${other.kind}@${other.version}`,
          `${artifact.kind}@${artifact.version}`,
        ],
      });
    }
    byIdentity.set(identity, artifact);
    byArtifact.set(artifact.artifactId, artifact);
  }
  return [...byIdentity.values()];
}

function assertModuleConflicts(modules: readonly ParsedModulePackage[]): void {
  const owners = new Map<string, string>();
  const claim = (id: string, owner: string, path: string) => {
    const existing = owners.get(id);
    if (existing !== undefined && existing !== owner) {
      runtimeError("package-conflict", path, { id, owners: [existing, owner] });
    }
    owners.set(id, owner);
  };
  modules.forEach((module) => {
    const owner = module.artifactId;
    module.manifest.layers.forEach((layer) =>
      claim(layer.layerId, owner, "layers"),
    );
    module.manifest.resources.forEach((resource) =>
      claim(resource.resourceId, owner, "resources"),
    );
    module.elements.forEach((element) => {
      claim(element.elementId, owner, "elements");
      element.occupancy.forEach((occupancy) =>
        claim(occupancy.slotId, owner, "occupancy"),
      );
    });
    module.constraints.forEach((constraint) =>
      claim(constraint.constraintId, owner, "constraints"),
    );
  });
}

function moduleLoadOrder(
  modules: ReadonlyMap<string, ParsedModulePackage>,
): readonly string[] {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const order: string[] = [];
  const visit = (moduleId: string, chain: readonly string[]) => {
    if (visited.has(moduleId)) return;
    if (visiting.has(moduleId)) {
      runtimeError("package-dependency-cycle", "dependencies", {
        chain: [...chain, moduleId],
      });
    }
    const module = modules.get(moduleId);
    if (module === undefined) return;
    visiting.add(moduleId);
    for (const dependency of module.manifest.dependencies) {
      if (modules.has(dependency.moduleId)) {
        visit(dependency.moduleId, [...chain, moduleId]);
      }
    }
    visiting.delete(moduleId);
    visited.add(moduleId);
    order.push(moduleId);
  };
  [...modules.keys()].sort().forEach((moduleId) => visit(moduleId, []));
  return Object.freeze(order);
}

function presetState(
  preset: ParsedPresetPackage,
  modules: ReadonlyMap<string, ParsedModulePackage>,
  options: BuildPackageRegistryOptions,
): RegistryPresetState {
  const moduleStates = preset.manifest.modules.map((requirement) => {
    const module = modules.get(requirement.moduleId);
    const status =
      module === undefined
        ? ("missing" as const)
        : !moduleVersionSatisfies(module.version, requirement.versionRange) ||
            !appVersionCompatible(
              options.currentAppVersion,
              module.manifest.appVersion,
            ) ||
            !module.manifest.supportedGrids.some((grid) =>
              preset.manifest.grid.supportedGrids.includes(grid),
            )
          ? ("incompatible" as const)
          : ("available" as const);
    return deepFreeze({ moduleId: requirement.moduleId, status });
  });
  const requiredUnavailable = preset.manifest.modules.some(
    (requirement, index) =>
      requirement.required && moduleStates[index]?.status !== "available",
  );
  const availableLayerIds = new Set(
    moduleStates.flatMap((state) =>
      state.status === "available"
        ? (modules
            .get(state.moduleId)
            ?.manifest.layers.map((layer) => layer.layerId) ?? [])
        : [],
    ),
  );
  const hasUnknownLayer = preset.manifest.layerStates.some(
    (layerState) => !availableLayerIds.has(layerState.layerId),
  );
  const ownIncompatible =
    !appVersionCompatible(
      options.currentAppVersion,
      preset.manifest.appVersion,
    ) ||
    (options.grid !== undefined &&
      !preset.manifest.grid.supportedGrids.includes(options.grid));
  const status = hasUnknownLayer
    ? "corrupted"
    : ownIncompatible
      ? "incompatible"
      : requiredUnavailable
        ? moduleStates.some((state) => state.status === "missing")
          ? "missing"
          : "incompatible"
        : "available";
  return deepFreeze({
    preset,
    status,
    moduleStates: Object.freeze(moduleStates),
  });
}

export async function buildPackageRegistry(
  input: readonly ParsedExtensionPackage[],
  options: BuildPackageRegistryOptions,
): Promise<PackageRegistry> {
  const packages = await uniqueArtifacts(input);
  const modules = packages.filter(
    (artifact): artifact is ParsedModulePackage => artifact.kind === "module",
  );
  const presets = packages.filter(
    (artifact): artifact is ParsedPresetPackage => artifact.kind === "preset",
  );
  const modulesById = new Map(
    modules.map((module) => [module.artifactId, module]),
  );
  const basic = modulesById.get("tessera.basic");
  if (basic === undefined) runtimeError("package-basic-required", "modules");
  assertModuleConflicts(modules);
  const moduleStates = new Map<string, RegistryModuleState>();
  modules.forEach((module) => {
    if (
      !appVersionCompatible(
        options.currentAppVersion,
        module.manifest.appVersion,
      )
    ) {
      runtimeError(
        "package-app-version-incompatible",
        `modules/${module.artifactId}`,
      );
    }
    if (
      options.grid !== undefined &&
      !module.manifest.supportedGrids.includes(options.grid)
    ) {
      runtimeError(
        "package-grid-incompatible",
        `modules/${module.artifactId}`,
        {
          grid: options.grid,
        },
      );
    }
    const optionalDependenciesMissing: string[] = [];
    module.manifest.dependencies.forEach((dependency) => {
      const resolved = modulesById.get(dependency.moduleId);
      if (resolved === undefined) {
        if (dependency.optional)
          optionalDependenciesMissing.push(dependency.moduleId);
        else {
          runtimeError(
            "package-dependency-missing",
            `modules/${module.artifactId}/dependencies`,
            {
              moduleId: dependency.moduleId,
            },
          );
        }
      } else if (
        !moduleVersionSatisfies(resolved.version, dependency.versionRange)
      ) {
        if (dependency.optional)
          optionalDependenciesMissing.push(dependency.moduleId);
        else {
          runtimeError(
            "package-dependency-version-incompatible",
            `modules/${module.artifactId}/dependencies`,
            { moduleId: dependency.moduleId, actualVersion: resolved.version },
          );
        }
      }
    });
    moduleStates.set(
      module.artifactId,
      deepFreeze({
        module,
        optionalDependenciesMissing: Object.freeze(
          optionalDependenciesMissing.sort(),
        ),
      }),
    );
  });
  const loadOrder = moduleLoadOrder(modulesById);
  const readonlyModules = new ImmutableMap(moduleStates);
  const presetStates = new ImmutableMap(
    presets.map((preset) => [
      preset.artifactId,
      presetState(preset, modulesById, options),
    ]),
  );
  return Object.freeze({
    modules: readonlyModules,
    presets: presetStates,
    loadOrder,
    basicModule: readonlyModules.get("tessera.basic") as RegistryModuleState,
  });
}
