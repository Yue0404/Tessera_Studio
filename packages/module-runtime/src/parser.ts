import { ModuleRuntimeError, runtimeError } from "./errors.js";
import { cloneJson, deepFreeze } from "./immutable.js";
import {
  validateCatalogProfileConsistency,
  validateCatalogSemantics,
  validateGeneratedLocalProfile,
  validateLocalizedTexts,
  validateMigrations,
  validateModuleSemantics,
  validatePresetSemantics,
} from "./semantic.js";
import {
  normalizePackagePath,
  readPackageFileBytes,
  readPackageSource,
  throwIfPackageAborted,
} from "./source.js";
import type {
  Civ6SourceManifest,
  ContentCatalogManifest,
  ExtensionPackageSource,
  ModuleConstraintDefinition,
  ModuleElementDefinition,
  ModuleManifest,
  ModuleMigrationManifest,
  PackageFile,
  PackageFileDescriptor,
  PackageFileSet,
  PackageResourceAccess,
  ParsedExtensionPackage,
  ParsedModulePackage,
  ParsedPresetPackage,
  PresetManifest,
  ResourceDecodeGateway,
} from "./types.js";
import {
  parseJsonBytes,
  validateCatalogManifest,
  validateCiv6SourceManifest,
  validateConstraintFile,
  validateElementFile,
  validateLocaleFile,
  validateMigrationManifest,
  validateModuleManifest,
  validatePresetManifest,
} from "./validation.js";

const MIME_EXTENSION: Readonly<Record<string, string>> = {
  "image/png": ".png",
  "image/webp": ".webp",
  "font/woff2": ".woff2",
  "application/json": ".json",
};

function fileMap(
  files: readonly PackageFile[],
): ReadonlyMap<string, Uint8Array> {
  const result = new Map<string, Uint8Array>();
  for (const file of files) {
    const path = normalizePackagePath(file.path);
    if (result.has(path)) runtimeError("package-path-duplicate", path);
    result.set(path, file.bytes);
  }
  return result;
}

function requiredFile(
  files: ReadonlyMap<string, Uint8Array>,
  path: string,
): Uint8Array {
  const normalized = normalizePackagePath(path);
  const bytes = files.get(normalized);
  if (bytes === undefined) runtimeError("package-file-missing", normalized);
  return bytes;
}

function assertUnder(path: string, root: string): void {
  if (!path.startsWith(root) || !path.endsWith(".json")) {
    runtimeError("package-path-invalid", path, { expectedRoot: root });
  }
}

function assertFileLimits(
  files: readonly PackageFileDescriptor[],
  sourceKind: "built-in" | "user-file" | "generated-local",
): void {
  const generated = sourceKind === "generated-local";
  const maxFiles = generated ? 65536 : 4096;
  const maxTotal = generated ? 2 * 1024 ** 3 : 128 * 1024 ** 2;
  if (files.length > maxFiles) {
    runtimeError("package-resource-invalid", "package", { maxFiles });
  }
  let total = 0;
  for (const file of files) {
    total += file.bytes;
    if (!Number.isSafeInteger(total) || total > maxTotal) {
      runtimeError("package-resource-invalid", "package", { maxTotal });
    }
    const jsonMax = generated ? 32 * 1024 ** 2 : 8 * 1024 ** 2;
    if (file.path.endsWith(".json") && file.bytes > jsonMax) {
      runtimeError("package-resource-invalid", file.path, {
        maxBytes: jsonMax,
      });
    }
  }
}

function memoryResourceAccess(fileSet: PackageFileSet): PackageResourceAccess {
  const files = fileMap(fileSet.files);
  const descriptors = Object.freeze(
    [...files.entries()]
      .map(([path, bytes]) => Object.freeze({ path, bytes: bytes.byteLength }))
      .sort((left, right) =>
        left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
      ),
  );
  return Object.freeze({
    origin: fileSet.origin,
    files: descriptors,
    async *openFile(path: string, signal?: AbortSignal) {
      throwIfPackageAborted(signal);
      const normalized = normalizePackagePath(path);
      const bytes = files.get(normalized);
      if (bytes === undefined) runtimeError("package-file-missing", normalized);
      yield new Uint8Array(bytes);
      throwIfPackageAborted(signal);
    },
  });
}

function startsWith(bytes: Uint8Array, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

function validateResourceBytes(
  resource: ModuleManifest["resources"][number],
  bytes: Uint8Array,
  path: string,
): void {
  if (resource.bytes !== bytes.byteLength) {
    runtimeError("package-resource-invalid", path, {
      declaredBytes: resource.bytes,
      actualBytes: bytes.byteLength,
    });
  }
  validateResourceHeader(resource, bytes, path);
  if (resource.mimeType === "application/json") parseJsonBytes(bytes, path);
}

function validateResourceHeader(
  resource: ModuleManifest["resources"][number],
  bytes: Uint8Array,
  path: string,
): void {
  const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
  if (extension !== MIME_EXTENSION[resource.mimeType]) {
    runtimeError("package-resource-invalid", path, {
      mimeType: resource.mimeType,
    });
  }
  const valid =
    resource.mimeType === "image/png"
      ? startsWith(bytes, [137, 80, 78, 71, 13, 10, 26, 10])
      : resource.mimeType === "image/webp"
        ? ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP"
        : resource.mimeType === "font/woff2"
          ? ascii(bytes, 0, 4) === "wOF2"
          : true;
  if (!valid)
    runtimeError("package-resource-invalid", path, { reason: "magic" });
  if (
    resource.mimeType === "image/webp" &&
    (ascii(bytes, 12, Math.min(bytes.length - 12, 256)).includes("ANIM") ||
      (ascii(bytes, 12, 4) === "VP8X" && ((bytes[20] ?? 0) & 0x02) !== 0))
  ) {
    runtimeError("package-resource-invalid", path, { reason: "animated-webp" });
  }
}

function parseLocales(
  manifest: ModuleManifest | PresetManifest,
  files: ReadonlyMap<string, Uint8Array>,
  declared: Set<string>,
): Readonly<Record<string, Readonly<Record<string, string>>>> {
  const locales: Record<string, Readonly<Record<string, string>>> = {};
  for (const [language, path] of Object.entries(manifest.locales)) {
    const bytes = requiredFile(files, path);
    const value = parseJsonBytes(bytes, path);
    validateLocaleFile(value, path);
    locales[language] = cloneJson(value);
    declared.add(path);
  }
  return locales;
}

function assertDeclaredClosure(
  files: readonly PackageFileDescriptor[],
  declared: Set<string>,
): void {
  for (const file of files) {
    if (!declared.has(file.path))
      runtimeError("package-file-undeclared", file.path);
  }
}

function parseModulePackage(
  fileSet: PackageFileSet,
  files: ReadonlyMap<string, Uint8Array>,
  rawManifest: unknown,
  resources = memoryResourceAccess(fileSet),
  resourcesAlreadyValidated = false,
): ParsedModulePackage {
  validateModuleManifest(rawManifest);
  const manifest = cloneJson(rawManifest);
  if (
    (fileSet.origin === "built-in" &&
      manifest.packageSource.kind !== "built-in") ||
    (fileSet.origin === "user-file" &&
      manifest.packageSource.kind === "built-in")
  ) {
    runtimeError("package-source-mismatch", "module.json/packageSource/kind", {
      origin: fileSet.origin,
      declared: manifest.packageSource.kind,
    });
  }
  assertFileLimits(resources.files, manifest.packageSource.kind);
  const manifestMax =
    manifest.packageSource.kind === "generated-local"
      ? 8 * 1024 ** 2
      : 1024 ** 2;
  if ((files.get("module.json")?.byteLength ?? 0) > manifestMax) {
    runtimeError("package-resource-invalid", "module.json", {
      maxBytes: manifestMax,
    });
  }
  const declared = new Set(["module.json"]);
  const elements: ModuleElementDefinition[] = [];
  manifest.elementFiles.forEach((path) => {
    assertUnder(path, "elements/");
    const value = parseJsonBytes(requiredFile(files, path), path);
    validateElementFile(value, path);
    elements.push(...cloneJson(value));
    declared.add(path);
  });
  const constraints: ModuleConstraintDefinition[] = [];
  manifest.constraintFiles.forEach((path) => {
    assertUnder(path, "constraints/");
    const value = parseJsonBytes(requiredFile(files, path), path);
    validateConstraintFile(value, path);
    constraints.push(...cloneJson(value));
    declared.add(path);
  });
  const migrations: ModuleMigrationManifest[] = [];
  manifest.migrationFiles.forEach((path) => {
    assertUnder(path, "migrations/");
    const value = parseJsonBytes(requiredFile(files, path), path);
    validateMigrationManifest(value, path);
    migrations.push(cloneJson(value));
    declared.add(path);
  });
  let catalog: ContentCatalogManifest | null = null;
  if (manifest.catalogManifestPath !== null) {
    assertUnder(manifest.catalogManifestPath, "catalog/");
    const value = parseJsonBytes(
      requiredFile(files, manifest.catalogManifestPath),
      manifest.catalogManifestPath,
    );
    validateCatalogManifest(value, manifest.catalogManifestPath);
    catalog = cloneJson(value);
    declared.add(manifest.catalogManifestPath);
  }
  if (
    manifest.capabilities.includes("content-catalog") !==
    (manifest.catalogManifestPath !== null)
  ) {
    runtimeError("package-catalog-invalid", "module.json/catalogManifestPath");
  }
  const locales = parseLocales(manifest, files, declared);
  let sourceManifest: Civ6SourceManifest | null = null;
  if (
    manifest.packageSource.kind === "generated-local" &&
    manifest.packageSource.sourceManifestPath !== null
  ) {
    const sourcePath = manifest.packageSource.sourceManifestPath;
    assertUnder(sourcePath, "provenance/");
    const value = parseJsonBytes(requiredFile(files, sourcePath), sourcePath);
    validateCiv6SourceManifest(value, sourcePath);
    sourceManifest = cloneJson(value);
    declared.add(sourcePath);
  }
  const maxResourceBytes =
    manifest.packageSource.kind === "generated-local"
      ? 64 * 1024 ** 2
      : 16 * 1024 ** 2;
  manifest.resources.forEach((resource, index) => {
    const path = normalizePackagePath(resource.path);
    if (!path.startsWith("assets/")) runtimeError("package-path-invalid", path);
    const descriptor = resources.files.find((item) => item.path === path);
    if (descriptor === undefined) runtimeError("package-file-missing", path);
    if (descriptor.bytes > maxResourceBytes) {
      runtimeError("package-resource-invalid", path, {
        maxBytes: maxResourceBytes,
      });
    }
    if (
      resource.license.status === "prohibited" ||
      (resource.license.status === "local-only" &&
        manifest.packageSource.kind !== "generated-local")
    ) {
      runtimeError(
        "package-resource-license-invalid",
        `module.json/resources/${index}/license`,
      );
    }
    if (!resourcesAlreadyValidated)
      validateResourceBytes(resource, requiredFile(files, path), path);
    declared.add(path);
  });
  validateModuleSemantics(manifest, elements, constraints);
  validateMigrations(manifest, migrations);
  if (catalog !== null) validateCatalogSemantics(manifest, catalog, elements);
  validateGeneratedLocalProfile(manifest, sourceManifest);
  validateCatalogProfileConsistency(manifest, catalog);
  validateLocalizedTexts(manifest, locales, [
    ...elements.flatMap((element) => [element.nameKey, element.descriptionKey]),
    ...constraints.map((constraint) => constraint.messageKey),
    ...(catalog?.categories.map((category) => category.nameKey) ?? []),
  ]);
  assertDeclaredClosure(resources.files, declared);
  return deepFreeze({
    kind: "module",
    artifactId: manifest.moduleId,
    version: manifest.version,
    manifest,
    elements,
    constraints,
    migrations,
    catalog,
    locales,
    resources,
  });
}

function parsePresetPackage(
  fileSet: PackageFileSet,
  files: ReadonlyMap<string, Uint8Array>,
  rawManifest: unknown,
  resources = memoryResourceAccess(fileSet),
): ParsedPresetPackage {
  validatePresetManifest(rawManifest);
  const manifest = cloneJson(rawManifest);
  if (
    manifest.packageSource.kind === "generated-local" ||
    (fileSet.origin === "built-in" &&
      manifest.packageSource.kind !== "built-in") ||
    (fileSet.origin === "user-file" &&
      manifest.packageSource.kind === "built-in")
  ) {
    runtimeError("package-source-mismatch", "preset.json/packageSource/kind", {
      origin: fileSet.origin,
      declared: manifest.packageSource.kind,
    });
  }
  assertFileLimits(resources.files, manifest.packageSource.kind);
  if ((files.get("preset.json")?.byteLength ?? 0) > 1024 ** 2) {
    runtimeError("package-resource-invalid", "preset.json", {
      maxBytes: 1024 ** 2,
    });
  }
  const declared = new Set(["preset.json"]);
  const locales = parseLocales(manifest, files, declared);
  validatePresetSemantics(manifest);
  validateLocalizedTexts(manifest, locales, []);
  assertDeclaredClosure(resources.files, declared);
  return deepFreeze({
    kind: "preset",
    artifactId: manifest.presetId,
    version: manifest.version,
    manifest,
    locales,
    resources,
  });
}

/** 仅供包内语义单测构造小型内存夹具，不从 package 根入口导出。 */
export function parsePackageFileSetForTests(
  fileSet: PackageFileSet,
): ParsedExtensionPackage {
  const files = fileMap(fileSet.files);
  const hasModule = files.has("module.json");
  const hasPreset = files.has("preset.json");
  if (hasModule === hasPreset) {
    runtimeError("package-entry-invalid", "package", { hasModule, hasPreset });
  }
  if (hasModule) {
    return parseModulePackage(
      fileSet,
      files,
      parseJsonBytes(requiredFile(files, "module.json"), "module.json"),
    );
  }
  return parsePresetPackage(
    fileSet,
    files,
    parseJsonBytes(requiredFile(files, "preset.json"), "preset.json"),
  );
}

/** 内置包编译期夹具入口；外部包必须使用异步流式解析器。 */
export function parseBuiltInPackageFileSet(
  fileSet: PackageFileSet,
): ParsedExtensionPackage {
  if (fileSet.origin !== "built-in") {
    runtimeError("package-source-mismatch", "package", {
      expected: "built-in",
      actual: fileSet.origin,
    });
  }
  return parsePackageFileSetForTests(fileSet);
}

export interface ParseExtensionPackageOptions {
  readonly signal?: AbortSignal;
  readonly resourceDecoder?: ResourceDecodeGateway;
}

async function loadJsonDeclaration(
  access: PackageResourceAccess,
  path: string,
  maxBytes: number,
  files: Map<string, Uint8Array>,
  signal?: AbortSignal,
): Promise<unknown> {
  const normalized = normalizePackagePath(path);
  const existing = files.get(normalized);
  if (existing !== undefined) return parseJsonBytes(existing, normalized);
  const bytes = await readPackageFileBytes(
    access,
    normalized,
    maxBytes,
    signal,
  );
  files.set(normalized, bytes);
  return parseJsonBytes(bytes, normalized);
}

async function validateStreamedResource(
  access: PackageResourceAccess,
  resource: ModuleManifest["resources"][number],
  decoder: ResourceDecodeGateway | undefined,
  signal?: AbortSignal,
): Promise<void> {
  const path = normalizePackagePath(resource.path);
  const descriptor = access.files.find((item) => item.path === path);
  if (descriptor === undefined) runtimeError("package-file-missing", path);
  if (descriptor.bytes !== resource.bytes) {
    runtimeError("package-resource-invalid", path, {
      declaredBytes: resource.bytes,
      actualBytes: descriptor.bytes,
    });
  }
  if (resource.mimeType === "application/json") {
    const bytes = await readPackageFileBytes(
      access,
      path,
      resource.bytes,
      signal,
    );
    validateResourceBytes(resource, bytes, path);
    return;
  }
  if (decoder === undefined && access.origin !== "built-in") {
    runtimeError("package-resource-decoder-unavailable", path, {
      mimeType: resource.mimeType,
    });
  }

  const prefix = new Uint8Array(Math.min(resource.bytes, 268));
  let prefixOffset = 0;
  let completed = false;
  const inspectedStream = async function* () {
    for await (const chunk of access.openFile(path, signal)) {
      throwIfPackageAborted(signal);
      if (prefixOffset < prefix.byteLength) {
        const count = Math.min(
          chunk.byteLength,
          prefix.byteLength - prefixOffset,
        );
        prefix.set(chunk.subarray(0, count), prefixOffset);
        prefixOffset += count;
      }
      yield chunk;
    }
    completed = true;
  };
  const stream = inspectedStream();

  try {
    if (decoder === undefined) {
      for await (const chunk of stream) {
        void chunk;
        // 内置资源仍须完整消费，以验证来源声明的实际长度。
      }
    } else {
      await decoder.validate({
        path,
        mimeType: resource.mimeType,
        bytes: resource.bytes,
        stream,
        signal,
      });
    }
  } catch (error) {
    await stream.return(undefined);
    if (error instanceof ModuleRuntimeError) throw error;
    throwIfPackageAborted(signal);
    runtimeError(
      "package-resource-decode-failed",
      path,
      { mimeType: resource.mimeType },
      error,
    );
  }
  throwIfPackageAborted(signal);
  if (!completed) {
    await stream.return(undefined);
    runtimeError("package-resource-decode-failed", path, {
      mimeType: resource.mimeType,
      reason: "stream-not-consumed",
    });
  }
  validateResourceHeader(resource, prefix, path);
}

async function parseModuleSource(
  access: PackageResourceAccess,
  rawManifest: unknown,
  entryBytes: Uint8Array,
  options: ParseExtensionPackageOptions,
): Promise<ParsedModulePackage> {
  validateModuleManifest(rawManifest);
  const manifest = cloneJson(rawManifest);
  assertFileLimits(access.files, manifest.packageSource.kind);
  const declarationMax =
    manifest.packageSource.kind === "generated-local"
      ? 32 * 1024 ** 2
      : 8 * 1024 ** 2;
  const files = new Map<string, Uint8Array>([["module.json", entryBytes]]);
  for (const path of manifest.elementFiles) {
    assertUnder(path, "elements/");
    await loadJsonDeclaration(
      access,
      path,
      declarationMax,
      files,
      options.signal,
    );
  }
  for (const path of manifest.constraintFiles) {
    assertUnder(path, "constraints/");
    await loadJsonDeclaration(
      access,
      path,
      declarationMax,
      files,
      options.signal,
    );
  }
  for (const path of manifest.migrationFiles) {
    assertUnder(path, "migrations/");
    await loadJsonDeclaration(
      access,
      path,
      declarationMax,
      files,
      options.signal,
    );
  }
  if (manifest.catalogManifestPath !== null) {
    assertUnder(manifest.catalogManifestPath, "catalog/");
    await loadJsonDeclaration(
      access,
      manifest.catalogManifestPath,
      declarationMax,
      files,
      options.signal,
    );
  }
  for (const path of Object.values(manifest.locales)) {
    await loadJsonDeclaration(
      access,
      path,
      declarationMax,
      files,
      options.signal,
    );
  }
  if (
    manifest.packageSource.kind === "generated-local" &&
    manifest.packageSource.sourceManifestPath !== null
  ) {
    assertUnder(manifest.packageSource.sourceManifestPath, "provenance/");
    await loadJsonDeclaration(
      access,
      manifest.packageSource.sourceManifestPath,
      declarationMax,
      files,
      options.signal,
    );
  }
  // 先完成所有声明式 Schema、引用闭包与语义校验，避免无效包触发大资源读取。
  const parsed = parseModulePackage(
    { origin: access.origin, files: [] },
    files,
    rawManifest,
    access,
    true,
  );
  const validatedResources = new Map<
    string,
    Readonly<{ mimeType: string; bytes: number }>
  >();
  for (const resource of manifest.resources) {
    const path = normalizePackagePath(resource.path);
    const existing = validatedResources.get(path);
    if (
      existing !== undefined &&
      (existing.mimeType !== resource.mimeType ||
        existing.bytes !== resource.bytes)
    ) {
      runtimeError("package-resource-invalid", path, {
        reason: "conflicting-declarations",
      });
    }
    if (existing !== undefined) continue;
    await validateStreamedResource(
      access,
      resource,
      options.resourceDecoder,
      options.signal,
    );
    validatedResources.set(path, {
      mimeType: resource.mimeType,
      bytes: resource.bytes,
    });
  }
  return parsed;
}

export async function parseExtensionPackageSource(
  source: ExtensionPackageSource,
  options: ParseExtensionPackageOptions = {},
): Promise<ParsedExtensionPackage> {
  const access = await readPackageSource(source, options.signal);
  const moduleDescriptor = access.files.find(
    (item) => item.path === "module.json",
  );
  const presetDescriptor = access.files.find(
    (item) => item.path === "preset.json",
  );
  if ((moduleDescriptor === undefined) === (presetDescriptor === undefined)) {
    runtimeError("package-entry-invalid", "package", {
      hasModule: moduleDescriptor !== undefined,
      hasPreset: presetDescriptor !== undefined,
    });
  }
  if (moduleDescriptor !== undefined) {
    const entryBytes = await readPackageFileBytes(
      access,
      "module.json",
      8 * 1024 ** 2,
      options.signal,
    );
    return parseModuleSource(
      access,
      parseJsonBytes(entryBytes, "module.json"),
      entryBytes,
      options,
    );
  }
  const entryBytes = await readPackageFileBytes(
    access,
    "preset.json",
    1024 ** 2,
    options.signal,
  );
  const rawManifest = parseJsonBytes(entryBytes, "preset.json");
  validatePresetManifest(rawManifest);
  const manifest = cloneJson(rawManifest);
  assertFileLimits(access.files, manifest.packageSource.kind);
  const files = new Map<string, Uint8Array>([["preset.json", entryBytes]]);
  for (const path of Object.values(manifest.locales)) {
    await loadJsonDeclaration(
      access,
      path,
      8 * 1024 ** 2,
      files,
      options.signal,
    );
  }
  return parsePresetPackage(
    { origin: access.origin, files: [] },
    files,
    rawManifest,
    access,
  );
}
