import { describe, expect, it, vi } from "vitest";
import { startRendererInitialization } from "./renderer-initialization.js";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("startRendererInitialization", () => {
  it("初始化完成后由 cleanup 严格销毁一次", async () => {
    const renderer = {
      initialize: vi.fn(async () => undefined),
      destroy: vi.fn(),
    };
    const onReady = vi.fn();
    const control = startRendererInitialization(renderer, {
      onReady,
      onFailure: vi.fn(),
    });

    await control.completion;
    expect(onReady).toHaveBeenCalledOnce();
    control.dispose();
    control.dispose();
    expect(renderer.destroy).toHaveBeenCalledOnce();
  });

  it("pending cleanup 立即销毁，后续 fulfilled 不重复进入 ready", async () => {
    const pending = deferred();
    const renderer = {
      initialize: vi.fn(() => pending.promise),
      destroy: vi.fn(),
    };
    const onReady = vi.fn();
    const control = startRendererInitialization(renderer, {
      onReady,
      onFailure: vi.fn(),
    });

    control.dispose();
    expect(renderer.destroy).toHaveBeenCalledOnce();
    pending.resolve();
    await control.completion;
    expect(onReady).not.toHaveBeenCalled();
    expect(renderer.destroy).toHaveBeenCalledOnce();
  });

  it("初始化 reject 报告原始错误并销毁一次", async () => {
    const failure = new Error("webgl-init-failed");
    const renderer = {
      initialize: vi.fn(async () => Promise.reject(failure)),
      destroy: vi.fn(),
    };
    const onFailure = vi.fn();
    const control = startRendererInitialization(renderer, {
      onReady: vi.fn(),
      onFailure,
    });

    await control.completion;
    expect(onFailure).toHaveBeenCalledWith(failure, false);
    control.dispose();
    expect(renderer.destroy).toHaveBeenCalledOnce();
  });

  it("pending cleanup 后 reject 仍保留诊断且不重复销毁", async () => {
    const pending = deferred();
    const failure = new Error("late-webgl-init-failed");
    const renderer = {
      initialize: vi.fn(() => pending.promise),
      destroy: vi.fn(),
    };
    const onFailure = vi.fn();
    const control = startRendererInitialization(renderer, {
      onReady: vi.fn(),
      onFailure,
    });

    control.dispose();
    pending.reject(failure);
    await control.completion;
    expect(onFailure).toHaveBeenCalledWith(failure, true);
    expect(renderer.destroy).toHaveBeenCalledOnce();
  });
});
