import { describe, expect, it } from "vitest";
import { anchorInsideBufferedViewport } from "./overlay-visibility.js";

describe("Overlay 锚点剔除", () => {
  const viewport = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

  it("锚点进入 768 CSS px 扩展视口时渲染", () => {
    expect(anchorInsideBufferedViewport({ x: -700, y: 50 }, viewport)).toBe(
      true,
    );
  });

  it("超大文字本体进入真实视口但锚点仍在扩展视口外时不渲染", () => {
    const anchor = { x: -769, y: 50 };
    const textBounds = {
      minX: anchor.x,
      maxX: anchor.x + 1000,
      minY: 0,
      maxY: 100,
    };
    expect(textBounds.maxX).toBeGreaterThan(viewport.minX);
    expect(textBounds.minX).toBeLessThan(viewport.maxX);
    expect(anchorInsideBufferedViewport(anchor, viewport)).toBe(false);
  });
});
