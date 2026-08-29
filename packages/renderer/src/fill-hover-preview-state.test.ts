import { describe, expect, it, vi } from "vitest";
import type { BackgroundTask, CellCoordinate } from "@tessera/core";
import { FillHoverPreviewState } from "./fill-hover-preview-state.js";

function deferredTask() {
  let resolve!: (value: readonly CellCoordinate[]) => void;
  let reject!: (reason: unknown) => void;
  const result = new Promise<readonly CellCoordinate[]>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  const cancel = vi.fn();
  const task: BackgroundTask<readonly CellCoordinate[]> = {
    taskId: crypto.randomUUID(),
    subscribeProgress: () => () => undefined,
    cancel,
    result,
  };
  return { task, cancel, resolve, reject };
}

describe("填充 hover 异步世代", () => {
  it("记录完整数量但只保留视口内格子", async () => {
    const changed = vi.fn();
    const state = new FillHoverPreviewState(changed);
    const deferred = deferredTask();
    state.begin("square", new Set(["cell:square:1:1"]), {
      task: deferred.task,
      requiresConfirmation: true,
    });
    expect(state.snapshot.status).toBe("pending");

    deferred.resolve([
      { row: 1, column: 1 },
      { row: 1, column: 2 },
      { row: 20, column: 20 },
    ]);
    await deferred.task.result;
    await Promise.resolve();

    expect(state.snapshot).toMatchObject({
      status: "requires-confirmation",
      count: 3,
    });
    expect([...state.snapshot.visibleCellIds]).toEqual(["cell:square:1:1"]);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("新世代取消旧任务且旧结果不能回写", async () => {
    const state = new FillHoverPreviewState();
    const first = deferredTask();
    const second = deferredTask();
    state.begin("square", new Set(), {
      task: first.task,
      requiresConfirmation: false,
    });
    state.begin("square", new Set(["cell:square:2:2"]), {
      task: second.task,
      requiresConfirmation: false,
    });
    expect(first.cancel).toHaveBeenCalledTimes(1);

    first.resolve([{ row: 1, column: 1 }]);
    await first.task.result;
    await Promise.resolve();
    expect(state.snapshot.status).toBe("pending");

    second.resolve([{ row: 2, column: 2 }]);
    await second.task.result;
    await Promise.resolve();
    expect(state.snapshot).toMatchObject({ status: "valid", count: 1 });
  });

  it("清理与失败都不会留下残缺区域", async () => {
    const state = new FillHoverPreviewState();
    const cleared = deferredTask();
    state.begin("hex-pointy", new Set(), {
      task: cleared.task,
      requiresConfirmation: false,
    });
    state.clear();
    expect(cleared.cancel).toHaveBeenCalledTimes(1);
    expect(state.snapshot.status).toBe("none");

    const failed = deferredTask();
    state.begin("hex-pointy", new Set(), {
      task: failed.task,
      requiresConfirmation: false,
    });
    failed.reject(new Error("too-large"));
    await expect(failed.task.result).rejects.toThrow("too-large");
    await Promise.resolve();
    expect(state.snapshot).toMatchObject({ status: "invalid", count: 0 });
    expect(state.snapshot.visibleCellIds.size).toBe(0);
  });
});
