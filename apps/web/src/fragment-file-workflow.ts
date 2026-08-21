import { EditorStore, type ProjectState } from "@tessera/core";
import {
  applyFragmentMerge,
  parseFragmentV1,
  planFragmentMerge,
  PROJECT_V1_MAX_FILE_BYTES,
  restoreProjectV1,
  stringifyProjectDocumentV1,
  toProjectV1,
  type FragmentMergePlan,
  type FragmentTranslation,
  type FragmentV1Document,
  type ProjectV1Document,
} from "@tessera/formats";
import type { ProjectSaveTarget } from "./project-file-workflow.js";

const CURRENT_APP_VERSION = "0.0.0";

export interface FragmentFileSource {
  readonly size: number;
  text(): Promise<string>;
}

export interface PreparedFragmentMerge {
  readonly fragment: FragmentV1Document;
  readonly target: ProjectV1Document;
  readonly plan: FragmentMergePlan;
}

export class FragmentFileWorkflowError extends Error {
  constructor(
    readonly code: string,
    readonly details: Readonly<Record<string, unknown>> = {},
    override readonly cause?: unknown,
  ) {
    super(code);
    this.name = "FragmentFileWorkflowError";
  }
}

function underlyingCode(error: unknown): string | null {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : null;
}

/** 文件尺寸在读取正文前检查，避免为超大输入分配字符串。 */
export async function readFragmentFile(
  file: FragmentFileSource,
): Promise<FragmentV1Document> {
  if (
    !Number.isSafeInteger(file.size) ||
    file.size < 0 ||
    file.size > PROJECT_V1_MAX_FILE_BYTES
  ) {
    throw new FragmentFileWorkflowError("fragment-file-size-invalid", {
      actualBytes: file.size,
      maxBytes: PROJECT_V1_MAX_FILE_BYTES,
    });
  }
  let text: string;
  try {
    text = await file.text();
  } catch (error) {
    throw new FragmentFileWorkflowError("fragment-file-read-failed", {}, error);
  }
  try {
    return parseFragmentV1(text);
  } catch (error) {
    throw new FragmentFileWorkflowError(
      "fragment-file-invalid",
      { underlyingCode: underlyingCode(error) },
      error,
    );
  }
}

export function prepareFragmentMerge(
  state: Readonly<ProjectState>,
  fragment: FragmentV1Document,
  translation?: FragmentTranslation,
): PreparedFragmentMerge {
  const target = toProjectV1(state, { mode: "preserve" });
  const plan = planFragmentMerge(target, fragment, {
    currentAppVersion: CURRENT_APP_VERSION,
    ...(translation === undefined ? {} : { translation }),
  });
  return { target, fragment, plan };
}

/** 合并与保存均成功后才返回可替换当前界面的 store。 */
export async function commitFragmentMerge(
  prepared: PreparedFragmentMerge,
  repository: ProjectSaveTarget,
): Promise<EditorStore> {
  if (prepared.plan.status !== "ready") {
    throw new FragmentFileWorkflowError("fragment-merge-not-ready", {
      status: prepared.plan.status,
    });
  }
  let store: EditorStore;
  try {
    const result = applyFragmentMerge(
      prepared.target,
      prepared.fragment,
      prepared.plan,
      { currentAppVersion: CURRENT_APP_VERSION },
    );
    store = new EditorStore(
      restoreProjectV1(stringifyProjectDocumentV1(result.project)),
    );
  } catch (error) {
    throw new FragmentFileWorkflowError(
      "fragment-merge-failed",
      { underlyingCode: underlyingCode(error) },
      error,
    );
  }
  try {
    await repository.save(store.state);
  } catch (error) {
    throw new FragmentFileWorkflowError(
      "fragment-merge-save-failed",
      {
        projectId: store.state.projectId,
        underlyingCode: underlyingCode(error),
      },
      error,
    );
  }
  return store;
}

export function fragmentFileErrorTranslationKey(error: unknown): string {
  if (!(error instanceof FragmentFileWorkflowError)) {
    return "error.fragmentInvalid";
  }
  if (error.code === "fragment-file-size-invalid") {
    return "error.fragmentTooLarge";
  }
  if (error.code === "fragment-merge-save-failed") {
    return "error.fragmentSaveFailed";
  }
  if (error.code === "fragment-merge-not-ready") {
    return "error.fragmentMergeNotReady";
  }
  return error.code === "fragment-file-invalid"
    ? "error.fragmentInvalid"
    : "error.fragmentMergeFailed";
}
