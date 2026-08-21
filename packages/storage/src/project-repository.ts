import Dexie, { type EntityTable } from "dexie";
import type { ProjectState } from "@tessera/core";
import { parseProjectV1, stringifyProjectV1 } from "@tessera/formats";

interface StoredRevision {
  revisionId: string;
  projectId: string;
  revision: number;
  createdAt: string;
  document: string;
}

interface ProjectPointer {
  projectId: string;
  currentRevisionId: string;
  revision: number;
  updatedAt: string;
}

class TesseraDatabase extends Dexie {
  projects!: EntityTable<ProjectPointer, "projectId">;
  revisions!: EntityTable<StoredRevision, "revisionId">;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      projects: "&projectId,updatedAt",
      revisions: "&revisionId,projectId,[projectId+revision],createdAt",
    });
  }
}

export class ProjectRepository {
  readonly #database: TesseraDatabase;
  #failNextSave = false;

  constructor(databaseName = "tessera-studio") {
    this.#database = new TesseraDatabase(databaseName);
  }

  async save(
    state: Readonly<ProjectState>,
  ): Promise<{ revisionId: string; revision: number }> {
    // 在事务前固定快照，保存期间的新编辑属于下一修订。
    const document = stringifyProjectV1(state);
    const revisionId = `${state.projectId}:${state.revision}:${crypto.randomUUID()}`;
    const record: StoredRevision = {
      revisionId,
      projectId: state.projectId,
      revision: state.revision,
      createdAt: new Date().toISOString(),
      document,
    };
    if (this.#failNextSave) {
      this.#failNextSave = false;
      throw new Error("injected-save-failure");
    }
    await this.#database.transaction(
      "rw",
      this.#database.projects,
      this.#database.revisions,
      async () => {
        await this.#database.revisions.add(record);
        const pointer = await this.#database.projects.get(state.projectId);
        if (pointer === undefined || pointer.revision <= record.revision) {
          await this.#database.projects.put({
            projectId: state.projectId,
            currentRevisionId: revisionId,
            revision: record.revision,
            updatedAt: state.updatedAt,
          });
        }
      },
    );
    return { revisionId, revision: record.revision };
  }

  async loadLatest(): Promise<ProjectState | null> {
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
      try {
        const project = parseProjectV1(revision.document);
        if (
          pointerWasMissing ||
          revision.revisionId !== pointer.currentRevisionId
        ) {
          await this.#database.projects.put({
            projectId: pointer.projectId,
            currentRevisionId: revision.revisionId,
            revision: revision.revision,
            updatedAt: revision.createdAt,
          });
        }
        return project;
      } catch {
        // 损坏修订保持不可变，继续寻找最近一个可读取修订。
      }
    }
    throw new ProjectRecoveryError(pointer.projectId, candidates.length);
  }

  failNextSaveForTest(): void {
    this.#failNextSave = true;
  }
  async revisionCount(projectId: string): Promise<number> {
    return this.#database.revisions
      .where("projectId")
      .equals(projectId)
      .count();
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
  constructor(
    readonly projectId: string,
    readonly candidateCount: number,
  ) {
    super(`工程 ${projectId} 没有可恢复的有效修订`);
    this.name = "ProjectRecoveryError";
  }
}
