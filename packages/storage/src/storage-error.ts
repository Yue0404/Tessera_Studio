export type StorageUiAction =
  "export-project" | "free-space" | "retry" | "reimport-package";

export type StorageErrorCode =
  | "project-save-input-invalid"
  | "project-save-failed"
  | "project-load-failed"
  | "storage-estimate-unavailable"
  | "storage-quota-insufficient"
  | "storage-quota-write-failed"
  | "opfs-unavailable"
  | "opfs-operation-failed"
  | "local-package-input-invalid"
  | "local-package-path-invalid"
  | "local-package-byte-count-mismatch"
  | "local-package-install-concurrent"
  | "local-package-install-failed"
  | "local-package-database-failed"
  | "local-package-finalize-failed"
  | "local-package-not-found"
  | "local-package-not-ready"
  | "local-package-query-failed"
  | "local-package-storage-corrupted"
  | "local-package-delete-failed"
  | "local-package-recovery-failed";

export class StorageRepositoryError extends Error {
  readonly issues: readonly unknown[] = [];
  override readonly cause: unknown;

  constructor(
    readonly code: StorageErrorCode,
    readonly details: Readonly<Record<string, unknown>>,
    readonly uiAction: StorageUiAction,
    cause?: unknown,
  ) {
    super(code);
    this.name = "StorageRepositoryError";
    // cause 供诊断链读取，但不可枚举，避免日志/JSON 意外泄露原生错误消息。
    Object.defineProperty(this, "cause", {
      value: cause,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }
}

export function isQuotaExceededError(error: unknown): boolean {
  return (
    (error instanceof DOMException &&
      (error.name === "QuotaExceededError" || error.code === 22)) ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "QuotaExceededError")
  );
}

export function toStorageRepositoryError(
  error: unknown,
  fallbackCode: StorageErrorCode,
  details: Readonly<Record<string, unknown>>,
  uiAction: StorageUiAction,
): StorageRepositoryError {
  if (error instanceof StorageRepositoryError) return error;
  if (isQuotaExceededError(error)) {
    return new StorageRepositoryError(
      "storage-quota-write-failed",
      details,
      "free-space",
      error,
    );
  }
  return new StorageRepositoryError(fallbackCode, details, uiAction, error);
}
