import { createProject, EditorStore } from "@tessera/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMainThreadCanvasSurface } from "./png-executor.js";
import { planVisualExport } from "./plan.js";
import { captureVisualExportSnapshot } from "./snapshot.js";
import { startVisualExport, type VisualExportWorkerLike } from "./task.js";
import type {
  VisualExportCanvasCapabilities,
  VisualExportPlan,
  VisualExportRequest,
} from "./types.js";

const fallbackCapabilities: VisualExportCanvasCapabilities = {
  maxWidth: 8192,
  maxHeight: 8192,
  maxPixels: 67_108_864,
  worker: false,
  offscreenCanvas2d: false,
  offscreenConvertToBlob: false,
};

const workerCapabilities: VisualExportCanvasCapabilities = {
  ...fallbackCapabilities,
  worker: true,
  offscreenCanvas2d: true,
  offscreenConvertToBlob: true,
};

function createPlan(
  format: "png" | "svg" = "png",
  width = 4,
  height = 4,
  scale: 1 | 2 | 4 = 1,
): VisualExportPlan {
  const store = new EditorStore(
    createProject({
      name: "任务测试",
      grid: { type: "square", width, height, cellSize: 10 },
      style: {
        canvasBackground: "#102030FF",
        defaultCellColor: "#405060FF",
        gridColor: "#FFFFFFFF",
        gridOpacity: 1,
        gridWidth: 1,
        defaultEdgeColor: "#FFFFFFFF",
      },
    }),
  );
  const common = {
    range: { kind: "full-map" } as const,
    background: { kind: "transparent" } as const,
    showGrid: false,
  };
  const request: VisualExportRequest =
    format === "png" ? { ...common, format, scale } : { ...common, format };
  return planVisualExport(captureVisualExportSnapshot(store.state), request);
}

function pngBlob(): Blob {
  return new Blob([new Uint8Array([137, 80, 78, 71])], {
    type: "image/png",
  });
}

function fakeContext(calls: unknown[][] = []) {
  const call =
    (name: string) =>
    (...values: unknown[]) =>
      void calls.push([name, ...values]);
  return {
    save: call("save"),
    restore: call("restore"),
    setTransform: call("setTransform"),
    beginPath: call("beginPath"),
    rect: call("rect"),
    clip: call("clip"),
    fillRect: call("fillRect"),
    moveTo: call("moveTo"),
    lineTo: call("lineTo"),
    closePath: call("closePath"),
    fill: call("fill"),
    stroke: call("stroke"),
    setLineDash: call("setLineDash"),
    translate: call("translate"),
    rotate: call("rotate"),
    arc: call("arc"),
    roundRect: call("roundRect"),
    fillText: call("fillText"),
    globalAlpha: 1,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    lineDashOffset: 0,
    font: "",
    textAlign: "start",
    textBaseline: "alphabetic",
  } as unknown as CanvasRenderingContext2D;
}

function fallbackSurface(
  calls: unknown[][] = [],
  encodePng: () => Promise<Blob> = async () => pngBlob(),
) {
  return { context: fakeContext(calls), encodePng };
}

class FakeWorker implements VisualExportWorkerLike {
  onmessage: VisualExportWorkerLike["onmessage"] = null;
  onerror: VisualExportWorkerLike["onerror"] = null;
  readonly postMessage = vi.fn();
  readonly terminate = vi.fn();
}

afterEach(() => vi.restoreAllMocks());

describe("统一视觉导出任务", () => {
  it("能力不足走分批 fallback，并按 bounds 与 scale 设置坐标变换", async () => {
    const plan = {
      ...createPlan(),
      bounds: { minX: 10, minY: 20, maxX: 30, maxY: 40 },
      scale: 2 as const,
      pixelWidth: 40,
      pixelHeight: 40,
    };
    const calls: unknown[][] = [];
    const task = startVisualExport(plan, {
      capabilities: fallbackCapabilities,
      createCanvasSurface: () => fallbackSurface(calls),
      createTaskId: () => "fallback-task",
      yieldControl: () => Promise.resolve(),
    });
    await expect(task.result).resolves.toMatchObject({
      executionMode: "fallback",
      width: 40,
      height: 40,
    });
    expect(calls).toContainEqual(["setTransform", 2, 0, 0, 2, -20, -40]);
  });

  it("能力满足时首选 Worker，结果完成后终止 Worker", async () => {
    const worker = new FakeWorker();
    worker.postMessage.mockImplementation(() => {
      queueMicrotask(() =>
        worker.onmessage?.(
          new MessageEvent("message", {
            data: {
              type: "result",
              taskId: "worker-task",
              result: {
                format: "png",
                mimeType: "image/png",
                blob: pngBlob(),
                width: 40,
                height: 40,
                executionMode: "worker",
              },
            },
          }),
        ),
      );
    });
    const task = startVisualExport(createPlan(), {
      capabilities: workerCapabilities,
      createWorker: () => worker,
      createTaskId: () => "worker-task",
    });
    await expect(task.result).resolves.toMatchObject({
      executionMode: "worker",
    });
    expect(worker.postMessage).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("资源 PNG 明确绕过 Worker，主线程完成后只释放一次解码句柄", async () => {
    const basePlan = createPlan();
    const plan: VisualExportPlan = {
      ...basePlan,
      snapshot: {
        ...basePlan.snapshot,
        resources: [
          {
            key: "resource-000000",
            identity: {
              moduleId: "example.weather",
              version: "1.0.0",
              resourceId: "example.weather:image.marker",
            },
            kind: "image",
            mimeType: "image/png",
            bytes: new Uint8Array([1, 2, 3]),
            width: 2,
            height: 1,
          },
        ],
      },
    };
    const createWorker = vi.fn(() => new FakeWorker());
    const handle = {} as CanvasImageSource;
    const releaseImage = vi.fn();
    const result = await startVisualExport(plan, {
      capabilities: workerCapabilities,
      createWorker,
      createCanvasSurface: () => fallbackSurface(),
      pngResourceEnvironment: {
        decodeImage: async () => handle,
        loadFont: async () => ({}),
        releaseImage,
        releaseFont: vi.fn(),
      },
    }).result;

    expect(result.executionMode).toBe("fallback");
    expect(createWorker).not.toHaveBeenCalled();
    expect(releaseImage).toHaveBeenCalledTimes(1);
    expect(releaseImage).toHaveBeenCalledWith(handle);
  });

  it.each([1, 2, 4] as const)("PNG %d 倍率生成对应像素尺寸", async (scale) => {
    const plan = createPlan("png", 4, 4, scale);
    const calls: unknown[][] = [];
    const result = await startVisualExport(plan, {
      capabilities: fallbackCapabilities,
      createCanvasSurface: () => fallbackSurface(calls),
      yieldControl: () => Promise.resolve(),
    }).result;
    expect(result.width).toBe(40 * scale);
    expect(result.height).toBe(40 * scale);
    const transform = calls.find(([name]) => name === "setTransform");
    expect(transform?.slice(0, 5)).toEqual([
      "setTransform",
      scale,
      0,
      0,
      scale,
    ]);
    expect(Math.abs(Number(transform?.[5]))).toBe(0);
    expect(Math.abs(Number(transform?.[6]))).toBe(0);
  });

  it("Worker 基础设施失败会丢弃其状态并从头 fallback", async () => {
    const worker = new FakeWorker();
    worker.postMessage.mockImplementation(() =>
      queueMicrotask(() => worker.onerror?.(new ErrorEvent("error"))),
    );
    const createCanvasSurface = vi.fn(() => fallbackSurface());
    const task = startVisualExport(createPlan(), {
      capabilities: workerCapabilities,
      createWorker: () => worker,
      createCanvasSurface,
      createTaskId: () => "worker-fallback",
      yieldControl: () => Promise.resolve(),
    });
    await expect(task.result).resolves.toMatchObject({
      executionMode: "fallback",
    });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(createCanvasSurface).toHaveBeenCalledOnce();
  });

  it("Worker 返回的稳定执行错误不会泄露原生异常", async () => {
    const worker = new FakeWorker();
    worker.postMessage.mockImplementation(() => {
      queueMicrotask(() =>
        worker.onmessage?.(
          new MessageEvent("message", {
            data: {
              type: "error",
              taskId: "worker-error",
              error: {
                code: "visual-export-canvas-context-unavailable",
                details: {
                  suggestedActions: [
                    "reduce-scale",
                    "reduce-range",
                    "tile-export",
                  ],
                },
                uiAction: "reduce-scale",
              },
            },
          }),
        ),
      );
    });
    const task = startVisualExport(createPlan(), {
      capabilities: workerCapabilities,
      createWorker: () => worker,
      createTaskId: () => "worker-error",
    });
    await expect(task.result).rejects.toMatchObject({
      code: "visual-export-canvas-context-unavailable",
      uiAction: "reduce-scale",
    });
  });

  it("超过 100ms 后发布单调进度，退订后不再收到通知，完成为 1", async () => {
    let clock = 0;
    const events: number[] = [];
    const task = startVisualExport(createPlan("png", 5, 5), {
      capabilities: fallbackCapabilities,
      createCanvasSurface: () => fallbackSurface(),
      createTaskId: () => "progress-task",
      now: () => clock,
      fallbackBatchSize: 1,
      yieldControl: async () => {
        clock += 60;
      },
    });
    const unsubscribe = task.subscribeProgress((event) => {
      events.push(event.progress);
      if (events.length === 2) unsubscribe();
    });
    await task.result;
    expect(events.length).toBe(2);
    expect(events[0]).toBeGreaterThan(0);
    expect(events[1]).toBeGreaterThanOrEqual(events[0] ?? 0);
  });

  it("fallback 批次取消立即拒绝且不返回部分 Blob", async () => {
    let resume!: () => void;
    const paused = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const task = startVisualExport(createPlan("png", 8, 8), {
      capabilities: fallbackCapabilities,
      createCanvasSurface: () => fallbackSurface(),
      createTaskId: () => "cancel-fallback",
      fallbackBatchSize: 1,
      yieldControl: () => paused,
    });
    await Promise.resolve();
    task.cancel();
    await expect(task.result).rejects.toMatchObject({
      code: "visual-export-cancelled",
    });
    resume();
  });

  it("编码回调迟到时取消仍立即拒绝并忽略 Blob", async () => {
    let resolveEncode!: (blob: Blob) => void;
    const encode = new Promise<Blob>((resolve) => {
      resolveEncode = resolve;
    });
    const task = startVisualExport(createPlan(), {
      capabilities: fallbackCapabilities,
      createCanvasSurface: () => fallbackSurface([], () => encode),
      createTaskId: () => "cancel-encode",
      yieldControl: () => Promise.resolve(),
    });
    await Promise.resolve();
    await Promise.resolve();
    task.cancel();
    await expect(task.result).rejects.toMatchObject({
      code: "visual-export-cancelled",
    });
    resolveEncode(pngBlob());
    await Promise.resolve();
  });

  it("取消 Worker 会立即 terminate 并稳定拒绝", async () => {
    const worker = new FakeWorker();
    const task = startVisualExport(createPlan(), {
      capabilities: workerCapabilities,
      createWorker: () => worker,
      createTaskId: () => "cancel-worker",
    });
    await Promise.resolve();
    task.cancel();
    await expect(task.result).rejects.toMatchObject({
      code: "visual-export-cancelled",
    });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("allocation 与 encode 原生异常转换为稳定错误", async () => {
    const allocation = startVisualExport(createPlan(), {
      capabilities: fallbackCapabilities,
      createCanvasSurface: () => {
        throw new DOMException("native allocation detail");
      },
    });
    await expect(allocation.result).rejects.toMatchObject({
      code: "visual-export-canvas-allocation-failed",
      details: {
        suggestedActions: ["reduce-scale", "reduce-range", "tile-export"],
      },
    });

    const encode = startVisualExport(createPlan(), {
      capabilities: fallbackCapabilities,
      createCanvasSurface: () =>
        fallbackSurface([], () =>
          Promise.reject(new DOMException("native encode detail")),
        ),
      yieldControl: () => Promise.resolve(),
    });
    await expect(encode.result).rejects.toMatchObject({
      code: "visual-export-png-encode-failed",
    });
  });

  it("Canvas 2D context 缺失返回稳定错误", () => {
    vi.spyOn(document, "createElement").mockReturnValue({
      getContext: () => null,
    } as unknown as HTMLCanvasElement);
    expect(() => createMainThreadCanvasSurface(10, 10)).toThrowError(
      expect.objectContaining({
        code: "visual-export-canvas-context-unavailable",
      }),
    );
  });

  it("taskId 不进入确定性 SVG 产物", async () => {
    const plan = createPlan("svg");
    const first = startVisualExport(plan, {
      createTaskId: () => "runtime-task-a",
    });
    const second = startVisualExport(plan, {
      createTaskId: () => "runtime-task-b",
    });
    const [left, right] = await Promise.all([first.result, second.result]);
    const leftText = await left.blob.text();
    const rightText = await right.blob.text();
    expect(leftText).toBe(rightText);
    expect(leftText).not.toContain("runtime-task");
  });

  it("快速 SVG 任务仍向预先订阅者发布完成进度 1", async () => {
    const task = startVisualExport(createPlan("svg"), {
      createTaskId: () => "svg-progress",
    });
    const events: number[] = [];
    task.subscribeProgress((event) => events.push(event.progress));
    await task.result;
    expect(events).toEqual([1]);
  });
});
