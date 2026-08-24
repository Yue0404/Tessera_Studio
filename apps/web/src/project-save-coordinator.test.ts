import { createProject, EditorStore, type ProjectState } from "@tessera/core";
import { restoreProjectV1, stringifyProjectV1 } from "@tessera/formats";
import { describe, expect, it, vi } from "vitest";
import { ProjectSaveCoordinator } from "./project-save-coordinator.js";

function project(name: string): ProjectState {
  return createProject({
    name,
    grid: { type: "square", width: 2, height: 2, cellSize: 24 },
    style: {
      canvasBackground: "#09141DFF",
      defaultCellColor: "#14232DFF",
      gridColor: "#59656AFF",
      gridOpacity: 0.7,
      gridWidth: 1,
      defaultEdgeColor: "#59656AFF",
    },
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function snapshot(state: Readonly<ProjectState>): ProjectState {
  return restoreProjectV1(stringifyProjectV1(state, { mode: "preserve" }));
}

describe("ProjectSaveCoordinator", () => {
  it("跨工程替换先真实保存旧编辑，并让新工程保持为 latest", async () => {
    const previous = project("旧工程");
    new EditorStore(previous).paintCell(0, 0, "#336699FF");
    const next = project("新工程");
    const firstSave = deferred();
    const firstStarted = deferred();
    const savedNames: string[] = [];
    const repositoryState: { latest: ProjectState | null } = { latest: null };
    const target = {
      save: vi.fn(async (state: Readonly<ProjectState>) => {
        savedNames.push(state.name);
        if (savedNames.length === 1) {
          firstStarted.resolve();
          await firstSave.promise;
        }
        repositoryState.latest = snapshot(state);
      }),
    };
    const coordinator = new ProjectSaveCoordinator(target);

    const replacing = coordinator
      .replacementTarget(previous, { candidateIncludesPrevious: false })
      .save(next);
    await firstStarted.promise;
    expect(savedNames).toEqual(["旧工程"]);
    firstSave.resolve();
    await replacing;

    expect(savedNames).toEqual(["旧工程", "新工程"]);
    expect(target.save.mock.calls[0]?.[0].cells.size).toBe(1);
    expect(repositoryState.latest?.name).toBe("新工程");
  });

  it("派生候选成功后，晚到的旧保存不会覆盖候选", async () => {
    const previous = project("旧工程");
    const next = project("派生候选");
    const candidateSave = deferred();
    const candidateStarted = deferred();
    const repositoryState: { latest: ProjectState | null } = { latest: null };
    const target = {
      save: vi.fn(async (state: Readonly<ProjectState>) => {
        candidateStarted.resolve();
        await candidateSave.promise;
        repositoryState.latest = snapshot(state);
      }),
    };
    const coordinator = new ProjectSaveCoordinator(target);

    const replacing = coordinator
      .replacementTarget(previous, { candidateIncludesPrevious: true })
      .save(next);
    await candidateStarted.promise;
    const latePreviousSave = coordinator.save(previous);
    expect(target.save).toHaveBeenCalledTimes(1);

    candidateSave.resolve();
    await Promise.all([replacing, latePreviousSave]);
    expect(target.save).toHaveBeenCalledTimes(1);
    expect(repositoryState.latest?.name).toBe("派生候选");
  });

  it("派生候选失败后，晚到旧保存等待真实落盘并保留编辑", async () => {
    const previous = project("旧工程");
    new EditorStore(previous).paintCell(0, 0, "#336699FF");
    const next = project("失败候选");
    const candidateSave = deferred();
    const candidateStarted = deferred();
    const fallbackSave = deferred();
    const fallbackStarted = deferred();
    const candidateError = new Error("candidate-save-failed");
    const repositoryState: { latest: ProjectState | null } = { latest: null };
    let callCount = 0;
    const target = {
      save: vi.fn(async (state: Readonly<ProjectState>) => {
        callCount += 1;
        if (callCount === 1) {
          candidateStarted.resolve();
          await candidateSave.promise;
          throw candidateError;
        }
        fallbackStarted.resolve();
        await fallbackSave.promise;
        repositoryState.latest = snapshot(state);
      }),
    };
    const coordinator = new ProjectSaveCoordinator(target);

    const replacing = coordinator
      .replacementTarget(previous, { candidateIncludesPrevious: true })
      .save(next);
    const candidateFailure = expect(replacing).rejects.toBe(candidateError);
    await candidateStarted.promise;
    let lateSaveSettled = false;
    const latePreviousSave = coordinator.save(previous).finally(() => {
      lateSaveSettled = true;
    });

    candidateSave.resolve();
    await candidateFailure;
    await fallbackStarted.promise;
    expect(lateSaveSettled).toBe(false);
    expect(target.save).toHaveBeenCalledTimes(2);

    fallbackSave.resolve();
    await latePreviousSave;
    expect(lateSaveSettled).toBe(true);
    expect(repositoryState.latest?.name).toBe("旧工程");
    expect(
      repositoryState.latest?.cells.get("cell:square:0:0")?.fillColor,
    ).toBe("#336699FF");
  });

  it("派生候选与旧状态补存均失败时，晚到保存返回真实失败", async () => {
    const previous = project("旧工程");
    const next = project("失败候选");
    const candidateError = new Error("candidate-save-failed");
    const fallbackError = new Error("fallback-save-failed");
    let callCount = 0;
    const target = {
      save: vi.fn(async () => {
        callCount += 1;
        throw callCount === 1 ? candidateError : fallbackError;
      }),
    };
    const coordinator = new ProjectSaveCoordinator(target);

    const replacing = coordinator
      .replacementTarget(previous, { candidateIncludesPrevious: true })
      .save(next);
    const candidateFailure = expect(replacing).rejects.toBe(candidateError);
    const latePreviousSave = coordinator.save(previous);

    await candidateFailure;
    await expect(latePreviousSave).rejects.toBe(fallbackError);
    expect(target.save).toHaveBeenCalledTimes(2);
  });
});
