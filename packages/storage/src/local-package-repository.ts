import type { BinaryStreamSource, OpfsGateway } from "./opfs-gateway.js";
import {
  BrowserRepositoryLockGateway,
  type RepositoryLockGateway,
} from "./repository-lock.js";
import {
  type StorageCapacityPlan,
  type StorageCapacityPolicy,
  type StorageEstimateGateway,
  DEFAULT_STORAGE_CAPACITY_POLICY,
  requireStorageCapacity,
} from "./storage-estimate.js";
import {
  StorageRepositoryError,
  toStorageRepositoryError,
} from "./storage-error.js";
import {
  type PackagePointer,
  type PendingPackageCommit,
  type StoredPackageManifest,
  TesseraDatabase,
} from "./tessera-database.js";

export type LocalPackageKind = "module" | "preset";
export type LocalPackageSourceKind = "user-file" | "generated-local";

export interface LocalPackageIdentity {
  readonly kind: LocalPackageKind;
  readonly artifactId: string;
  readonly version: string;
}

export interface LocalPackageArchiveInput {
  readonly fileName: string;
  readonly bytes: number;
  readonly source: BinaryStreamSource;
}

export interface LocalPackageFileInput {
  readonly path: string;
  readonly bytes: number;
  readonly source: BinaryStreamSource;
}

/** 上游已完成 Module Format 校验；仓库仍防御性验证身份、路径和字节数。 */
export interface ValidatedLocalPackageInput {
  readonly identity: LocalPackageIdentity;
  readonly sourceKind: LocalPackageSourceKind;
  readonly archive: LocalPackageArchiveInput;
  readonly expandedBytes: number;
  readonly files: readonly LocalPackageFileInput[];
}

export interface InstalledLocalPackage {
  readonly identity: LocalPackageIdentity;
  readonly sourceKind: LocalPackageSourceKind;
  readonly installedAt: string;
  readonly archive: Readonly<{ fileName: string; bytes: number }>;
  readonly files: readonly Readonly<{ path: string; bytes: number }>[];
}

export interface LocalPackageRegistration {
  readonly identity: LocalPackageIdentity;
  readonly sourceKind: LocalPackageSourceKind;
  readonly package: InstalledLocalPackage | null;
  readonly status: "ready" | "pending" | "corrupted";
  readonly reasonCode:
    "local-package-not-ready" | "local-package-storage-corrupted" | null;
}

export type LocalPackageInstallFailureStep =
  | "after-staging-validation"
  | "during-database-transaction"
  | "after-database-commit"
  | "during-finalize-cleanup";

export interface LocalPackageInstallOptions {
  readonly failureHook?: (step: LocalPackageInstallFailureStep) => void;
}

export interface LocalPackageInstallResult {
  readonly package: InstalledLocalPackage;
  readonly capacity: StorageCapacityPlan;
  readonly replacedCommitId: string | null;
  readonly garbageCollectionPending: boolean;
}

export interface LocalPackageDeleteResult {
  readonly deleted: boolean;
  readonly garbageCollectionPending: boolean;
}

export interface LocalPackageRecoveryIssue {
  readonly code:
    | "local-package-recovery-deferred"
    | "local-package-recovery-rolled-back"
    | "local-package-orphan-cleanup-failed";
  readonly commitId: string;
}

export interface LocalPackageRecoveryReport {
  readonly completedCommitIds: readonly string[];
  readonly rolledBackCommitIds: readonly string[];
  readonly deletedOrphanCommitIds: readonly string[];
  readonly issues: readonly LocalPackageRecoveryIssue[];
}

export interface LocalPackageRepositoryOptions {
  readonly databaseName?: string;
  readonly opfs: OpfsGateway;
  readonly estimateGateway: StorageEstimateGateway;
  readonly capacityPolicy?: StorageCapacityPolicy;
  readonly uuidGenerator?: () => string;
  readonly now?: () => string;
  readonly lockGateway?: RepositoryLockGateway;
}

const NAMESPACED_ID_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const STRICT_SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RFC3339_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function identityKey(identity: LocalPackageIdentity): string {
  return `${identity.kind}:${identity.artifactId}@${identity.version}`;
}

function compareCodePoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isStrictRfc3339(value: string): boolean {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (match === null) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = Number(match[8] ?? 0);
  const offsetMinute = Number(match[9] ?? 0);
  if (
    month < 1 ||
    month > 12 ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return false;
  }
  const calendar = new Date(0);
  calendar.setUTCHours(0, 0, 0, 0);
  calendar.setUTCFullYear(year, month - 1, day);
  return (
    calendar.getUTCFullYear() === year &&
    calendar.getUTCMonth() === month - 1 &&
    calendar.getUTCDate() === day
  );
}

function assertIdentity(identity: LocalPackageIdentity): void {
  if (
    (identity.kind !== "module" && identity.kind !== "preset") ||
    identity.artifactId.length < 3 ||
    identity.artifactId.length > 128 ||
    !NAMESPACED_ID_PATTERN.test(identity.artifactId) ||
    !STRICT_SEMVER_PATTERN.test(identity.version)
  ) {
    throw new StorageRepositoryError(
      "local-package-input-invalid",
      { field: "identity" },
      "reimport-package",
    );
  }
}

function pathCanonicalKey(path: string): string {
  return path.toLocaleLowerCase("en-US");
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
      return true;
    }
  }
  return false;
}

function assertSafePackagePath(path: string): void {
  const segments = path.split("/");
  if (
    path.length === 0 ||
    path.length > 1024 ||
    path !== path.normalize("NFC") ||
    path.includes("\\") ||
    path.startsWith("/") ||
    /^[a-zA-Z]:/u.test(path) ||
    segments.length > 16 ||
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        containsControlCharacter(segment),
    )
  ) {
    throw new StorageRepositoryError(
      "local-package-path-invalid",
      { path },
      "reimport-package",
    );
  }
}

function assertArchiveFileName(fileName: string): void {
  if (
    fileName.length === 0 ||
    fileName.length > 255 ||
    fileName !== fileName.normalize("NFC") ||
    fileName.includes("/") ||
    fileName.includes("\\") ||
    containsControlCharacter(fileName)
  ) {
    throw new StorageRepositoryError(
      "local-package-path-invalid",
      { path: fileName },
      "reimport-package",
    );
  }
}

function assertByteCount(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new StorageRepositoryError(
      "local-package-input-invalid",
      { field },
      "reimport-package",
    );
  }
}

function toLocalPackageQueryError(
  error: unknown,
  details: Readonly<Record<string, unknown>>,
): StorageRepositoryError {
  if (
    error instanceof StorageRepositoryError &&
    (error.code === "local-package-not-found" ||
      error.code === "local-package-not-ready" ||
      error.code === "local-package-storage-corrupted" ||
      error.code === "local-package-path-invalid" ||
      error.code === "local-package-input-invalid")
  ) {
    return error;
  }
  return new StorageRepositoryError(
    "local-package-query-failed",
    details,
    "retry",
  );
}

interface PreparedPackage {
  readonly identity: LocalPackageIdentity;
  readonly identityKey: string;
  readonly sourceKind: LocalPackageSourceKind;
  readonly archive: LocalPackageArchiveInput;
  readonly expandedBytes: number;
  readonly files: readonly LocalPackageFileInput[];
}

function preparePackage(input: ValidatedLocalPackageInput): PreparedPackage {
  assertIdentity(input.identity);
  if (
    input.sourceKind !== "user-file" &&
    input.sourceKind !== "generated-local"
  ) {
    throw new StorageRepositoryError(
      "local-package-input-invalid",
      { field: "sourceKind" },
      "reimport-package",
    );
  }
  assertArchiveFileName(input.archive.fileName);
  assertByteCount(input.archive.bytes, "archive.bytes");
  assertByteCount(input.expandedBytes, "expandedBytes");
  if (input.files.length > 65_536) {
    throw new StorageRepositoryError(
      "local-package-input-invalid",
      { field: "files", count: input.files.length },
      "reimport-package",
    );
  }
  const pathKeys = new Set<string>();
  let expandedBytes = 0;
  for (const file of input.files) {
    assertSafePackagePath(file.path);
    assertByteCount(file.bytes, "file.bytes");
    const key = pathCanonicalKey(file.path);
    if (pathKeys.has(key)) {
      throw new StorageRepositoryError(
        "local-package-path-invalid",
        { path: file.path, reason: "canonical-collision" },
        "reimport-package",
      );
    }
    pathKeys.add(key);
    expandedBytes += file.bytes;
    if (!Number.isSafeInteger(expandedBytes)) {
      throw new StorageRepositoryError(
        "local-package-input-invalid",
        { field: "expandedBytes" },
        "reimport-package",
      );
    }
  }
  if (expandedBytes !== input.expandedBytes) {
    throw new StorageRepositoryError(
      "local-package-byte-count-mismatch",
      {
        field: "expandedBytes",
        declaredBytes: input.expandedBytes,
        actualBytes: expandedBytes,
      },
      "reimport-package",
    );
  }
  return {
    identity: { ...input.identity },
    identityKey: identityKey(input.identity),
    sourceKind: input.sourceKind,
    archive: input.archive,
    expandedBytes,
    files: [...input.files].sort((left, right) =>
      compareCodePoint(left.path, right.path),
    ),
  };
}

function installedPackage(
  manifest: StoredPackageManifest,
): InstalledLocalPackage {
  return {
    identity: {
      kind: manifest.kind,
      artifactId: manifest.artifactId,
      version: manifest.version,
    },
    sourceKind: manifest.sourceKind,
    installedAt: manifest.createdAt,
    archive: {
      fileName: manifest.archive.fileName,
      bytes: manifest.archive.bytes,
    },
    files: manifest.files.map((file) => ({
      path: file.path,
      bytes: file.bytes,
    })),
  };
}

function packagePointer(
  identity: Pick<
    StoredPackageManifest,
    "identityKey" | "kind" | "artifactId" | "version" | "sourceKind"
  >,
  currentCommitId: string,
  updatedAt: string,
  previousCommitId?: string,
): PackagePointer {
  return {
    identityKey: identity.identityKey,
    kind: identity.kind,
    artifactId: identity.artifactId,
    version: identity.version,
    sourceKind: identity.sourceKind,
    currentCommitId,
    updatedAt,
    ...(previousCommitId === undefined ? {} : { previousCommitId }),
  };
}

function pendingCommit(
  commitId: string,
  key: string,
  createdAt: string,
  previousCommitId?: string,
): PendingPackageCommit {
  return {
    commitId,
    identityKey: key,
    createdAt,
    ...(previousCommitId === undefined ? {} : { previousCommitId }),
  };
}

export class LocalPackageRepository {
  readonly #database: TesseraDatabase;
  readonly #opfs: OpfsGateway;
  readonly #estimateGateway: StorageEstimateGateway;
  readonly #capacityPolicy: StorageCapacityPolicy;
  readonly #uuidGenerator: () => string;
  readonly #now: () => string;
  readonly #lock: RepositoryLockGateway;

  constructor(options: LocalPackageRepositoryOptions) {
    this.#database = new TesseraDatabase(
      options.databaseName ?? "tessera-studio",
    );
    this.#opfs = options.opfs;
    this.#estimateGateway = options.estimateGateway;
    this.#capacityPolicy =
      options.capacityPolicy ?? DEFAULT_STORAGE_CAPACITY_POLICY;
    this.#uuidGenerator = options.uuidGenerator ?? (() => crypto.randomUUID());
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#lock = options.lockGateway ?? new BrowserRepositoryLockGateway();
  }

  async install(
    input: ValidatedLocalPackageInput,
    options: LocalPackageInstallOptions = {},
  ): Promise<LocalPackageInstallResult> {
    try {
      const prepared = preparePackage(input);
      return await this.#lock.withExclusive(() =>
        this.#installPrepared(prepared, options),
      );
    } catch (error) {
      throw toStorageRepositoryError(
        error,
        "local-package-install-failed",
        { operation: "install" },
        "reimport-package",
      );
    }
  }

  async replace(
    input: ValidatedLocalPackageInput,
    options: LocalPackageInstallOptions = {},
  ): Promise<LocalPackageInstallResult> {
    return this.install(input, options);
  }

  async #installPrepared(
    prepared: PreparedPackage,
    options: LocalPackageInstallOptions,
  ): Promise<LocalPackageInstallResult> {
    let capacity: StorageCapacityPlan | undefined;
    let commitId: string | undefined;
    let stagingCreated = false;
    let databaseCommitted = false;
    let finalized = false;
    let phase:
      | "initialization"
      | "staging"
      | "database"
      | "finalize"
      | "finalize-cleanup" = "initialization";
    let manifest: StoredPackageManifest | undefined;
    let previousCommitId: string | undefined;
    let displacedFallbackCommitId: string | undefined;
    try {
      if (!(await this.#opfs.isAvailable())) {
        throw new StorageRepositoryError(
          "opfs-unavailable",
          { capability: "packageRepository" },
          "export-project",
        );
      }
      capacity = await requireStorageCapacity(
        this.#estimateGateway,
        prepared.archive.bytes,
        prepared.expandedBytes,
        this.#capacityPolicy,
      );
      commitId = this.#uuidGenerator();
      if (!UUID_PATTERN.test(commitId)) {
        throw new StorageRepositoryError(
          "local-package-input-invalid",
          { field: "commitId" },
          "retry",
        );
      }
      if ((await this.#database.packageManifests.get(commitId)) !== undefined) {
        throw new StorageRepositoryError(
          "local-package-input-invalid",
          { field: "commitId", reason: "collision" },
          "retry",
        );
      }
      await this.#opfs.createCommitExclusive(commitId);
      stagingCreated = true;
      const createdAt = this.#now();
      if (!RFC3339_PATTERN.test(createdAt) || !isStrictRfc3339(createdAt)) {
        throw new StorageRepositoryError(
          "local-package-input-invalid",
          { field: "createdAt" },
          "retry",
        );
      }
      const allocatedCommitId = commitId;
      phase = "staging";
      const archiveStorageKey = "archive-000000";
      const archiveBytes = await this.#opfs.writeFile(
        commitId,
        archiveStorageKey,
        prepared.archive.source,
        prepared.archive.bytes,
      );
      this.#assertActualBytes(
        prepared.archive.fileName,
        prepared.archive.bytes,
        archiveBytes,
      );
      const storedFiles = [];
      for (const [index, file] of prepared.files.entries()) {
        const storageKey = `file-${String(index).padStart(6, "0")}`;
        const actualBytes = await this.#opfs.writeFile(
          commitId,
          storageKey,
          file.source,
          file.bytes,
        );
        this.#assertActualBytes(file.path, file.bytes, actualBytes);
        storedFiles.push({ path: file.path, bytes: file.bytes, storageKey });
      }
      options.failureHook?.("after-staging-validation");
      manifest = {
        commitId,
        identityKey: prepared.identityKey,
        kind: prepared.identity.kind,
        artifactId: prepared.identity.artifactId,
        version: prepared.identity.version,
        sourceKind: prepared.sourceKind,
        createdAt,
        archive: {
          fileName: prepared.archive.fileName,
          bytes: prepared.archive.bytes,
          storageKey: archiveStorageKey,
        },
        files: storedFiles,
      };
      const stagedManifest = manifest;
      phase = "database";
      await this.#database.transaction(
        "rw",
        this.#database.packageManifests,
        this.#database.packagePointers,
        this.#database.pendingPackageCommits,
        async () => {
          const existingPointer = await this.#database.packagePointers.get(
            prepared.identityKey,
          );
          const existingPending = await this.#database.pendingPackageCommits
            .where("identityKey")
            .equals(prepared.identityKey)
            .first();
          if (existingPending !== undefined) {
            throw new StorageRepositoryError(
              "local-package-not-ready",
              { identityKey: prepared.identityKey },
              "retry",
            );
          }
          options.failureHook?.("during-database-transaction");
          previousCommitId = existingPointer?.currentCommitId;
          displacedFallbackCommitId = existingPointer?.previousCommitId;
          await this.#database.packageManifests.add(stagedManifest);
          await this.#database.pendingPackageCommits.add(
            pendingCommit(
              allocatedCommitId,
              prepared.identityKey,
              createdAt,
              previousCommitId,
            ),
          );
          await this.#database.packagePointers.put(
            packagePointer(
              stagedManifest,
              allocatedCommitId,
              createdAt,
              previousCommitId,
            ),
          );
          if (displacedFallbackCommitId !== undefined) {
            await this.#database.packageManifests.delete(
              displacedFallbackCommitId,
            );
          }
        },
      );
      databaseCommitted = true;
      phase = "finalize";
      options.failureHook?.("after-database-commit");
      await this.#opfs.markCommitted(allocatedCommitId);
      finalized = true;
      phase = "finalize-cleanup";
      await this.#database.transaction(
        "rw",
        this.#database.packagePointers,
        this.#database.pendingPackageCommits,
        async () => {
          options.failureHook?.("during-finalize-cleanup");
          const pointer = await this.#database.packagePointers.get(
            prepared.identityKey,
          );
          if (pointer?.currentCommitId !== allocatedCommitId) {
            throw new StorageRepositoryError(
              "local-package-storage-corrupted",
              { identityKey: prepared.identityKey },
              "reimport-package",
            );
          }
          await this.#database.pendingPackageCommits.delete(allocatedCommitId);
        },
      );
      let garbageCollectionPending = false;
      if (displacedFallbackCommitId !== undefined) {
        try {
          await this.#opfs.deleteCommit(displacedFallbackCommitId);
        } catch {
          garbageCollectionPending = true;
        }
      }
      return {
        package: installedPackage(manifest),
        capacity,
        replacedCommitId: previousCommitId ?? null,
        garbageCollectionPending,
      };
    } catch (error) {
      if (!databaseCommitted && stagingCreated && commitId !== undefined) {
        await this.#opfs.deleteCommit(commitId).catch(() => undefined);
      }
      const code =
        phase === "database"
          ? "local-package-database-failed"
          : databaseCommitted
            ? "local-package-finalize-failed"
            : "local-package-install-failed";
      throw toStorageRepositoryError(
        error,
        code,
        {
          identityKey: prepared.identityKey,
          phase,
          finalized,
        },
        databaseCommitted ? "retry" : "reimport-package",
      );
    }
  }

  #assertActualBytes(path: string, declared: number, actual: number): void {
    if (declared !== actual) {
      throw new StorageRepositoryError(
        "local-package-byte-count-mismatch",
        { path, declaredBytes: declared, actualBytes: actual },
        "reimport-package",
      );
    }
  }

  async #resolvedManifest(
    identity: LocalPackageIdentity,
  ): Promise<StoredPackageManifest | undefined> {
    assertIdentity(identity);
    const key = identityKey(identity);
    try {
      const pointer = await this.#database.packagePointers.get(key);
      if (pointer === undefined) return undefined;
      const pending = await this.#database.pendingPackageCommits.get(
        pointer.currentCommitId,
      );
      const resolvedCommitId =
        pending === undefined
          ? pointer.currentCommitId
          : pointer.previousCommitId;
      if (resolvedCommitId === undefined) {
        throw new StorageRepositoryError(
          "local-package-not-ready",
          { identityKey: key },
          "retry",
        );
      }
      const manifest =
        await this.#database.packageManifests.get(resolvedCommitId);
      if (
        manifest === undefined ||
        !(await this.#manifestIsCommittedAndComplete(manifest))
      ) {
        throw new StorageRepositoryError(
          "local-package-storage-corrupted",
          { identityKey: key },
          "reimport-package",
        );
      }
      return manifest;
    } catch (error) {
      throw toLocalPackageQueryError(error, {
        identityKey: key,
        operation: "resolve",
      });
    }
  }

  async findExact(
    identity: LocalPackageIdentity,
  ): Promise<InstalledLocalPackage | undefined> {
    const manifest = await this.#resolvedManifest(identity);
    return manifest === undefined ? undefined : installedPackage(manifest);
  }

  async list(): Promise<readonly InstalledLocalPackage[]> {
    return (await this.listRegistrations())
      .filter(
        (
          registration,
        ): registration is LocalPackageRegistration & {
          package: InstalledLocalPackage;
        } => registration.status === "ready" && registration.package !== null,
      )
      .map((registration) => registration.package);
  }

  async listRegistrations(): Promise<readonly LocalPackageRegistration[]> {
    try {
      return await this.#listRegistrationsUnsafe();
    } catch (error) {
      throw toLocalPackageQueryError(error, {
        operation: "listRegistrations",
      });
    }
  }

  async #listRegistrationsUnsafe(): Promise<
    readonly LocalPackageRegistration[]
  > {
    const pointers = await this.#database.packagePointers.toArray();
    pointers.sort((left, right) =>
      compareCodePoint(left.identityKey, right.identityKey),
    );
    const registrations: LocalPackageRegistration[] = [];
    for (const pointer of pointers) {
      const current = await this.#database.packageManifests.get(
        pointer.currentCommitId,
      );
      const fallback =
        pointer.previousCommitId === undefined
          ? undefined
          : await this.#database.packageManifests.get(pointer.previousCommitId);
      const manifest = current ?? fallback;
      const pending = await this.#database.pendingPackageCommits.get(
        pointer.currentCommitId,
      );
      if (pending !== undefined) {
        registrations.push({
          identity: {
            kind: pointer.kind,
            artifactId: pointer.artifactId,
            version: pointer.version,
          },
          sourceKind: pointer.sourceKind,
          package: manifest === undefined ? null : installedPackage(manifest),
          status: "pending",
          reasonCode: "local-package-not-ready",
        });
        continue;
      }
      const ready =
        current !== undefined &&
        (await this.#manifestIsCommittedAndComplete(current));
      registrations.push({
        identity: {
          kind: pointer.kind,
          artifactId: pointer.artifactId,
          version: pointer.version,
        },
        sourceKind: pointer.sourceKind,
        package: manifest === undefined ? null : installedPackage(manifest),
        status: ready ? "ready" : "corrupted",
        reasonCode: ready ? null : "local-package-storage-corrupted",
      });
    }
    return registrations;
  }

  async openFile(
    identity: LocalPackageIdentity,
    path: string,
  ): Promise<ReadableStream<Uint8Array>> {
    try {
      return await this.#openFileUnsafe(identity, path);
    } catch (error) {
      throw toLocalPackageQueryError(error, {
        identityKey: identityKey(identity),
        operation: "openFile",
      });
    }
  }

  async #openFileUnsafe(
    identity: LocalPackageIdentity,
    path: string,
  ): Promise<ReadableStream<Uint8Array>> {
    assertSafePackagePath(path);
    const manifest = await this.#resolvedManifest(identity);
    if (manifest === undefined) {
      throw new StorageRepositoryError(
        "local-package-not-found",
        { identityKey: identityKey(identity) },
        "reimport-package",
      );
    }
    const file = manifest.files.find((item) => item.path === path);
    if (file === undefined) {
      throw new StorageRepositoryError(
        "local-package-not-found",
        { identityKey: manifest.identityKey, path },
        "reimport-package",
      );
    }
    const actualBytes = await this.#opfs.fileSize(
      manifest.commitId,
      file.storageKey,
    );
    if (actualBytes !== file.bytes) {
      throw new StorageRepositoryError(
        "local-package-storage-corrupted",
        { identityKey: manifest.identityKey, path },
        "reimport-package",
      );
    }
    return this.#opfs.openFile(manifest.commitId, file.storageKey);
  }

  async openArchive(
    identity: LocalPackageIdentity,
  ): Promise<ReadableStream<Uint8Array>> {
    try {
      return await this.#openArchiveUnsafe(identity);
    } catch (error) {
      throw toLocalPackageQueryError(error, {
        identityKey: identityKey(identity),
        operation: "openArchive",
      });
    }
  }

  async #openArchiveUnsafe(
    identity: LocalPackageIdentity,
  ): Promise<ReadableStream<Uint8Array>> {
    const manifest = await this.#resolvedManifest(identity);
    if (manifest === undefined) {
      throw new StorageRepositoryError(
        "local-package-not-found",
        { identityKey: identityKey(identity) },
        "reimport-package",
      );
    }
    const actualBytes = await this.#opfs.fileSize(
      manifest.commitId,
      manifest.archive.storageKey,
    );
    if (actualBytes !== manifest.archive.bytes) {
      throw new StorageRepositoryError(
        "local-package-storage-corrupted",
        { identityKey: manifest.identityKey, path: "$archive" },
        "reimport-package",
      );
    }
    return this.#opfs.openFile(manifest.commitId, manifest.archive.storageKey);
  }

  async delete(
    identity: LocalPackageIdentity,
  ): Promise<LocalPackageDeleteResult> {
    assertIdentity(identity);
    const key = identityKey(identity);
    try {
      return await this.#lock.withExclusive(async () => {
        const deletion = await this.#database.transaction(
          "rw",
          this.#database.packageManifests,
          this.#database.packagePointers,
          this.#database.pendingPackageCommits,
          async () => {
            const pointer = await this.#database.packagePointers.get(key);
            const manifests = await this.#database.packageManifests
              .where("identityKey")
              .equals(key)
              .toArray();
            const pending = await this.#database.pendingPackageCommits
              .where("identityKey")
              .equals(key)
              .toArray();
            const commitIds = new Set<string>();
            if (pointer !== undefined) {
              commitIds.add(pointer.currentCommitId);
              if (pointer.previousCommitId !== undefined) {
                commitIds.add(pointer.previousCommitId);
              }
            }
            for (const manifest of manifests) commitIds.add(manifest.commitId);
            for (const record of pending) {
              commitIds.add(record.commitId);
              if (record.previousCommitId !== undefined) {
                commitIds.add(record.previousCommitId);
              }
            }
            await this.#database.packagePointers.delete(key);
            await this.#database.pendingPackageCommits
              .where("identityKey")
              .equals(key)
              .delete();
            await this.#database.packageManifests
              .where("identityKey")
              .equals(key)
              .delete();
            return {
              registered:
                pointer !== undefined ||
                manifests.length > 0 ||
                pending.length > 0,
              commitIds: [...commitIds].sort(compareCodePoint),
            };
          },
        );
        let garbageCollectionPending = false;
        for (const commitId of deletion.commitIds) {
          try {
            await this.#opfs.deleteCommit(commitId);
          } catch {
            garbageCollectionPending = true;
          }
        }
        return {
          deleted: deletion.registered,
          garbageCollectionPending,
        };
      });
    } catch (error) {
      throw toStorageRepositoryError(
        error,
        "local-package-delete-failed",
        { identityKey: key },
        "retry",
      );
    }
  }

  async recover(): Promise<LocalPackageRecoveryReport> {
    try {
      return await this.#lock.withExclusive(() => this.#recoverUnlocked());
    } catch (error) {
      throw toStorageRepositoryError(
        error,
        "local-package-recovery-failed",
        { operation: "recover" },
        "retry",
      );
    }
  }

  async #recoverUnlocked(): Promise<LocalPackageRecoveryReport> {
    const completedCommitIds: string[] = [];
    const rolledBackCommitIds: string[] = [];
    const deletedOrphanCommitIds: string[] = [];
    const issues: LocalPackageRecoveryIssue[] = [];
    const pending = await this.#database.pendingPackageCommits.toArray();
    pending.sort((left, right) =>
      compareCodePoint(left.commitId, right.commitId),
    );
    for (const record of pending) {
      try {
        const manifest = await this.#database.packageManifests.get(
          record.commitId,
        );
        const pointer = await this.#database.packagePointers.get(
          record.identityKey,
        );
        const filesComplete =
          manifest !== undefined &&
          (await this.#manifestFilesAreComplete(manifest));
        if (
          manifest === undefined ||
          pointer?.currentCommitId !== record.commitId ||
          !filesComplete
        ) {
          const fallback = await this.#validFallback(record.previousCommitId);
          const cleanupSucceeded = await this.#rollbackPending(
            record,
            manifest,
            fallback,
          );
          rolledBackCommitIds.push(record.commitId);
          issues.push({
            code: "local-package-recovery-rolled-back",
            commitId: record.commitId,
          });
          if (!cleanupSucceeded) {
            issues.push({
              code: "local-package-orphan-cleanup-failed",
              commitId: record.commitId,
            });
          }
          continue;
        }
        await this.#opfs.markCommitted(record.commitId);
        await this.#database.transaction(
          "rw",
          this.#database.packagePointers,
          this.#database.pendingPackageCommits,
          async () => {
            const current = await this.#database.packagePointers.get(
              record.identityKey,
            );
            if (current?.currentCommitId !== record.commitId) {
              throw new Error("package-pointer-changed");
            }
            await this.#database.pendingPackageCommits.delete(record.commitId);
          },
        );
        completedCommitIds.push(record.commitId);
      } catch {
        issues.push({
          code: "local-package-recovery-deferred",
          commitId: record.commitId,
        });
      }
    }

    const stablePointers = await this.#database.packagePointers.toArray();
    for (const pointer of stablePointers) {
      try {
        const stillPending = await this.#database.pendingPackageCommits.get(
          pointer.currentCommitId,
        );
        if (stillPending !== undefined) continue;
        const current = await this.#database.packageManifests.get(
          pointer.currentCommitId,
        );
        if (
          current !== undefined &&
          (await this.#manifestIsCommittedAndComplete(current))
        ) {
          continue;
        }
        const fallback = await this.#validFallback(pointer.previousCommitId);
        await this.#database.transaction(
          "rw",
          this.#database.packageManifests,
          this.#database.packagePointers,
          async () => {
            if (fallback === undefined) {
              await this.#database.packagePointers.delete(pointer.identityKey);
            } else {
              await this.#database.packagePointers.put(
                packagePointer(fallback, fallback.commitId, fallback.createdAt),
              );
            }
            if (current !== undefined) {
              await this.#database.packageManifests.delete(current.commitId);
            }
          },
        );
        try {
          await this.#opfs.deleteCommit(pointer.currentCommitId);
        } catch {
          issues.push({
            code: "local-package-orphan-cleanup-failed",
            commitId: pointer.currentCommitId,
          });
        }
        rolledBackCommitIds.push(pointer.currentCommitId);
        issues.push({
          code: "local-package-recovery-rolled-back",
          commitId: pointer.currentCommitId,
        });
      } catch {
        issues.push({
          code: "local-package-recovery-deferred",
          commitId: pointer.currentCommitId,
        });
      }
    }

    const currentPointers = await this.#database.packagePointers.toArray();
    const currentPending = await this.#database.pendingPackageCommits.toArray();
    const referenced = new Set<string>();
    for (const pointer of currentPointers) {
      referenced.add(pointer.currentCommitId);
      if (pointer.previousCommitId !== undefined) {
        referenced.add(pointer.previousCommitId);
      }
    }
    for (const record of currentPending) {
      referenced.add(record.commitId);
      if (record.previousCommitId !== undefined) {
        referenced.add(record.previousCommitId);
      }
    }
    const manifests = await this.#database.packageManifests.toArray();
    for (const manifest of manifests) {
      if (referenced.has(manifest.commitId)) continue;
      await this.#database.packageManifests.delete(manifest.commitId);
      try {
        await this.#opfs.deleteCommit(manifest.commitId);
        deletedOrphanCommitIds.push(manifest.commitId);
      } catch {
        issues.push({
          code: "local-package-orphan-cleanup-failed",
          commitId: manifest.commitId,
        });
      }
    }

    const manifestIds = new Set(
      (await this.#database.packageManifests.toArray()).map(
        (manifest) => manifest.commitId,
      ),
    );
    for (const commitId of await this.#opfs.listCommitIds()) {
      if (manifestIds.has(commitId)) continue;
      try {
        await this.#opfs.deleteCommit(commitId);
        if (!deletedOrphanCommitIds.includes(commitId)) {
          deletedOrphanCommitIds.push(commitId);
        }
      } catch {
        issues.push({
          code: "local-package-orphan-cleanup-failed",
          commitId,
        });
      }
    }
    completedCommitIds.sort(compareCodePoint);
    rolledBackCommitIds.sort(compareCodePoint);
    deletedOrphanCommitIds.sort(compareCodePoint);
    return {
      completedCommitIds,
      rolledBackCommitIds,
      deletedOrphanCommitIds,
      issues,
    };
  }

  async #validFallback(
    commitId: string | undefined,
  ): Promise<StoredPackageManifest | undefined> {
    if (commitId === undefined) return undefined;
    const manifest = await this.#database.packageManifests.get(commitId);
    return manifest !== undefined &&
      (await this.#manifestIsCommittedAndComplete(manifest))
      ? manifest
      : undefined;
  }

  async #rollbackPending(
    record: PendingPackageCommit,
    manifest: StoredPackageManifest | undefined,
    fallback: StoredPackageManifest | undefined,
  ): Promise<boolean> {
    await this.#database.transaction(
      "rw",
      this.#database.packageManifests,
      this.#database.packagePointers,
      this.#database.pendingPackageCommits,
      async () => {
        const pointer = await this.#database.packagePointers.get(
          record.identityKey,
        );
        if (pointer?.currentCommitId === record.commitId) {
          if (fallback === undefined) {
            await this.#database.packagePointers.delete(record.identityKey);
          } else {
            await this.#database.packagePointers.put(
              packagePointer(fallback, fallback.commitId, fallback.createdAt),
            );
          }
        }
        await this.#database.pendingPackageCommits.delete(record.commitId);
        if (manifest !== undefined) {
          await this.#database.packageManifests.delete(record.commitId);
        }
      },
    );
    try {
      await this.#opfs.deleteCommit(record.commitId);
      return true;
    } catch {
      return false;
    }
  }

  async #manifestIsCommittedAndComplete(
    manifest: StoredPackageManifest,
  ): Promise<boolean> {
    return (
      (await this.#opfs.isCommitted(manifest.commitId)) &&
      (await this.#manifestFilesAreComplete(manifest))
    );
  }

  async #manifestFilesAreComplete(
    manifest: StoredPackageManifest,
  ): Promise<boolean> {
    if (
      (await this.#opfs.fileSize(
        manifest.commitId,
        manifest.archive.storageKey,
      )) !== manifest.archive.bytes
    ) {
      return false;
    }
    for (const file of manifest.files) {
      if (
        (await this.#opfs.fileSize(manifest.commitId, file.storageKey)) !==
        file.bytes
      ) {
        return false;
      }
    }
    return true;
  }

  async pendingCountForTest(): Promise<number> {
    return this.#database.pendingPackageCommits.count();
  }

  async pendingCommitIdsForTest(): Promise<readonly string[]> {
    return (await this.#database.pendingPackageCommits.toArray())
      .map((record) => record.commitId)
      .sort(compareCodePoint);
  }

  async currentCommitIdForTest(
    identity: LocalPackageIdentity,
  ): Promise<string | undefined> {
    return (await this.#database.packagePointers.get(identityKey(identity)))
      ?.currentCommitId;
  }

  async deleteCurrentManifestForTest(
    identity: LocalPackageIdentity,
  ): Promise<void> {
    const pointer = await this.#database.packagePointers.get(
      identityKey(identity),
    );
    if (pointer !== undefined) {
      await this.#database.packageManifests.delete(pointer.currentCommitId);
    }
  }

  async deleteAllManifestsForTest(
    identity: LocalPackageIdentity,
  ): Promise<void> {
    await this.#database.packageManifests
      .where("identityKey")
      .equals(identityKey(identity))
      .delete();
  }

  async manifestCommitIdsForTest(
    identity: LocalPackageIdentity,
  ): Promise<readonly string[]> {
    const manifests = await this.#database.packageManifests
      .where("identityKey")
      .equals(identityKey(identity))
      .toArray();
    return manifests.map((manifest) => manifest.commitId).sort();
  }

  async clearForTest(): Promise<void> {
    await this.#lock.withExclusive(async () => {
      const commitIds = await this.#opfs.listCommitIds();
      await this.#database.transaction(
        "rw",
        this.#database.packageManifests,
        this.#database.packagePointers,
        this.#database.pendingPackageCommits,
        async () => {
          await this.#database.packageManifests.clear();
          await this.#database.packagePointers.clear();
          await this.#database.pendingPackageCommits.clear();
        },
      );
      for (const commitId of commitIds) {
        await this.#opfs.deleteCommit(commitId).catch(() => undefined);
      }
    });
  }

  close(): void {
    this.#database.close();
  }
}
