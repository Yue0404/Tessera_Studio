import type { ProjectState } from "@tessera/core";
import {
  createFragmentFromStateV1,
  createPartialProjectFromStateV1,
  FRAGMENT_EXTENSION,
  FRAGMENT_MIME,
  PROJECT_EXTENSION,
  PROJECT_MIME,
  stringifyFragmentV1,
  stringifyProjectDocumentV1,
  stringifyProjectV1,
} from "@tessera/formats";

export interface DataExportBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export type DataExportRequest =
  | { readonly kind: "full-project" }
  | {
      readonly kind: "partial-project";
      readonly bounds: DataExportBounds;
      readonly includedLayerIds: readonly string[];
    }
  | {
      readonly kind: "fragment";
      readonly bounds: DataExportBounds;
      readonly includedLayerIds: readonly string[];
      readonly fragmentId: string;
    };

export interface DataExportArtifact {
  readonly blob: Blob;
  readonly filename: string;
  readonly mime: string;
}

export interface DownloadDependencies {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  click(url: string, filename: string): void;
}

export class DataExportWorkflowError extends Error {
  constructor(
    readonly code: string,
    override readonly cause?: unknown,
  ) {
    super(code);
    this.name = "DataExportWorkflowError";
  }
}

function safeFilename(name: string): string {
  const safe = name.trim().replaceAll(/[\\/:*?"<>|]/g, "_");
  return safe.length === 0 ? "tessera-project" : safe;
}

function textArtifact(text: string, mime: string, filename: string) {
  return { blob: new Blob([text], { type: mime }), filename, mime };
}

/** 只生成下载产物，不修改编辑态。 */
export function createDataExportArtifact(
  state: Readonly<ProjectState>,
  request: DataExportRequest,
): DataExportArtifact {
  try {
    const baseName = safeFilename(state.name);
    if (request.kind === "full-project") {
      return textArtifact(
        stringifyProjectV1(state, { mode: "full" }),
        PROJECT_MIME,
        `${baseName}${PROJECT_EXTENSION}`,
      );
    }
    if (request.kind === "partial-project") {
      const document = createPartialProjectFromStateV1(state, request);
      return textArtifact(
        stringifyProjectDocumentV1(document),
        PROJECT_MIME,
        `${baseName}.partial${PROJECT_EXTENSION}`,
      );
    }
    const fragment = createFragmentFromStateV1(state, request);
    return textArtifact(
      stringifyFragmentV1(fragment),
      FRAGMENT_MIME,
      `${baseName}${FRAGMENT_EXTENSION}`,
    );
  } catch (error) {
    const underlyingCode =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : "data-export-failed";
    throw new DataExportWorkflowError(underlyingCode, error);
  }
}

const browserDownloadDependencies: DownloadDependencies = {
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
  click: (url, filename) => {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
  },
};

/** URL 只覆盖同步 click，成功或失败都会释放。 */
export function downloadDataExportArtifact(
  artifact: DataExportArtifact,
  dependencies: DownloadDependencies = browserDownloadDependencies,
): void {
  let url: string;
  try {
    url = dependencies.createObjectURL(artifact.blob);
  } catch (error) {
    throw new DataExportWorkflowError("data-export-download-failed", error);
  }
  try {
    dependencies.click(url, artifact.filename);
  } catch (error) {
    throw new DataExportWorkflowError("data-export-download-failed", error);
  } finally {
    dependencies.revokeObjectURL(url);
  }
}

export function dataExportErrorTranslationKey(error: unknown): string {
  if (!(error instanceof DataExportWorkflowError)) {
    return "error.dataExportFailed";
  }
  if (error.code === "export-selection-empty") {
    return "error.dataExportEmpty";
  }
  if (
    error.code.includes("bounds") ||
    error.code.includes("selection") ||
    error.code.includes("layer")
  ) {
    return "error.dataExportSelectionInvalid";
  }
  return "error.dataExportFailed";
}
