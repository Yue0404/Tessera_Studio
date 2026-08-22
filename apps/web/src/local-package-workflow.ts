import { TESSERA_APP_VERSION } from "@tessera/core";
import {
  ModuleRuntimeError,
  appVersionCompatible,
  packageSourcesEquivalent,
  parseExtensionPackageSource,
  readPackageSource,
  resolveLocalizedText,
  type ExtensionPackageSource,
  type PackageFileDescriptor,
  type ParsedExtensionPackage,
  type ResourceDecodeGateway,
} from "@tessera/module-runtime";
import { UserFilePackageSource } from "@tessera/module-runtime/user-file";
import {
  type InstalledLocalPackage,
  type LocalPackageIdentity,
  type LocalPackageRepository,
  type LocalPackageStagingAccess,
  type LocalPackageRegistration,
  type ValidatedLocalPackageInput,
} from "@tessera/storage";

export interface StoredPackageReader {
  openFile(
    identity: LocalPackageIdentity,
    path: string,
  ): Promise<ReadableStream<Uint8Array>>;
}

export interface InstalledPackageCatalogEntry {
  readonly registration: LocalPackageRegistration;
  readonly parsed: ParsedExtensionPackage | null;
  readonly statusKey: string;
  readonly displayName: string;
  readonly sourceDetails: readonly {
    readonly labelKey: string;
    readonly value: string;
  }[];
}

export interface InstalledPackageCatalog {
  readonly entries: readonly InstalledPackageCatalogEntry[];
  readonly packages: readonly ParsedExtensionPackage[];
}

function packageDisplayName(parsed: ParsedExtensionPackage): string {
  try {
    return resolveLocalizedText(
      parsed.manifest.nameKey,
      "zh-CN",
      parsed.locales,
      parsed.manifest.defaultLanguage,
    );
  } catch {
    return parsed.artifactId;
  }
}

function packageSourceDetails(
  parsed: ParsedExtensionPackage,
): InstalledPackageCatalogEntry["sourceDetails"] {
  const source = parsed.manifest.packageSource;
  if (source.kind === "user-file") {
    return Object.freeze([
      { labelKey: "package.source.publisher", value: source.publisher },
      { labelKey: "package.source.publishedAt", value: source.publishedAt },
    ]);
  }
  if (source.kind === "generated-local") {
    return Object.freeze([
      {
        labelKey: "package.source.generator",
        value: `${source.generatorId} ${source.generatorVersion}`,
      },
      {
        labelKey: "package.source.generatedAt",
        value: source.generatedAt,
      },
      {
        labelKey: "package.source.product",
        value: source.sourceProduct,
      },
    ]);
  }
  return Object.freeze([]);
}

async function* streamBytes(
  streamPromise: Promise<ReadableStream<Uint8Array>>,
  signal?: AbortSignal,
): AsyncIterable<Uint8Array> {
  const reader = (await streamPromise).getReader();
  try {
    while (true) {
      if (signal?.aborted === true) {
        throw new ModuleRuntimeError("package-aborted", "source");
      }
      const next = await reader.read();
      if (next.done) return;
      yield next.value;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** 将已安装包映射回统一解析器，不复制 OPFS 中的资源。 */
export class StoredLocalPackageSource implements ExtensionPackageSource {
  readonly origin = "user-file" as const;
  readonly #reader: StoredPackageReader;

  constructor(
    readonly installed: InstalledLocalPackage,
    reader: StoredPackageReader,
  ) {
    this.#reader = reader;
  }

  async *listFiles(signal?: AbortSignal): AsyncIterable<PackageFileDescriptor> {
    for (const descriptor of this.installed.files) {
      if (signal?.aborted === true) {
        throw new ModuleRuntimeError("package-aborted", "source");
      }
      yield { ...descriptor };
    }
  }

  openFile(path: string, signal?: AbortSignal): AsyncIterable<Uint8Array> {
    return streamBytes(
      this.#reader.openFile(this.installed.identity, path),
      signal,
    );
  }
}

function stagingSource(
  access: LocalPackageStagingAccess,
): ExtensionPackageSource {
  return {
    origin: "user-file",
    async *listFiles(signal?: AbortSignal) {
      for (const descriptor of access.files) {
        if (signal?.aborted === true) {
          throw new ModuleRuntimeError("package-aborted", "source");
        }
        yield { ...descriptor };
      }
    },
    openFile(path: string, signal?: AbortSignal) {
      return streamBytes(access.openFile(path), signal);
    },
  };
}

function identityOf(parsed: ParsedExtensionPackage): LocalPackageIdentity {
  return {
    kind: parsed.kind,
    artifactId: parsed.artifactId,
    version: parsed.version,
  };
}

function sourceKindOf(
  parsed: ParsedExtensionPackage,
): ValidatedLocalPackageInput["sourceKind"] {
  return parsed.manifest.packageSource.kind === "generated-local"
    ? "generated-local"
    : "user-file";
}

export function assertPackageArchiveKind(
  fileName: string,
  kind: ParsedExtensionPackage["kind"],
) {
  const suffix =
    kind === "module" ? ".tessera-module.zip" : ".tessera-preset.zip";
  if (!fileName.endsWith(suffix)) {
    throw new ModuleRuntimeError("package-resource-invalid", "archive", {
      reason: "archive-extension-kind-mismatch",
      expectedSuffix: suffix,
    });
  }
}

export type InstallPackageFileResult =
  | {
      readonly status: "installed";
      readonly package: InstalledLocalPackage;
      readonly parsed: ParsedExtensionPackage;
    }
  | {
      readonly status: "already-installed";
      readonly package: InstalledLocalPackage;
      readonly parsed: ParsedExtensionPackage;
    };

export interface InstallPackageFileOptions {
  readonly decoder: ResourceDecodeGateway;
  readonly signal?: AbortSignal;
  readonly createSource?: (
    file: File,
  ) => ExtensionPackageSource | Promise<ExtensionPackageSource>;
}

export async function parseStoredPackage(
  repository: StoredPackageReader,
  installed: InstalledLocalPackage,
  decoder: ResourceDecodeGateway,
  signal?: AbortSignal,
): Promise<ParsedExtensionPackage> {
  return parseExtensionPackageSource(
    new StoredLocalPackageSource(installed, repository),
    {
      ...(signal === undefined ? {} : { signal }),
      resourceDecoder: decoder,
    },
  );
}

/** 重启后先恢复 staging，再逐包从 OPFS 重开并走统一解析/真实解码。 */
export async function loadInstalledPackageCatalog(
  repository: LocalPackageRepository,
  decoder: ResourceDecodeGateway,
  signal?: AbortSignal,
): Promise<InstalledPackageCatalog> {
  await repository.recover();
  const registrations = await repository.listRegistrations();
  const entries: InstalledPackageCatalogEntry[] = [];
  const packages: ParsedExtensionPackage[] = [];
  for (const registration of registrations) {
    if (signal?.aborted === true) {
      throw new ModuleRuntimeError("package-aborted", "catalog");
    }
    if (registration.status !== "ready" || registration.package === null) {
      entries.push({
        registration,
        parsed: null,
        statusKey: "package.status." + registration.status,
        displayName: registration.identity.artifactId,
        sourceDetails: [],
      });
      continue;
    }
    try {
      const parsed = await parseStoredPackage(
        repository,
        registration.package,
        decoder,
        signal,
      );
      const compatible = appVersionCompatible(
        TESSERA_APP_VERSION,
        parsed.manifest.appVersion,
      );
      entries.push({
        registration,
        parsed,
        statusKey: compatible
          ? "package.status.ready"
          : "package.status.incompatible",
        displayName: packageDisplayName(parsed),
        sourceDetails: packageSourceDetails(parsed),
      });
      if (compatible) packages.push(parsed);
    } catch {
      entries.push({
        registration,
        parsed: null,
        statusKey: "package.status.corrupted",
        displayName: registration.identity.artifactId,
        sourceDetails: [],
      });
    }
  }
  return Object.freeze({
    entries: Object.freeze(entries),
    packages: Object.freeze(packages),
  });
}

/**
 * 单次解析 UserFile，写入临时命名空间后再从 staging 完整重开验证。
 * 同版本不同内容不得覆盖，避免把同一版本号解释成两个事实。
 */
export async function installPackageFile(
  repository: LocalPackageRepository,
  file: File,
  options: InstallPackageFileOptions,
): Promise<InstallPackageFileResult> {
  const { decoder, signal } = options;
  const source = await (options.createSource?.(file) ??
    new UserFilePackageSource(file));
  try {
    const parsed = await parseExtensionPackageSource(source, {
      ...(signal === undefined ? {} : { signal }),
      resourceDecoder: decoder,
    });
    assertPackageArchiveKind(file.name, parsed.kind);
    const identity = identityOf(parsed);
    const existing = await repository.findExact(identity);
    if (existing !== undefined) {
      const existingAccess = await readPackageSource(
        new StoredLocalPackageSource(existing, repository),
        signal,
      );
      const equivalent = await packageSourcesEquivalent(
        existingAccess,
        parsed,
        signal,
      );
      if (!equivalent) {
        throw new ModuleRuntimeError("package-version-reuse", "package", {
          ...identity,
        });
      }
      return {
        status: "already-installed",
        package: existing,
        parsed: await parseStoredPackage(repository, existing, decoder, signal),
      };
    }
    const files = parsed.resources.files.map((descriptor) => ({
      ...descriptor,
      source: parsed.resources.openFile(descriptor.path, signal),
    }));
    const result = await repository.install(
      {
        identity,
        sourceKind: sourceKindOf(parsed),
        archive: {
          fileName: file.name,
          bytes: file.size,
          source: file.stream(),
        },
        expandedBytes: files.reduce((sum, item) => sum + item.bytes, 0),
        files,
      },
      {
        async stagingValidator(access) {
          const staged = await parseExtensionPackageSource(
            stagingSource(access),
            {
              ...(signal === undefined ? {} : { signal }),
              resourceDecoder: decoder,
            },
          );
          if (
            staged.kind !== identity.kind ||
            staged.artifactId !== identity.artifactId ||
            staged.version !== identity.version
          ) {
            throw new ModuleRuntimeError("package-version-reuse", "package", {
              ...identity,
            });
          }
        },
      },
    );
    return {
      status: "installed",
      package: result.package,
      parsed: await parseStoredPackage(
        repository,
        result.package,
        decoder,
        signal,
      ),
    };
  } finally {
    await source.dispose?.();
  }
}
