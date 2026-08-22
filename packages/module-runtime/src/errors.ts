export type ModuleRuntimeErrorCode =
  | "package-aborted"
  | "package-path-invalid"
  | "package-path-duplicate"
  | "package-entry-invalid"
  | "package-file-missing"
  | "package-file-undeclared"
  | "package-json-invalid"
  | "package-json-depth-exceeded"
  | "package-string-too-large"
  | "package-schema-invalid"
  | "package-source-mismatch"
  | "package-resource-invalid"
  | "package-resource-decoder-unavailable"
  | "package-resource-decode-failed"
  | "package-resource-license-invalid"
  | "package-profile-unknown"
  | "package-source-path-leak"
  | "package-content-hash-forbidden"
  | "package-localized-key-missing"
  | "package-locale-invalid"
  | "package-id-namespace-invalid"
  | "package-duplicate-id"
  | "package-reference-missing"
  | "package-reference-cross-module"
  | "package-style-invalid"
  | "package-attribute-schema-invalid"
  | "package-constraint-invalid"
  | "package-catalog-invalid"
  | "package-version-invalid"
  | "package-version-reuse"
  | "package-app-version-incompatible"
  | "package-grid-incompatible"
  | "package-dependency-missing"
  | "package-dependency-version-incompatible"
  | "package-dependency-cycle"
  | "package-conflict"
  | "package-basic-required"
  | "package-preset-unavailable"
  | "package-migration-invalid"
  | "package-migration-cycle"
  | "package-migration-ambiguous";

export class ModuleRuntimeError extends Error {
  constructor(
    readonly code: ModuleRuntimeErrorCode,
    readonly path: string,
    readonly details: Readonly<Record<string, unknown>> = {},
    override readonly cause?: unknown,
  ) {
    super(`${code}:${path}`);
    this.name = "ModuleRuntimeError";
  }
}

export function runtimeError(
  code: ModuleRuntimeErrorCode,
  path: string,
  details: Readonly<Record<string, unknown>> = {},
  cause?: unknown,
): never {
  throw new ModuleRuntimeError(code, path, details, cause);
}
