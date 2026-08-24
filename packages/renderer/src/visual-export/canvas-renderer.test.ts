import { describe, expect, it, vi } from "vitest";
import {
  drawVisualPrimitiveToCanvas,
  drawVisualTextToCanvasBatched,
} from "./canvas-renderer.js";
import type { VisualPrimitive } from "./types.js";

function recordingContext() {
  const calls: unknown[][] = [];
  const call =
    (name: string) =>
    (...values: unknown[]) =>
      void calls.push([name, ...values]);
  const context = {
    save: call("save"),
    restore: call("restore"),
    beginPath: call("beginPath"),
    moveTo: call("moveTo"),
    lineTo: call("lineTo"),
    closePath: call("closePath"),
    fill: call("fill"),
    stroke: call("stroke"),
    setLineDash: vi.fn(call("setLineDash")),
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
  return { context, calls };
}

const base = {
  layerId: "test.layer",
  zIndex: 1,
  orderInLayer: 0,
  stableId: "primitive",
  partRank: 0,
};

describe("Canvas2D 视觉图元绘制", () => {
  it("裁切虚线沿用原始起点相位", () => {
    const { context } = recordingContext();
    drawVisualPrimitiveToCanvas(context, {
      ...base,
      kind: "stroke",
      originalStart: { x: 0, y: 0 },
      originalEnd: { x: 100, y: 0 },
      start: { x: 10, y: 0 },
      end: { x: 40, y: 0 },
      strokeColor: "#FFFFFFFF",
      strokeWidth: 2,
      opacity: 1,
      lineStyle: "dashed",
      dashPattern: [3, 5],
      lineCap: "square",
    });
    expect(context.setLineDash).toHaveBeenCalledWith([3, 5]);
    expect(context.lineCap).toBe("square");
    expect(context.lineDashOffset).toBe(-10);
  });

  it.each(["circle", "diamond", "pin"] as const)("绘制 %s marker", (shape) => {
    const { context, calls } = recordingContext();
    drawVisualPrimitiveToCanvas(context, {
      ...base,
      kind: "marker",
      point: { x: 10, y: 20 },
      shape,
      size: 12,
      rotation: 30,
      color: "#00FF0080",
      opacity: 0.5,
    });
    expect(calls).toContainEqual(["translate", 10, 20]);
    expect(
      calls.some(([name]) => name === (shape === "circle" ? "arc" : "moveTo")),
    ).toBe(true);
    expect(context.globalAlpha).toBeCloseTo(128 / 255 / 2, 5);
  });

  it("旋转多行文字绘制背景并逐行 fillText", () => {
    const { context, calls } = recordingContext();
    const primitive: VisualPrimitive = {
      ...base,
      kind: "text",
      point: { x: 30, y: 40 },
      text: "abcdef",
      fontSize: 20,
      fontWeight: "bold",
      align: "center",
      rotation: 45,
      color: "#FFFFFFFF",
      opacity: 0.75,
      backgroundColor: "#112233CC",
      wrapWidth: 24,
    };
    drawVisualPrimitiveToCanvas(context, primitive);
    expect(calls.some(([name]) => name === "roundRect")).toBe(true);
    expect(calls.filter(([name]) => name === "fillText")).toHaveLength(3);
    expect(calls).toContainEqual(["rotate", Math.PI / 4]);
  });

  it("长文字按行批次让出控制权", async () => {
    const { context } = recordingContext();
    const checkpoint = vi.fn(async () => undefined);
    await drawVisualTextToCanvasBatched(
      context,
      {
        ...base,
        kind: "text",
        point: { x: 0, y: 0 },
        text: "1\n2\n3\n4\n5",
        fontSize: 10,
        fontWeight: "normal",
        align: "center",
        rotation: 0,
        color: "#FFFFFFFF",
        opacity: 1,
        backgroundColor: null,
      },
      2,
      checkpoint,
    );
    expect(checkpoint).toHaveBeenCalledTimes(2);
    expect(checkpoint).toHaveBeenNthCalledWith(1, 2, 5);
    expect(checkpoint).toHaveBeenNthCalledWith(2, 4, 5);
  });

  it("共享资源占位绘制 pattern 描边、marker 叉号并保留 text", () => {
    const { context, calls } = recordingContext();
    drawVisualPrimitiveToCanvas(context, {
      ...base,
      kind: "polygon",
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      fillColor: "#FF00FFFF",
      opacity: 1,
      resourcePlaceholder: "pattern",
    });
    drawVisualPrimitiveToCanvas(context, {
      ...base,
      kind: "marker",
      point: { x: 10, y: 10 },
      shape: "diamond",
      size: 12,
      rotation: 0,
      color: "#FF00FFFF",
      opacity: 1,
      resourcePlaceholder: "marker",
    });
    drawVisualPrimitiveToCanvas(context, {
      ...base,
      kind: "text",
      point: { x: 20, y: 20 },
      text: "资源文字",
      fontSize: 12,
      fontWeight: "normal",
      align: "center",
      rotation: 0,
      color: "#202020FF",
      opacity: 1,
      backgroundColor: "#FF00FFFF",
      resourcePlaceholder: "text",
    });

    expect(calls.filter(([name]) => name === "stroke")).toHaveLength(2);
    expect(
      calls.some(([name, text]) => name === "fillText" && text === "资源文字"),
    ).toBe(true);
  });
});
