import {
  cellId,
  createProject,
  EditorStore,
  type GridType,
  type ProjectState,
} from "@tessera/core";
import { describe, expect, it } from "vitest";
import { dashedSegments, defaultDashPattern } from "../visual-style.js";
import { VisualExportError } from "./error.js";
import { assertSvgNodeLimit, planVisualExport } from "./plan.js";
import {
  iterateVisualPrimitives,
  primitiveBounds,
  visibleContentBounds,
} from "./scene.js";
import { captureVisualExportSnapshot } from "./snapshot.js";
import { serializeVisualExportSvg } from "./svg.js";
import {
  SVG_STRUCTURAL_NODE_COUNT,
  svgTextNodeCountFromLineCount,
} from "./svg-node-count.js";
import type {
  VisualExportRequest,
  VisualExportSnapshot,
  VisualPrimitive,
} from "./types.js";

function createStore(
  type: GridType = "square",
  width = 12,
  height = 12,
  cellSize = 20,
): EditorStore {
  return new EditorStore(
    createProject({
      name: "视觉导出",
      grid: { type, width, height, cellSize },
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
}

function svgRequest(
  range: VisualExportRequest["range"] = { kind: "full-map" },
): VisualExportRequest {
  return {
    format: "svg",
    range,
    background: { kind: "transparent" },
    showGrid: false,
  };
}

function pngRequest(scale: 1 | 2 | 4 = 1): VisualExportRequest {
  return {
    format: "png",
    range: { kind: "full-map" },
    background: { kind: "transparent" },
    showGrid: false,
    scale,
  };
}

function snapshotOf(state: Readonly<ProjectState>): VisualExportSnapshot {
  return captureVisualExportSnapshot(state);
}

function snapshotWithExtensionText(lineCount: number): VisualExportSnapshot {
  const store = createStore("square", 1, 1, 20);
  store.setLayerState("tessera.basic.cell-style", { visible: false });
  const layer = store.state.layers.get("tessera.basic.annotation");
  if (layer === undefined) throw new Error("test-layer-missing");
  return captureVisualExportSnapshot(store.state, {
    extensionRenderers: [
      {
        elementId: "example.module:multiline",
        capture: () => [
          {
            kind: "text",
            layerId: layer.layerId,
            zIndex: layer.zIndex,
            orderInLayer: 0,
            stableId: "multiline",
            partRank: 0,
            point: { x: 10, y: 10 },
            text: Array.from({ length: lineCount }, () => "x").join("\n"),
            fontSize: 1,
            fontWeight: "normal",
            align: "center",
            rotation: 0,
            color: "#FFFFFFFF",
            opacity: 1,
            backgroundColor: null,
          },
        ],
      },
    ],
  });
}

describe("视觉导出快照与安全规划", () => {
  it("捕获普通不可变数据，后续编辑不改变快照", () => {
    const store = createStore();
    store.paintCell(1, 1, "#FF0000FF");
    const snapshot = snapshotOf(store.state);
    store.paintCell(2, 2, "#00FF00FF");
    expect(snapshot.cells).toHaveLength(1);
    expect(snapshot.cells[0]?.fillColor).toBe("#FF0000FF");
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.cells)).toBe(true);
    expect(Object.isFrozen(snapshot.cells[0])).toBe(true);
    expect(structuredClone(snapshot)).toEqual(snapshot);
  });

  it("未知扩展元素没有注册 renderer 时稳定拒绝", () => {
    const store = createStore();
    expect(() =>
      captureVisualExportSnapshot(store.state, {
        requiredExtensionElementIds: ["example.module:terrain"],
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "visual-export-extension-renderer-missing",
      }),
    );
  });

  it("扩展声明式 primitive 的空点集、非有限值和无效样式稳定拒绝", () => {
    const store = createStore();
    const layer = store.state.layers.get("tessera.basic.annotation");
    if (layer === undefined) throw new Error("test-layer-missing");
    const valid: Extract<VisualPrimitive, { kind: "outline" }> = {
      kind: "outline",
      layerId: layer.layerId,
      zIndex: layer.zIndex,
      orderInLayer: 0,
      stableId: "outline",
      partRank: 0,
      points: [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ],
      closed: false,
      strokeColor: "#FFFFFFFF",
      strokeWidth: 1,
      opacity: 1,
      lineStyle: "solid",
    };
    const invalid: readonly VisualPrimitive[] = [
      { ...valid, points: [] },
      { ...valid, points: [{ x: Number.POSITIVE_INFINITY, y: 0 }] },
      { ...valid, strokeWidth: -1 },
      { ...valid, strokeColor: "red" },
      { ...valid, opacity: 2 },
      { ...valid, layerId: "missing.layer" },
    ];
    for (const descriptor of invalid) {
      expect(() =>
        captureVisualExportSnapshot(store.state, {
          extensionRenderers: [
            {
              elementId: "example.module:outline",
              capture: () => [descriptor],
            },
          ],
        }),
      ).toThrowError(
        expect.objectContaining({
          code: "visual-export-extension-primitive-invalid",
        }),
      );
    }
  });

  it("只剩隐藏内容时 content-bounds 视为空", () => {
    const store = createStore();
    store.paintCell(1, 1, "#FF0000FF");
    store.setLayerState("tessera.basic.cell-style", { visible: false });
    expect(() =>
      planVisualExport(
        snapshotOf(store.state),
        svgRequest({ kind: "content-bounds" }),
      ),
    ).toThrowError(
      expect.objectContaining({ code: "visual-export-content-empty" }),
    );
  });

  it("完全透明的覆盖内容不进入 content-bounds", () => {
    const store = createStore();
    store.paintCell(1, 1, "#FF000000");
    expect(() =>
      planVisualExport(
        snapshotOf(store.state),
        svgRequest({ kind: "content-bounds" }),
      ),
    ).toThrowError(
      expect.objectContaining({ code: "visual-export-content-empty" }),
    );
  });

  it("content-bounds 包含单元格标签和连接箭头的视觉外包围盒", () => {
    const store = createStore("square", 20, 20, 20);
    store.paintCell(2, 2, "#FF0000FF");
    const id = cellId("square", 2, 2);
    const cell = store.state.cells.get(id);
    if (cell === undefined) throw new Error("test-cell-missing");
    store.state.cells.set(id, { ...cell, label: "城市" });
    store.createConnection(
      { kind: "map-point", point: { x: 80, y: 80 } },
      { kind: "map-point", point: { x: 160, y: 80 } },
      { kind: "arrow", arrowMode: "both", label: "道路" },
    );
    const bounds = visibleContentBounds(snapshotOf(store.state));
    expect(bounds).not.toBeNull();
    expect(bounds?.minX).toBeLessThan(80);
    expect(bounds?.maxX).toBeGreaterThan(160);
  });

  it("content-bounds 将 outline 描边向外扩 strokeWidth 的一半", () => {
    const store = createStore();
    store.setLayerState("tessera.basic.cell-style", { visible: false });
    const layer = store.state.layers.get("tessera.basic.annotation");
    if (layer === undefined) throw new Error("test-layer-missing");
    const outline: VisualPrimitive = {
      kind: "outline",
      layerId: layer.layerId,
      zIndex: layer.zIndex,
      orderInLayer: 0,
      stableId: "wide-outline",
      partRank: 0,
      points: [
        { x: 5, y: 5 },
        { x: 15, y: 5 },
      ],
      closed: false,
      strokeColor: "#FFFFFFFF",
      strokeWidth: 4,
      opacity: 1,
      lineStyle: "solid",
    };
    const snapshot = captureVisualExportSnapshot(store.state, {
      extensionRenderers: [
        {
          elementId: "example.module:outline",
          capture: () => [outline],
        },
      ],
    });
    expect(primitiveBounds(outline)).toEqual({
      minX: 3,
      minY: 3,
      maxX: 17,
      maxY: 7,
    });
    expect(visibleContentBounds(snapshot)).toEqual({
      minX: 3,
      minY: 3,
      maxX: 17,
      maxY: 7,
    });
  });

  it("PNG 精确接受 8192 单边并在下一像素拒绝", () => {
    const accepted = createStore("square", 8192, 1, 1);
    accepted.setLayerState("tessera.basic.cell-style", { visible: false });
    expect(
      planVisualExport(snapshotOf(accepted.state), pngRequest()).pixelWidth,
    ).toBe(8192);
    const rejected = createStore("square", 8193, 1, 1);
    rejected.setLayerState("tessera.basic.cell-style", { visible: false });
    expect(() =>
      planVisualExport(snapshotOf(rejected.state), pngRequest()),
    ).toThrowError(
      expect.objectContaining({
        code: "visual-export-png-side-limit-exceeded",
      }),
    );
  });

  it("使用注入画布能力并在倍率乘法前后执行安全整数检查", () => {
    const store = createStore("square", 100, 100, 10);
    expect(() =>
      planVisualExport(snapshotOf(store.state), pngRequest(2), {
        maxWidth: 1999,
        maxHeight: 8192,
        maxPixels: 67_108_864,
        worker: false,
        offscreenCanvas2d: false,
        offscreenConvertToBlob: false,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "visual-export-png-side-limit-exceeded",
      }),
    );
  });

  it("40000² 微型格在生成前由派生格工作量保护拒绝", () => {
    const store = createStore("square", 40_000, 40_000, 0.01);
    expect(() =>
      planVisualExport(snapshotOf(store.state), pngRequest()),
    ).toThrowError(
      expect.objectContaining({
        code: "visual-export-derived-cell-limit-exceeded",
        uiAction: "reduce-range",
      }),
    );
  });

  it("SVG DOM 节点计数包含每行 tspan，并精确覆盖 250000 边界", () => {
    expect(
      SVG_STRUCTURAL_NODE_COUNT + svgTextNodeCountFromLineCount(249_993, false),
    ).toBe(250_000);
    expect(
      SVG_STRUCTURAL_NODE_COUNT + svgTextNodeCountFromLineCount(249_994, false),
    ).toBe(250_001);
    expect(() => assertSvgNodeLimit(250_000)).not.toThrow();
    expect(() => assertSvgNodeLimit(250_001)).toThrowError(
      expect.objectContaining({
        code: "visual-export-svg-primitive-limit-exceeded",
      }),
    );

    const plan = planVisualExport(snapshotWithExtensionText(3), svgRequest());
    expect(plan.estimatedPrimitiveCount).toBe(10);
    const parsed = new DOMParser().parseFromString(
      serializeVisualExportSvg(plan),
      "image/svg+xml",
    );
    expect(parsed.querySelectorAll("*")).toHaveLength(10);
  });

  it("无效、非有限和完全越界矩形稳定拒绝", () => {
    const snapshot = snapshotOf(createStore().state);
    for (const bounds of [
      { minX: 2, minY: 0, maxX: 1, maxY: 1 },
      { minX: 0, minY: 0, maxX: Number.NaN, maxY: 1 },
      { minX: 999, minY: 999, maxX: 1000, maxY: 1000 },
    ]) {
      expect(() =>
        planVisualExport(snapshot, svgRequest({ kind: "custom", bounds })),
      ).toThrow(VisualExportError);
    }
  });

  it("PNG 运行时只接受 1、2、4 倍率", () => {
    const request = {
      ...pngRequest(),
      scale: 3,
    } as unknown as VisualExportRequest;
    expect(() =>
      planVisualExport(snapshotOf(createStore().state), request),
    ).toThrowError(
      expect.objectContaining({
        code: "visual-export-scale-invalid",
        uiAction: "reduce-scale",
      }),
    );
  });

  it("plan 复制并冻结 request/bounds，规划后修改调用方对象不产生 TOCTOU", () => {
    const request: {
      format: "png";
      scale: 1 | 2 | 4;
      range: {
        kind: "custom";
        bounds: { minX: number; minY: number; maxX: number; maxY: number };
      };
      background: { kind: "color"; color: string };
      showGrid: boolean;
    } = {
      format: "png",
      scale: 1,
      range: {
        kind: "custom",
        bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      },
      background: { kind: "color", color: "#112233FF" },
      showGrid: false,
    };
    const plan = planVisualExport(snapshotOf(createStore().state), request);
    request.scale = 4;
    request.background.color = "#FFFFFFFF";
    request.range.bounds.maxX = 10;
    expect(plan.scale).toBe(1);
    expect(plan.request.background).toEqual({
      kind: "color",
      color: "#112233FF",
    });
    expect(plan.bounds.maxX).toBe(100);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.request)).toBe(true);
    expect(Object.isFrozen(plan.request.range)).toBe(true);
    expect(Object.isFrozen(plan.bounds)).toBe(true);
    expect(() => {
      (plan as unknown as { pixelWidth: number }).pixelWidth = 1;
    }).toThrow(TypeError);
    expect(structuredClone(plan)).toEqual(plan);
  });

  it("地图宽高必须在 1..40000 且 cellSize 必须有限大于零", () => {
    const snapshot = snapshotOf(createStore().state);
    for (const grid of [
      { ...snapshot.grid, width: 0 },
      { ...snapshot.grid, height: 40_001 },
      { ...snapshot.grid, cellSize: Number.POSITIVE_INFINITY },
    ]) {
      expect(() =>
        planVisualExport({ ...snapshot, grid }, svgRequest()),
      ).toThrowError(
        expect.objectContaining({ code: "visual-export-grid-invalid" }),
      );
    }
  });
});

describe("确定性场景与 SVG", () => {
  it("裁切连接但保持原始虚线相位，且不在裁切边界伪造箭头", () => {
    const store = createStore("square", 20, 20, 10);
    const connectionId = store.createConnection(
      { kind: "map-point", point: { x: 10, y: 50 } },
      { kind: "map-point", point: { x: 190, y: 50 } },
      { kind: "arrow", arrowMode: "both", label: "线" },
    );
    const connection = store.state.connections.get(connectionId);
    if (connection === undefined) throw new Error("test-connection-missing");
    store.updateConnection(connectionId, {
      ...connection,
      style: { ...connection.style, lineStyle: "dashed" },
    });
    const plan = planVisualExport(
      snapshotOf(store.state),
      svgRequest({
        kind: "custom",
        bounds: { minX: 50, minY: 20, maxX: 150, maxY: 80 },
      }),
    );
    const primitives = [...iterateVisualPrimitives(plan)].filter(
      (primitive) => primitive.layerId === "tessera.basic.connection",
    );
    expect(primitives.map((primitive) => primitive.kind)).toEqual([
      "stroke",
      "text",
    ]);
    const stroke = primitives[0];
    expect(stroke?.kind).toBe("stroke");
    if (stroke?.kind !== "stroke") return;
    expect(stroke.start.x).toBe(50);
    expect(stroke.end.x).toBe(150);
    expect(stroke.originalStart.x).toBe(10);
    const svg = serializeVisualExportSvg(plan);
    expect(svg).toContain('stroke-dashoffset="-40"');
  });

  it("共享虚线 helper 的局部首段延续原线相位", () => {
    const segments = dashedSegments(
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 10, y: 0 },
      { x: 40, y: 0 },
      defaultDashPattern(2),
    );
    expect(segments[0]).toEqual({
      start: { x: 14, y: 0 },
      end: { x: 22, y: 0 },
    });
  });

  it("隐藏层和 grid 选项不会进入 SVG，CellOverride.label 会进入", () => {
    const store = createStore();
    store.paintCell(1, 1, "#FF0000FF");
    const id = cellId("square", 1, 1);
    const cell = store.state.cells.get(id);
    if (cell === undefined) throw new Error("test-cell-missing");
    store.state.cells.set(id, { ...cell, label: "城" });
    const plan = planVisualExport(snapshotOf(store.state), svgRequest());
    const svg = serializeVisualExportSvg(plan);
    expect(svg).toContain("城");
    expect(svg).not.toContain('layerId="tessera.system.grid"');
    store.setLayerState("tessera.basic.cell-style", { visible: false });
    const hidden = serializeVisualExportSvg(
      planVisualExport(snapshotOf(store.state), svgRequest()),
    );
    expect(hidden).not.toContain("城");
  });

  it("中文、emoji、组合字符和恶意 XML 文本被安全、确定性输出", () => {
    const store = createStore();
    store.placeText(
      { x: 60, y: 60 },
      '<script>alert("x")</script>&中文😀e\u0301',
      { fontSize: 18, rotation: 15 },
    );
    const plan = planVisualExport(snapshotOf(store.state), {
      ...svgRequest(),
      background: { kind: "color", color: "#11223380" },
    });
    const first = serializeVisualExportSvg(plan);
    const second = serializeVisualExportSvg(plan);
    expect(first).toBe(second);
    expect(first).not.toContain("<script>");
    expect(first).toContain("&lt;script&gt;");
    expect(first).toContain("中文😀é");
    const parsed = new DOMParser().parseFromString(first, "image/svg+xml");
    expect(parsed.querySelector("parsererror")).toBeNull();
    expect(parsed.querySelector("script")).toBeNull();
    expect(first).not.toMatch(/\b(?:href|src)=/u);
  });

  it("非法 XML 孤立代理字符被稳定拒绝", () => {
    const store = createStore();
    store.placeText({ x: 60, y: 60 }, "\uD800");
    const plan = planVisualExport(snapshotOf(store.state), svgRequest());
    expect(() => serializeVisualExportSvg(plan)).toThrowError(
      expect.objectContaining({ code: "visual-export-svg-text-invalid" }),
    );
  });

  it("文字事实使用地图单位且不受单元格边界裁切", () => {
    const store = createStore("hex-pointy", 8, 8, 20);
    store.placeText({ x: 30, y: 30 }, "很长很长的文字", {
      fontSize: 120,
      rotation: 30,
    });
    const plan = planVisualExport(snapshotOf(store.state), svgRequest());
    const text = [...iterateVisualPrimitives(plan)].find(
      (primitive) => primitive.kind === "text",
    );
    expect(text?.kind).toBe("text");
    if (text?.kind === "text") expect(text.fontSize).toBe(120);
    expect(serializeVisualExportSvg(plan)).toContain('font-size="120"');
  });
});
