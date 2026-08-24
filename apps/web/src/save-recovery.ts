import type { ProjectState } from "@tessera/core";

export type SaveFailureKey =
  "error.saveStorageUnavailable" | "error.saveQuotaExceeded";

export function saveFailureTranslationKey(error: unknown): SaveFailureKey {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
  return code.includes("quota")
    ? "error.saveQuotaExceeded"
    : "error.saveStorageUnavailable";
}

/** 故障恢复导出复用完整 Project v1 工作流，不写入本地存储。 */
export async function downloadSaveRecoveryProject(
  state: Readonly<ProjectState>,
): Promise<void> {
  const workflow = await import("./data-export-workflow.js");
  workflow.downloadDataExportArtifact(
    workflow.createDataExportArtifact(state, { kind: "full-project" }),
  );
}
