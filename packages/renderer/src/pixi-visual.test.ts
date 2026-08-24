import { Text, Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import {
  createPixiImageMarker,
  createPixiText,
  pixiStrokePlan,
} from "./pixi-visual.js";

describe("Pixi 声明式视觉适配", () => {
  it("完整保留模块 dashPattern 数组与 lineCap", () => {
    const plan = pixiStrokePlan(
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      {
        color: "#FFFFFFFF",
        width: 2,
        opacity: 1,
        lineStyle: "dashed",
        dashPattern: [3, 5],
        lineCap: "butt",
      },
    );

    expect(plan.cap).toBe("butt");
    expect(plan.segments).toEqual([
      { start: { x: 0, y: 0 }, end: { x: 3, y: 0 } },
      { start: { x: 8, y: 0 }, end: { x: 11, y: 0 } },
      { start: { x: 16, y: 0 }, end: { x: 19, y: 0 } },
    ]);
  });

  it.each([
    [200, 100, 40, 20],
    [100, 200, 20, 40],
  ])(
    "图片 marker %sx%s 保持宽高比",
    (width, height, expectedWidth, expectedHeight) => {
      const marker = createPixiImageMarker(
        { x: 12, y: 24 },
        Texture.EMPTY,
        width,
        height,
        40,
        0,
        0.75,
      );
      expect(marker.width).toBe(expectedWidth);
      expect(marker.height).toBe(expectedHeight);
      expect(marker.tint).toBe(0xffffff);
      expect(marker.alpha).toBe(0.75);
    },
  );

  it("自定义字体 family 直接进入 Pixi Text 且不改文字模型", () => {
    const rendered = createPixiText(
      { x: 0, y: 0 },
      "资源字体",
      {
        fontFamily: "TesseraModule_0102",
        fontSize: 16,
        fontWeight: "normal",
        align: "center",
        rotation: 0,
        color: "#FFFFFFFF",
        opacity: 1,
        backgroundVisible: false,
      },
      null,
    );
    const label = rendered.children.find((child) => child instanceof Text);
    expect(label).toBeInstanceOf(Text);
    expect((label as Text).text).toBe("资源字体");
    expect((label as Text).style.fontFamily).toBe("TesseraModule_0102");
  });
});
