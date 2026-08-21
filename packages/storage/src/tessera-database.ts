import Dexie, { type EntityTable } from "dexie";

export interface StoredRevision {
  readonly revisionId: string;
  readonly projectId: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly transactionId: string;
  readonly document: string;
}

export interface ProjectPointer {
  readonly projectId: string;
  readonly currentRevisionId: string;
  readonly revision: number;
  readonly updatedAt: string;
}

export interface StoredPackageFileManifest {
  readonly path: string;
  readonly bytes: number;
  readonly storageKey: string;
}

export interface StoredPackageArchiveManifest {
  readonly fileName: string;
  readonly bytes: number;
  readonly storageKey: string;
}

export interface StoredPackageManifest {
  readonly commitId: string;
  readonly identityKey: string;
  readonly kind: "module" | "preset";
  readonly artifactId: string;
  readonly version: string;
  readonly sourceKind: "user-file" | "generated-local";
  readonly createdAt: string;
  readonly archive: StoredPackageArchiveManifest;
  readonly files: readonly StoredPackageFileManifest[];
}

export interface PackagePointer {
  readonly identityKey: string;
  readonly kind: "module" | "preset";
  readonly artifactId: string;
  readonly version: string;
  readonly sourceKind: "user-file" | "generated-local";
  readonly currentCommitId: string;
  readonly previousCommitId?: string;
  readonly updatedAt: string;
}

export interface PendingPackageCommit {
  readonly commitId: string;
  readonly identityKey: string;
  readonly previousCommitId?: string;
  readonly createdAt: string;
}

/** 所有仓库共享同一 Dexie 版本图，避免独立类竞争升级。 */
export class TesseraDatabase extends Dexie {
  projects!: EntityTable<ProjectPointer, "projectId">;
  revisions!: EntityTable<StoredRevision, "revisionId">;
  packageManifests!: EntityTable<StoredPackageManifest, "commitId">;
  packagePointers!: EntityTable<PackagePointer, "identityKey">;
  pendingPackageCommits!: EntityTable<PendingPackageCommit, "commitId">;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      projects: "&projectId,updatedAt",
      revisions: "&revisionId,projectId,[projectId+revision],createdAt",
    });
    this.version(2).stores({
      projects: "&projectId,updatedAt",
      revisions:
        "&revisionId,projectId,[projectId+revision],createdAt,transactionId",
    });
    this.version(3).stores({
      projects: "&projectId,updatedAt",
      revisions:
        "&revisionId,projectId,[projectId+revision],createdAt,transactionId",
      packageManifests: "&commitId,identityKey,[kind+artifactId+version]",
      packagePointers: "&identityKey,updatedAt,currentCommitId",
      pendingPackageCommits: "&commitId,identityKey,createdAt",
    });
  }
}
