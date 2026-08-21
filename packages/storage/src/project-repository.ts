import type { ProjectState } from "@tessera/core";
import {
  restoreProjectV1,
  stringifyProjectDocumentV1,
  stringifyProjectV1,
  type ProjectV1Document,
} from "@tessera/formats";
import {
  StorageRepositoryError,
  toStorageRepositoryError,
} from "./storage-error.js";
import { type StoredRevision, TesseraDatabase } from "./tessera-database.js";

export class ProjectRepository {
  readonly #database: TesseraDatabase;
  #failNextSave = false;
  #failNextPointerRepair = false;

  constructor(databaseName = "tessera-studio") {
    this.#database = new TesseraDatabase(databaseName);
  }

  async save(
    state: Readonly<ProjectState>,
  ): Promise<{ revisionId: string; revision: number; transactionId: string }> {
    // 在事务前固定快照，保存期间的新编辑属于下一修订。
    const document = stringifyProjectV1(state, { mode: "preserve" });
    const projectId = state.projectId;
    const transactionId =
      state.lastTransactionId ?? `${projectId}:snapshot:${state.revision}`;
    const record = await this.#saveSerialized({
      projectId,
      transactionId,
      document,
    });
    if (
      (state.lastTransactionId ??
        `${state.projectId}:snapshot:${state.revision}`) === transactionId
    ) {
      state.cells.markAllClean();
    }
    return {
      revisionId: record.revisionId,
      revision: record.revision,
      transactionId: record.transactionId,
    };
  }

  async saveDocument(
    project: ProjectV1Document,
    transactionId: string,
  ): Promise<{ revisionId: string; revision: number; transactionId: string }> {
    if (transactionId.length === 0 || transactionId.length > 256) {
      throw new StorageRepositoryError(
        "project-save-input-invalid",
        { field: "transactionId" },
        "export-project",
      );
    }
    const document = stringifyProjectDocumentV1(project);
    const record = await this.#saveSerialized({
      projectId: project.projectId,
      transactionId,
      document,
    });
    return {
      revisionId: record.revisionId,
      revision: record.revision,
      transactionId: record.transactionId,
    };
  }

  async #saveSerialized(input: {
    readonly projectId: string;
    readonly transactionId: string;
    readonly document: string;
  }): Promise<StoredRevision> {
    if (this.#failNextSave) {
      this.#failNextSave = false;
      throw new Error("injected-save-failure");
    }
    try {
      return await this.#database.transaction(
        "rw",
        this.#database.projects,
        this.#database.revisions,
        async () => {
          const pointer = await this.#database.projects.get(input.projectId);
          const newestPointer = await this.#database.projects
            .orderBy("updatedAt")
            .last();
          const newestActivation = newestPointer
            ? Date.parse(newestPointer.updatedAt)
            : Number.NaN;
          const activationTime = Math.max(
            Date.now(),
            Number.isFinite(newestActivation) ? newestActivation + 1 : 0,
          );
          const activatedAt = new Date(activationTime).toISOString();
          // 存储修订只由当前指针单调分配，不复用领域模型的编辑修订号。
          const revision = (pointer?.revision ?? -1) + 1;
          const revisionId = `${input.projectId}:${revision}:${crypto.randomUUID()}`;
          const record: StoredRevision = {
            revisionId,
            projectId: input.projectId,
            revision,
            createdAt: activatedAt,
            transactionId: input.transactionId,
            document: input.document,
          };
          await this.#database.revisions.add(record);
          await this.#database.projects.put({
            projectId: input.projectId,
            currentRevisionId: revisionId,
            revision: record.revision,
            // 本地指针表达最近成功保存/激活顺序，不复用文件内的历史时间。
            updatedAt: activatedAt,
          });
          return record;
        },
      );
    } catch (error) {
      throw toStorageRepositoryError(
        error,
        "project-save-failed",
        { projectId: input.projectId },
        "export-project",
      );
    }
  }

  async loadLatest(): Promise<ProjectState | null> {
    try {
      return await this.#loadLatest();
    } catch (error) {
      if (error instanceof ProjectRecoveryError) throw error;
      throw toStorageRepositoryError(
        error,
        "project-load-failed",
        { operation: "loadLatest" },
        "export-project",
      );
    }
  }

  async #loadLatest(): Promise<ProjectState | null> {
    let pointer = await this.#database.projects.orderBy("updatedAt").last();
    const pointerWasMissing = pointer === undefined;
    if (pointer === undefined) {
      const newestRevision = await this.#database.revisions
        .orderBy("createdAt")
        .last();
      if (newestRevision === undefined) return null;
      pointer = {
        projectId: newestRevision.projectId,
        currentRevisionId: newestRevision.revisionId,
        revision: newestRevision.revision,
        updatedAt: newestRevision.createdAt,
      };
    }
    const candidates = await this.#database.revisions
      .where("projectId")
      .equals(pointer.projectId)
      .toArray();
    candidates.sort(
      (left, right) =>
        right.revision - left.revision ||
        right.createdAt.localeCompare(left.createdAt),
    );
    const preferred = candidates.find(
      (item) => item.revisionId === pointer.currentRevisionId,
    );
    const ordered =
      preferred === undefined
        ? candidates
        : [preferred, ...candidates.filter((item) => item !== preferred)];
    for (const revision of ordered) {
      let project: ProjectState;
      try {
        project = restoreProjectV1(revision.document);
      } catch {
        // 损坏修订保持不可变，继续寻找最近一个可读取修订。
        continue;
      }
      if (
        pointerWasMissing ||
        revision.revisionId !== pointer.currentRevisionId
      ) {
        if (this.#failNextPointerRepair) {
          this.#failNextPointerRepair = false;
          throw new Error("injected-pointer-repair-failure");
        }
        await this.#database.projects.put({
          projectId: pointer.projectId,
          currentRevisionId: revision.revisionId,
          revision: revision.revision,
          // 修复当前工程的 revision 指针不能降低其本地活跃顺序。
          updatedAt: pointerWasMissing ? revision.createdAt : pointer.updatedAt,
        });
      }
      return project;
    }
    throw new ProjectRecoveryError(pointer.projectId, candidates.length);
  }

  failNextSaveForTest(): void {
    this.#failNextSave = true;
  }
  failNextPointerRepairForTest(): void {
    this.#failNextPointerRepair = true;
  }
  async revisionCount(projectId: string): Promise<number> {
    return this.#database.revisions
      .where("projectId")
      .equals(projectId)
      .count();
  }
  async latestRevisionTransactionIdForTest(
    projectId: string,
  ): Promise<string | undefined> {
    const revisions = await this.#database.revisions
      .where("projectId")
      .equals(projectId)
      .toArray();
    revisions.sort((left, right) => right.revision - left.revision);
    return revisions[0]?.transactionId;
  }
  async deleteCurrentRevisionForTest(projectId: string): Promise<void> {
    const pointer = await this.#database.projects.get(projectId);
    if (pointer !== undefined)
      await this.#database.revisions.delete(pointer.currentRevisionId);
  }
  async corruptCurrentRevisionForTest(projectId: string): Promise<void> {
    const pointer = await this.#database.projects.get(projectId);
    if (pointer === undefined) return;
    const current = await this.#database.revisions.get(
      pointer.currentRevisionId,
    );
    if (current !== undefined)
      await this.#database.revisions.put({ ...current, document: "{broken" });
  }
  async deletePointerForTest(projectId: string): Promise<void> {
    await this.#database.projects.delete(projectId);
  }
  async hasPointerForTest(projectId: string): Promise<boolean> {
    return (await this.#database.projects.get(projectId)) !== undefined;
  }

  async clear(): Promise<void> {
    await this.#database.transaction(
      "rw",
      this.#database.projects,
      this.#database.revisions,
      async () => {
        await this.#database.projects.clear();
        await this.#database.revisions.clear();
      },
    );
  }

  close(): void {
    this.#database.close();
  }
}

export class ProjectRecoveryError extends Error {
  readonly code = "project-recovery-no-valid-revision";
  readonly details: Readonly<Record<string, unknown>>;
  readonly issues: readonly unknown[] = [];

  constructor(
    readonly projectId: string,
    readonly candidateCount: number,
  ) {
    super("project-recovery-no-valid-revision");
    this.name = "ProjectRecoveryError";
    this.details = { projectId, candidateCount };
  }
}
