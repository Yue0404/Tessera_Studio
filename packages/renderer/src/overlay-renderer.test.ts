import { Container, Graphics, Text } from "pixi.js";
import { createProject, EditorStore } from "@tessera/core";
import { describe, expect, it, vi } from "vitest";
import { OverlayRenderer } from "./overlay-renderer.js";
import {
  anchorInsideBufferedViewport,
  overlayBufferedViewport,
} from "./overlay-visibility.js";

describe("Overlay 锚点剔除", () => {
  const viewport = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

  it("锚点进入 768 CSS px 扩展视口时渲染", () => {
    expect(anchorInsideBufferedViewport({ x: -700, y: 50 }, viewport)).toBe(
      true,
    );
  });

  it("缓冲按 CSS px 除以 zoom 换算成地图单位", () => {
    expect(overlayBufferedViewport(viewport, 2).minX).toBe(-384);
    expect(overlayBufferedViewport(viewport, 0.5).minX).toBe(-1536);
    expect(anchorInsideBufferedViewport({ x: -700, y: 50 }, viewport, 2)).toBe(
      false,
    );
    expect(
      anchorInsideBufferedViewport({ x: -1500, y: 50 }, viewport, 0.5),
    ).toBe(true);
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

  it("OverlayRenderer 用扩展矩形查询真实 manager，并随 zoom 改变候选", () => {
    const store = new EditorStore(
      createProject({
        name: "缓冲查询",
        grid: { type: "square", width: 100, height: 100, cellSize: 32 },
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
    store.placeMarker({ x: -500, y: 50 });
    const query = vi.spyOn(store.state.overlays, "query");
    const parent = new Container();
    const renderer = new OverlayRenderer(parent);

    renderer.render(store.state, viewport, 2);
    expect(query).toHaveBeenLastCalledWith({
      minX: -384,
      minY: -384,
      maxX: 484,
      maxY: 484,
    });
    expect(parent.children).toHaveLength(0);

    renderer.render(store.state, viewport, 1);
    expect(query).toHaveBeenLastCalledWith({
      minX: -768,
      minY: -768,
      maxX: 868,
      maxY: 868,
    });
    expect(parent.children).toHaveLength(1);
  });

  it("基础 marker 与 text 绘制在不同 zoom 下保持 CSS 可读尺寸", () => {
    const store = new EditorStore(
      createProject({
        name: "CSS 尺寸",
        grid: { type: "square", width: 100, height: 100, cellSize: 32 },
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
    const markerId = store.placeMarker({ x: 50, y: 50 }, "#FFFFFFFF", "circle");
    const textId = store.placeText({ x: 80, y: 50 }, "可读", { fontSize: 1 });
    const marker = store.state.overlays.get(markerId);
    if (marker === undefined || marker.overlayType !== "marker")
      throw new Error("marker-missing");
    store.state.overlays.replace({
      ...marker,
      style: { ...marker.style, size: 1 },
    });
    const parent = new Container();
    const renderer = new OverlayRenderer(parent);
    const rendered = () =>
      parent.children.flatMap((layer) =>
        layer instanceof Container ? layer.children : [],
      );

    renderer.render(store.state, viewport, 0.1);
    const smallMarker = rendered().find(
      (child): child is Graphics => child instanceof Graphics,
    );
    const smallTextContainer = rendered().find(
      (child): child is Container =>
        child instanceof Container && !(child instanceof Graphics),
    );
    const smallText = smallTextContainer?.children.find(
      (child): child is Text => child instanceof Text,
    );
    expect((smallMarker?.getLocalBounds().width ?? 0) * 0.1).toBeCloseTo(8);
    expect(Number(smallText?.style.fontSize) * 0.1).toBeCloseTo(8);

    const largeMarker = store.state.overlays.get(markerId);
    const largeText = store.state.overlays.get(textId);
    if (
      largeMarker === undefined ||
      largeMarker.overlayType !== "marker" ||
      largeText === undefined ||
      largeText.overlayType !== "text"
    )
      throw new Error("overlay-missing");
    store.state.overlays.replace({
      ...largeMarker,
      style: { ...largeMarker.style, size: 10_000 },
    });
    store.state.overlays.replace({
      ...largeText,
      style: { ...largeText.style, fontSize: 10_000 },
    });
    renderer.render(store.state, viewport, 10);
    const maxMarker = rendered().find(
      (child): child is Graphics => child instanceof Graphics,
    );
    const maxTextContainer = rendered().find(
      (child): child is Container =>
        child instanceof Container && !(child instanceof Graphics),
    );
    const maxText = maxTextContainer?.children.find(
      (child): child is Text => child instanceof Text,
    );
    expect((maxMarker?.getLocalBounds().width ?? 0) * 10).toBeCloseTo(256);
    expect(Number(maxText?.style.fontSize) * 10).toBeCloseTo(96);
  });
});
