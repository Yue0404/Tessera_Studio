import { EditorStore, type ProjectState } from "@tessera/core";
import {
  prepareExternalProjectV1,
  PROJECT_V1_MAX_FILE_BYTES,
  type PreparedExternalProjectV1,
} from "@tessera/formats";

export interface ProjectFileSource {
  readonly size: number;
  text(): Promise<string>;
}

export interface ProjectSaveTarget {
  save(state: Readonly<ProjectState>): Promise<unknown>;
}

export type SameProjectIdDecision = "copy" | "replace" | "cancel";

export interface SameProjectIdContext {
  readonly projectId: string;
  readonly projectName: string;
}

export interface ProjectFileImportOptions {
  readonly file: ProjectFileSource;
  readonly currentProjectId: string | null;
  readonly repository: ProjectSaveTarget;
  readonly decideSameProjectId?: (
    context: SameProjectIdContext,
  ) => SameProjectIdDecision | Promise<SameProjectIdDecision>;
}

export interface ProjectFileWorkflowDependencies {
  prepareExternalProject?(text: string): PreparedExternalProjectV1;
  beforeSave?(): boolean;
}

export type ProjectFileImportResult =
  | {
      readonly status: "loaded";
      readonly store: EditorStore;
      readonly identity: "copy" | "replace" | "preserved";
    }
  | { readonly status: "cancelled" };

export class ProjectFileWorkflowError extends Error {
  constructor(
    readonly code: string,
    readonly details: Readonly<Record<string, unknown>> = {},
    override readonly cause?: unknown,
  ) {
    super(code);
    this.name = "ProjectFileWorkflowError";
  }
}

function underlyingCode(error: unknown): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return null;
}

/** 完整校验并保存成功后才返回可替换当前 UI 的 EditorStore。 */
export async function importProjectFile(
  options: ProjectFileImportOptions,
  dependencies: ProjectFileWorkflowDependencies = {},
): Promise<ProjectFileImportResult> {
  if (
    !Number.isSafeInteger(options.file.size) ||
    options.file.size < 0 ||
    options.file.size > PROJECT_V1_MAX_FILE_BYTES
  ) {
    throw new ProjectFileWorkflowError("project-file-size-invalid", {
      actualBytes: options.file.size,
      maxBytes: PROJECT_V1_MAX_FILE_BYTES,
    });
  }

  let text: string;
  try {
    text = await options.file.text();
  } catch (error) {
    throw new ProjectFileWorkflowError("project-file-read-failed", {}, error);
  }

  let prepared: PreparedExternalProjectV1;
  try {
    prepared = (
      dependencies.prepareExternalProject ?? prepareExternalProjectV1
    )(text);
  } catch (error) {
    throw new ProjectFileWorkflowError(
      "project-file-invalid",
      { underlyingCode: underlyingCode(error) },
      error,
    );
  }
  const metadata = prepared.metadata;

  const sameFullProject =
    metadata.exportScope === "full" &&
    metadata.projectId === options.currentProjectId;
  let decision: SameProjectIdDecision = "copy";
  if (sameFullProject && options.decideSameProjectId !== undefined) {
    try {
      decision = await options.decideSameProjectId({
        projectId: metadata.projectId,
        projectName: metadata.name,
      });
    } catch (error) {
      throw new ProjectFileWorkflowError(
        "project-file-decision-failed",
        {},
        error,
      );
    }
  }
  if (decision === "cancel") return { status: "cancelled" };
  if (decision !== "copy" && decision !== "replace") {
    throw new ProjectFileWorkflowError("project-file-decision-invalid", {
      decision,
    });
  }

  let state: ProjectState;
  try {
    state = prepared.toState({
      currentProjectId: options.currentProjectId,
      sameProjectIdPolicy: sameFullProject ? decision : "copy",
    });
  } catch (error) {
    throw new ProjectFileWorkflowError(
      "project-file-invalid",
      { underlyingCode: underlyingCode(error) },
      error,
    );
  }
  const store = new EditorStore(state);
  if (dependencies.beforeSave?.() === false) return { status: "cancelled" };
  try {
    await options.repository.save(store.state);
  } catch (error) {
    throw new ProjectFileWorkflowError(
      "project-file-save-failed",
      {
        projectId: store.state.projectId,
        underlyingCode: underlyingCode(error),
      },
      error,
    );
  }

  const identity =
    state.projectId === metadata.projectId
      ? sameFullProject
        ? "replace"
        : "preserved"
      : "copy";
  return { status: "loaded", store, identity };
}

export function projectFileErrorTranslationKey(error: unknown): string {
  return error instanceof ProjectFileWorkflowError &&
    error.code === "project-file-size-invalid"
    ? "error.projectFileTooLarge"
    : error instanceof ProjectFileWorkflowError &&
        error.code === "project-file-save-failed"
      ? "error.projectFileSaveFailed"
      : "error.invalidProject";
}
