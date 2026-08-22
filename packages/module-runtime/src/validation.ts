import validateCatalog from "./catalog-validator.generated.js";
import validateCiv6Source from "./civ6-source-validator.generated.js";
import validateConstraints from "./constraint-validator.generated.js";
import validateElements from "./element-validator.generated.js";
import validateLocale from "./locale-validator.generated.js";
import validateMigration from "./migration-validator.generated.js";
import validateModule from "./module-validator.generated.js";
import validatePreset from "./preset-validator.generated.js";
import { runtimeError } from "./errors.js";
import type {
  Civ6SourceManifest,
  ContentCatalogManifest,
  ModuleConstraintDefinition,
  ModuleElementDefinition,
  ModuleManifest,
  ModuleMigrationManifest,
  PresetManifest,
} from "./types.js";

interface ValidationErrorLike {
  readonly instancePath?: string;
  readonly keyword?: string;
  readonly message?: string;
  readonly params?: unknown;
}

interface ValidatorLike {
  (value: unknown): boolean;
  readonly errors?: readonly ValidationErrorLike[] | null;
}

function assertSchema<T>(
  validator: ValidatorLike,
  value: unknown,
  rootPath: string,
): asserts value is T {
  if (validator(value)) return;
  const first = validator.errors?.[0];
  const suffix = first?.instancePath ?? "";
  runtimeError("package-schema-invalid", `${rootPath}${suffix}`, {
    keyword: first?.keyword ?? "unknown",
    message: first?.message ?? "schema validation failed",
    params: first?.params ?? null,
  });
}

export function validateModuleManifest(
  value: unknown,
  path = "module.json",
): asserts value is ModuleManifest {
  assertSchema<ModuleManifest>(validateModule, value, path);
}

export function validatePresetManifest(
  value: unknown,
  path = "preset.json",
): asserts value is PresetManifest {
  assertSchema<PresetManifest>(validatePreset, value, path);
}

export function validateCatalogManifest(
  value: unknown,
  path: string,
): asserts value is ContentCatalogManifest {
  assertSchema<ContentCatalogManifest>(validateCatalog, value, path);
}

export function validateMigrationManifest(
  value: unknown,
  path: string,
): asserts value is ModuleMigrationManifest {
  assertSchema<ModuleMigrationManifest>(validateMigration, value, path);
}

export function validateElementFile(
  value: unknown,
  path: string,
): asserts value is readonly ModuleElementDefinition[] {
  assertSchema<readonly ModuleElementDefinition[]>(
    validateElements,
    value,
    path,
  );
}

export function validateConstraintFile(
  value: unknown,
  path: string,
): asserts value is readonly ModuleConstraintDefinition[] {
  assertSchema<readonly ModuleConstraintDefinition[]>(
    validateConstraints,
    value,
    path,
  );
}

export function validateLocaleFile(
  value: unknown,
  path: string,
): asserts value is Readonly<Record<string, string>> {
  assertSchema<Readonly<Record<string, string>>>(validateLocale, value, path);
}

export function validateCiv6SourceManifest(
  value: unknown,
  path: string,
): asserts value is Civ6SourceManifest {
  assertSchema<Civ6SourceManifest>(validateCiv6Source, value, path);
}

const encoder = new TextEncoder();

function inspectJsonValue(value: unknown, path: string, depth: number): void {
  if (depth > 64)
    runtimeError("package-json-depth-exceeded", path, { maxDepth: 64 });
  if (typeof value === "string" && encoder.encode(value).byteLength > 1048576) {
    runtimeError("package-string-too-large", path, { maxBytes: 1048576 });
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      inspectJsonValue(item, `${path}/${index}`, depth + 1),
    );
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      inspectJsonValue(child, `${path}/${key}`, depth + 1);
    }
  }
}

export function parseJsonBytes(bytes: Uint8Array, path: string): unknown {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    runtimeError("package-json-invalid", path, {}, error);
  }
  inspectJsonValue(value, path, 0);
  return value;
}
