import { createProject, EditorStore } from "@tessera/core";
import {
  captureVisualExportSnapshot,
  hydrateVisualExportSnapshotResources,
  planVisualExport,
  resolveVisualExportBounds,
  VisualExportError,
  type VisualExportCanvasCapabilities,
  type VisualExportResult,
  type VisualPrimitive,
} from "@tessera/renderer/visual-export";
import { describe, expect, it, vi } from "vitest";
import {
  downloadVisualExportResult,
  startVisualExportWorkflow,
  visualExportErrorPresentation,
  type VisualExportWorkflowEngine,
} from "./visual-export-workflow.js";

function project() {
  return createProject({
    name: "图片/导出",
    grid: { type: "square", width: 4, height: 4, cellSize: 24 },
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

const interaction = {
  viewportBounds: { minX: 0, minY: 0, maxX: 48, maxY: 48 },
  selectionBounds: { minX: 0, minY: 0, maxX: 24, maxY: 24 },
};

describe("visual export workflow", () => {
  it("点击开始同步冻结 snapshot，后续编辑不进入 SVG", async () => {
    const store = new EditorStore(project());
    const session = await startVisualExportWorkflow(store.state, {
      format: "svg",
      range: { kind: "viewport" },
      interaction,
      background: { kind: "transparent" },
      showGrid: false,
      scale: 1,
    });
    store.paintCell(0, 0, "#FF0000FF");
    const result = await session.result;
    expect(session.plan.snapshot.cells).toHaveLength(0);
    expect(await result.blob.text()).not.toContain("#FF0000");
  });

  it("使用实际检测能力规划，并把同一能力交给任务执行器", async () => {
    const capabilities: VisualExportCanvasCapabilities = {
      maxWidth: 4096,
      maxHeight: 4096,
      maxPixels: 16_777_216,
      worker: false,
      offscreenCanvas2d: false,
      offscreenConvertToBlob: false,
    };
    const cancel = vi.fn();
    const start = vi.fn(() => ({
      taskId: "task-test",
      subscribeProgress: () => () => undefined,
      cancel,
      result: new Promise<VisualExportResult>(() => undefined),
    }));
    const engine: VisualExportWorkflowEngine = {
      captureVisualExportSnapshot,
      hydrateVisualExportSnapshotResources,
      resolveVisualExportBounds,
      detectVisualExportCanvasCapabilities: () => capabilities,
      planVisualExport,
      startVisualExport: start,
    };
    const session = await startVisualExportWorkflow(
      project(),
      {
        format: "png",
        range: { kind: "selection" },
        interaction,
        background: { kind: "color", color: "#11223344" },
        showGrid: true,
        scale: 4,
      },
      engine,
    );
    expect(session.capabilities).toBe(capabilities);
    expect(session.plan.request).toMatchObject({
      format: "png",
      scale: 4,
      showGrid: true,
      background: { kind: "color", color: "#11223344" },
      range: { kind: "selection", bounds: interaction.selectionBounds },
    });
    expect(start).toHaveBeenCalledWith(session.plan, { capabilities });
    session.cancel();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("只预取最终范围内可见 primitive 的精确资源，隐藏与范围外资源保持零读取", async () => {
    const state = project();
    const near = {
      moduleId: "example.weather",
      version: "1.0.0",
      resourceId: "example.weather:image.near",
    } as const;
    const far = {
      moduleId: "example.weather",
      version: "1.0.0",
      resourceId: "example.weather:image.secret",
    } as const;
    const hidden = {
      moduleId: "example.weather",
      version: "1.0.0",
      resourceId: "example.weather:image.hidden",
    } as const;
    const layer = state.layers.get("tessera.basic.annotation");
    if (layer === undefined) throw new Error("annotation-layer-missing");
    (state.layers as Map<string, typeof layer>).set("example.weather.hidden", {
      ...layer,
      layerId: "example.weather.hidden",
      visible: false,
    });
    const base = {
      kind: "marker",
      zIndex: layer.zIndex,
      orderInLayer: 0,
      partRank: 0,
      shape: "diamond",
      size: 12,
      rotation: 0,
      color: "#FFFFFFFF",
      opacity: 1,
    } as const;
    const primitives: VisualPrimitive[] = [
      {
        ...base,
        layerId: layer.layerId,
        stableId: "near",
        point: { x: 12, y: 12 },
        imageResource: near,
      },
      {
        ...base,
        layerId: layer.layerId,
        stableId: "far",
        point: { x: 84, y: 84 },
        imageResource: far,
      },
      {
        ...base,
        layerId: "example.weather.hidden",
        stableId: "hidden",
        point: { x: 20, y: 20 },
        imageResource: hidden,
      },
    ];
    const ready = new Map<string, Uint8Array>();
    const prepareResource = vi.fn(
      async (identity: {
        readonly moduleId: string;
        readonly version: string;
        readonly resourceId: string;
      }) => {
        ready.set(identity.resourceId, new Uint8Array([1, 2, 3]));
      },
    );
    const start = vi.fn(() => ({
      taskId: "resource-task",
      subscribeProgress: () => () => undefined,
      cancel: vi.fn(),
      result: new Promise<VisualExportResult>(() => undefined),
    }));
    const engine: VisualExportWorkflowEngine = {
      captureVisualExportSnapshot,
      hydrateVisualExportSnapshotResources,
      resolveVisualExportBounds,
      detectVisualExportCanvasCapabilities: () => ({
        maxWidth: 4096,
        maxHeight: 4096,
        maxPixels: 16_777_216,
        worker: false,
        offscreenCanvas2d: false,
        offscreenConvertToBlob: false,
      }),
      planVisualExport,
      startVisualExport: start,
    };
    const session = await startVisualExportWorkflow(
      state,
      {
        format: "png",
        range: {
          kind: "custom",
          bounds: { minX: 0, minY: 0, maxX: 48, maxY: 48 },
        },
        interaction,
        background: { kind: "transparent" },
        showGrid: false,
        scale: 1,
        captureOptions: {
          extensionRenderers: [
            { elementId: "example.weather:all", capture: () => primitives },
          ],
          requiredExtensionElementIds: ["example.weather:all"],
          prepareResource,
          resolveResource: (identity) => {
            if (identity.resourceId === far.resourceId) {
              return {
                key: identity.resourceId,
                identity,
                status: "ready" as const,
                resource: {
                  kind: "image" as const,
                  mimeType: "image/png" as const,
                  bytes: new Uint8Array(32 * 1024 * 1024 + 1),
                  width: 1,
                  height: 1,
                  handle: {},
                },
              };
            }
            const bytes = ready.get(identity.resourceId);
            return bytes === undefined
              ? undefined
              : {
                  key: identity.resourceId,
                  identity,
                  status: "ready",
                  resource: {
                    kind: "image",
                    mimeType: "image/png",
                    bytes,
                    width: 1,
                    height: 1,
                    handle: {},
                  },
                };
          },
        },
      },
      engine,
    );

    expect(prepareResource).toHaveBeenCalledTimes(1);
    expect(prepareResource).toHaveBeenCalledWith(near);
    expect(session.plan.snapshot.resources).toHaveLength(1);
    expect(session.plan.snapshot.resources[0]?.identity).toEqual(near);
    expect(
      session.plan.snapshot.resources.some(
        (resource) => resource.identity.resourceId === far.resourceId,
      ),
    ).toBe(false);
  });

  it("资源预取期间继续编辑不会污染已冻结快照", async () => {
    const store = new EditorStore(project());
    const annotationZ =
      store.state.layers.get("tessera.basic.annotation")?.zIndex ?? 0;
    const resource = {
      moduleId: "example.weather",
      version: "1.0.0",
      resourceId: "example.weather:image.near",
    } as const;
    let release!: () => void;
    const prepared = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ready = false;
    const engine: VisualExportWorkflowEngine = {
      captureVisualExportSnapshot,
      hydrateVisualExportSnapshotResources,
      resolveVisualExportBounds,
      detectVisualExportCanvasCapabilities: () => ({
        maxWidth: 4096,
        maxHeight: 4096,
        maxPixels: 16_777_216,
        worker: false,
        offscreenCanvas2d: false,
        offscreenConvertToBlob: false,
      }),
      planVisualExport,
      startVisualExport: () => ({
        taskId: "frozen-resource-task",
        subscribeProgress: () => () => undefined,
        cancel: vi.fn(),
        result: new Promise<VisualExportResult>(() => undefined),
      }),
    };
    const workflow = startVisualExportWorkflow(
      store.state,
      {
        format: "png",
        range: { kind: "viewport" },
        interaction,
        background: { kind: "transparent" },
        showGrid: false,
        scale: 1,
        captureOptions: {
          extensionRenderers: [
            {
              elementId: "example.weather:marker",
              capture: () => [
                {
                  kind: "marker",
                  layerId: "tessera.basic.annotation",
                  zIndex: annotationZ,
                  orderInLayer: 0,
                  partRank: 0,
                  stableId: "near",
                  point: { x: 12, y: 12 },
                  shape: "diamond",
                  size: 12,
                  rotation: 0,
                  color: "#FFFFFFFF",
                  opacity: 1,
                  imageResource: resource,
                },
              ],
            },
          ],
          requiredExtensionElementIds: ["example.weather:marker"],
          prepareResource: async () => {
            await prepared;
            ready = true;
          },
          resolveResource: (identity) =>
            ready
              ? {
                  key: identity.resourceId,
                  identity,
                  status: "ready",
                  resource: {
                    kind: "image",
                    mimeType: "image/png",
                    bytes: new Uint8Array([1]),
                    width: 1,
                    height: 1,
                    handle: {},
                  },
                }
              : undefined,
        },
      },
      engine,
    );

    store.paintCell(0, 0, "#FF0000FF");
    release();
    const session = await workflow;

    expect(session.plan.snapshot.cells).toHaveLength(0);
    expect(session.plan.snapshot.resources).toHaveLength(1);
  });

  it("资源预取期间可取消且不会启动导出任务", async () => {
    const controller = new AbortController();
    const start = vi.fn();
    const state = project();
    const annotationZ =
      state.layers.get("tessera.basic.annotation")?.zIndex ?? 0;
    const engine: VisualExportWorkflowEngine = {
      captureVisualExportSnapshot,
      hydrateVisualExportSnapshotResources,
      resolveVisualExportBounds,
      detectVisualExportCanvasCapabilities: () => ({
        maxWidth: 4096,
        maxHeight: 4096,
        maxPixels: 16_777_216,
        worker: false,
        offscreenCanvas2d: false,
        offscreenConvertToBlob: false,
      }),
      planVisualExport,
      startVisualExport: start,
    };
    const pending = startVisualExportWorkflow(
      state,
      {
        format: "png",
        range: { kind: "viewport" },
        interaction,
        background: { kind: "transparent" },
        showGrid: false,
        scale: 1,
        signal: controller.signal,
        captureOptions: {
          extensionRenderers: [
            {
              elementId: "example.weather:marker",
              capture: () => [
                {
                  kind: "marker",
                  layerId: "tessera.basic.annotation",
                  zIndex: annotationZ,
                  orderInLayer: 0,
                  partRank: 0,
                  stableId: "near",
                  point: { x: 12, y: 12 },
                  shape: "diamond",
                  size: 12,
                  rotation: 0,
                  color: "#FFFFFFFF",
                  opacity: 1,
                  imageResource: {
                    moduleId: "example.weather",
                    version: "1.0.0",
                    resourceId: "example.weather:image.near",
                  },
                },
              ],
            },
          ],
          requiredExtensionElementIds: ["example.weather:marker"],
          prepareResource: () => new Promise(() => undefined),
        },
      },
      engine,
    );

    controller.abort();
    await expect(pending).rejects.toMatchObject({
      code: "visual-export-cancelled",
    });
    expect(start).not.toHaveBeenCalled();
  });

  it("下载始终释放 URL，并提供稳定错误行动", () => {
    const revokeObjectURL = vi.fn();
    const result: VisualExportResult = {
      format: "png",
      mimeType: "image/png",
      blob: new Blob(["png"], { type: "image/png" }),
      width: 1,
      height: 1,
      executionMode: "fallback",
    };
    expect(() =>
      downloadVisualExportResult(result, "图片/导出", {
        createObjectURL: () => "blob:visual",
        revokeObjectURL,
        click: (_url, filename) => {
          expect(filename).toBe("图片_导出.png");
          throw new Error("blocked");
        },
      }),
    ).toThrow("visual-export-download-failed");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:visual");
    expect(
      visualExportErrorPresentation(
        new VisualExportError(
          "visual-export-png-side-limit-exceeded",
          {},
          "reduce-scale",
        ),
      ),
    ).toMatchObject({
      messageKey: "error.visualExportCapacity",
      actionKey: "visualExport.action.reduceScale",
      action: "reduce-scale",
      cancelled: false,
    });
    expect(
      visualExportErrorPresentation(
        new VisualExportError("visual-export-background-color-invalid"),
      ),
    ).toMatchObject({
      messageKey: "error.visualExportBackground",
      actionKey: "visualExport.action.resetBackground",
      action: "reset-background",
    });
    expect(
      visualExportErrorPresentation(
        new VisualExportError("visual-export-canvas-context-unavailable"),
      ),
    ).toMatchObject({
      messageKey: "error.visualExportPngUnavailable",
      actionKey: "visualExport.action.switchSvg",
      action: "switch-svg",
    });
  });

  it("视觉下载成功释放 URL，URL 创建失败不产生待回收引用", () => {
    const revokeObjectURL = vi.fn();
    const result: VisualExportResult = {
      format: "svg",
      mimeType: "image/svg+xml",
      blob: new Blob(["<svg/>"], { type: "image/svg+xml" }),
      width: 1,
      height: 1,
      executionMode: "fallback",
    };
    downloadVisualExportResult(result, "地图", {
      createObjectURL: () => "blob:success",
      revokeObjectURL,
      click: vi.fn(),
    });
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:success");

    expect(() =>
      downloadVisualExportResult(result, "地图", {
        createObjectURL: () => {
          throw new Error("allocation-failed");
        },
        revokeObjectURL,
        click: vi.fn(),
      }),
    ).toThrow("visual-export-download-failed");
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });
});
