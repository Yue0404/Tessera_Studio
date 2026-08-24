import { createProject, EditorStore } from "@tessera/core";
import { describe, expect, it, vi } from "vitest";
import { planVisualExport } from "./plan.js";
import { captureVisualExportSnapshot } from "./snapshot.js";
import { serializeVisualExportSvg, type VisualExportSvgLimits } from "./svg.js";
import { startVisualExport, type VisualExportTask } from "./task.js";
import type { VisualExportPlan, VisualPrimitive } from "./types.js";

function createSvgPlan(lineCount = 3): VisualExportPlan {
  const store = new EditorStore(
    createProject({
      name: "SVG executor",
      grid: { type: "square", width: 2, height: 2, cellSize: 20 },
      style: {
        canvasBackground: "#09141DFF",
        defaultCellColor: "#14232DFF",
        gridColor: "#59656AFF",
        gridOpacity: 0.7,
        gridWidth: 1,
        defaultEdgeColor: "#59656AFF",
      },
    }),
  );
  store.placeText(
    { x: 20, y: 20 },
    Array.from({ length: lineCount }, (_, index) => `第${index}行`).join("\n"),
    { fontSize: 10 },
  );
  return planVisualExport(captureVisualExportSnapshot(store.state), {
    format: "svg",
    range: { kind: "full-map" },
    background: { kind: "transparent" },
    showGrid: false,
  });
}

describe("SVG 单遍异步 executor", () => {
  it("长 SVG 至少 yield 一次并在 100ms 后产生中间进度", async () => {
    let clock = 0;
    let yields = 0;
    const progress: number[] = [];
    const task = startVisualExport(createSvgPlan(8), {
      createTaskId: () => "svg-long",
      svgBatchNodes: 2,
      now: () => clock,
      yieldControl: async () => {
        yields += 1;
        clock += 60;
      },
    });
    task.subscribeProgress((event) => progress.push(event.progress));
    await task.result;
    expect(yields).toBeGreaterThan(0);
    expect(progress.some((value) => value > 0 && value < 1)).toBe(true);
    expect(progress.at(-1)).toBe(1);
  });

  it("yield 点取消立即拒绝且绝不创建部分 Blob", async () => {
    const createBlob = vi.fn(() => new Blob());
    const holder: { task: VisualExportTask | null } = { task: null };
    let yields = 0;
    const task = startVisualExport(createSvgPlan(8), {
      createTaskId: () => "svg-cancel",
      svgBatchNodes: 2,
      createSvgBlob: createBlob,
      yieldControl: async () => {
        yields += 1;
        holder.task?.cancel();
      },
    });
    holder.task = task;
    await expect(task.result).rejects.toMatchObject({
      code: "visual-export-cancelled",
    });
    expect(yields).toBe(1);
    expect(createBlob).not.toHaveBeenCalled();
  });

  it("同步与异步路径共享 fragment 规则并逐字节一致", async () => {
    const plan = createSvgPlan(5);
    const synchronous = serializeVisualExportSvg(plan);
    const asynchronous = await startVisualExport(plan, {
      svgBatchNodes: 2,
      yieldControl: () => Promise.resolve(),
    }).result;
    expect(await asynchronous.blob.text()).toBe(synchronous);
  });

  it("SVG 保留扩展描边数组、端帽与文字换行背景事实", () => {
    const plan = createSvgPlan();
    const primitives: VisualPrimitive[] = [
      {
        kind: "stroke",
        layerId: "tessera.basic.annotation",
        zIndex: 5000,
        orderInLayer: 0,
        stableId: "exact-stroke",
        partRank: 0,
        originalStart: { x: 0, y: 0 },
        originalEnd: { x: 40, y: 0 },
        start: { x: 0, y: 0 },
        end: { x: 40, y: 0 },
        strokeColor: "#FFFFFFFF",
        strokeWidth: 2,
        opacity: 1,
        lineStyle: "dashed",
        dashPattern: [3, 5],
        lineCap: "butt",
      },
      {
        kind: "text",
        layerId: "tessera.basic.annotation",
        zIndex: 5000,
        orderInLayer: 0,
        stableId: "exact-text",
        partRank: 0,
        point: { x: 20, y: 20 },
        text: "abcdef",
        fontSize: 20,
        fontWeight: "normal",
        align: "center",
        rotation: 0,
        color: "#FFFFFFFF",
        opacity: 1,
        backgroundColor: "#112233CC",
        wrapWidth: 24,
      },
    ];
    const svg = serializeVisualExportSvg(plan, undefined, {
      iteratePrimitives: () => primitives,
    });
    expect(svg).toContain('stroke-dasharray="3 5"');
    expect(svg).toContain('stroke-linecap="butt"');
    expect(svg).toContain('fill="#112233"');
    expect(svg.match(/<tspan/gu)).toHaveLength(3);
  });

  it("单遍 writer 不会重复消费 primitive iterable", () => {
    const plan = createSvgPlan();
    let iteratorCalls = 0;
    let yieldedPrimitives = 0;
    const primitive: VisualPrimitive = {
      kind: "polygon",
      layerId: "tessera.basic.annotation",
      zIndex: 5000,
      orderInLayer: 0,
      stableId: "single-pass",
      partRank: 0,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ],
      fillColor: "#FFFFFFFF",
      opacity: 1,
    };
    const text = serializeVisualExportSvg(
      plan,
      { maxNodes: 100, maxUtf8Bytes: 100_000 },
      {
        iteratePrimitives: () => {
          iteratorCalls += 1;
          return {
            *[Symbol.iterator]() {
              yieldedPrimitives += 1;
              yield primitive;
            },
          };
        },
      },
    );
    expect(iteratorCalls).toBe(1);
    expect(yieldedPrimitives).toBe(1);
    expect(text.match(/<polygon/gu)).toHaveLength(1);
  });

  it("注入小阈值等价验证实际 node/UTF-8 守门和错误动作", async () => {
    const plan = createSvgPlan(4);
    const nodeLimits: VisualExportSvgLimits = {
      maxNodes: plan.estimatedPrimitiveCount - 1,
      maxUtf8Bytes: 1_000_000,
    };
    expect(() => serializeVisualExportSvg(plan, nodeLimits)).toThrowError(
      expect.objectContaining({
        code: "visual-export-svg-primitive-limit-exceeded",
        uiAction: "reduce-range",
        details: expect.objectContaining({
          suggestedActions: ["reduce-scale", "reduce-range", "tile-export"],
        }),
      }),
    );
    expect(() =>
      serializeVisualExportSvg(plan, {
        maxNodes: 1_000,
        maxUtf8Bytes: 32,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "visual-export-svg-byte-limit-exceeded",
        uiAction: "reduce-range",
      }),
    );
    const task = startVisualExport(plan, {
      svgLimits: nodeLimits,
      svgBatchNodes: 2,
      yieldControl: () => Promise.resolve(),
    });
    await expect(task.result).rejects.toMatchObject({
      code: "visual-export-svg-primitive-limit-exceeded",
      uiAction: "reduce-range",
    });
  });
});
