import { EditorStore, type ProjectState } from "@tessera/core";
import type { ParsedExtensionPackage } from "@tessera/module-runtime";
import { setProjectModuleEnabled } from "./package-project-runtime.js";

export interface ProjectModuleSaveTarget {
  save(state: Readonly<ProjectState>): Promise<unknown>;
}

export interface ProjectModuleChange {
  readonly moduleId: string;
  readonly version: string;
  readonly enabled: boolean;
}

/**
 * 候选工程持久化成功后才返回新 Store；调用方不得提前替换当前界面状态。
 */
export async function commitProjectModuleChange(
  state: ProjectState,
  packages: readonly ParsedExtensionPackage[],
  change: ProjectModuleChange,
  currentAppVersion: string,
  repository: ProjectModuleSaveTarget,
  validateState?: (state: Readonly<ProjectState>) => void,
): Promise<EditorStore> {
  const candidate = await setProjectModuleEnabled(
    state,
    packages,
    change.moduleId,
    change.version,
    change.enabled,
    currentAppVersion,
  );
  validateState?.(candidate);
  const nextStore = new EditorStore(candidate);
  await repository.save(nextStore.state);
  return nextStore;
}
