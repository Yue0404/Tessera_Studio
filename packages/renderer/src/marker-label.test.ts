import { Container, Graphics, Text } from "pixi.js";
import {
  createProject,
  EditorStore,
  markerLabelFontSize,
  markerLabelPoint,
  type FixedLayerState,
} from "@tessera/core";
import { describe, expect, it } from "vitest";
import { OverlayRenderer } from "./overlay-renderer.js";
import {
  GenericModuleRenderer,
  hitTestGenericModule,
  type GenericModuleVisualResolver,
} from "./generic-module-renderer.js";
import { hitTestProjectObject } from "./project-hit-test.js";
import { planVisualExport } from "./visual-export/plan.js";
import {
  iterateVisualPrimitives,
  visibleContentBounds,
} from "./visual-export/scene.js";
import { captureVisualExportSnapshot } from "./visual-export/snapshot.js";

function store(): EditorStore {
  return new EditorStore(
    createProject({
      name: "附文渲染",
      grid: { type: "square", width: 8, height: 8, cellSize: 32 },
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

describe("标记附文渲染与导出", () => {
  it("图形和附文位于同一 Overlay 容器，附文区域也可命中", () => {
    const editor = store();
    const markerId = editor.placeMarker(
      { x: 64, y: 64 },
      "#D9B866FF",
      "circle",
      "目标",
    );
    const parent = new Container();
    new OverlayRenderer(parent).render(
      editor.state,
      { minX: 0, minY: 0, maxX: 128, maxY: 128 },
      1,
    );
    const layer = parent.children[0];
    const item = layer instanceof Container ? layer.children[0] : undefined;
    expect(item).toBeInstanceOf(Container);
    expect(
      (item as Container).children.some((child) => child instanceof Graphics),
    ).toBe(true);
    const textContainer = (item as Container).children.find(
      (child) => child instanceof Container && !(child instanceof Graphics),
    ) as Container | undefined;
    expect(textContainer?.children.some((child) => child instanceof Text)).toBe(
      true,
    );

    const marker = editor.state.overlays.get(markerId);
    if (marker === undefined || marker.overlayType !== "marker")
      throw new Error("marker-missing");
    const fontSize = markerLabelFontSize(marker.style.size);
    const labelPoint = markerLabelPoint(
      { x: 64, y: 64 },
      marker.style.size,
      fontSize,
    );
    expect(
      hitTestProjectObject(editor.state, labelPoint, undefined, 1),
    ).toEqual({
      kind: "overlay",
      id: markerId,
    });
  });

  it("视觉导出生成同 stableId 的 marker+label，内容范围取二者并集", () => {
    const editor = store();
    const markerId = editor.placeMarker(
      { x: 64, y: 64 },
      "#D9B866FF",
      "pin",
      "很长的标记附文",
    );
    const snapshot = captureVisualExportSnapshot(editor.state);
    const plan = planVisualExport(snapshot, {
      format: "svg",
      range: { kind: "full-map" },
      background: { kind: "transparent" },
      showGrid: false,
    });
    const primitives = [...iterateVisualPrimitives(plan)].filter(
      (primitive) =>
        primitive.stableId === markerId ||
        primitive.stableId === `${markerId}:label`,
    );
    expect(primitives.map((primitive) => primitive.kind)).toEqual([
      "marker",
      "text",
    ]);
    const bounds = visibleContentBounds(snapshot);
    expect(bounds?.maxY).toBeGreaterThan(64 + 32 * 0.45 * 0.5);
    expect(bounds?.maxX).toBeGreaterThan(64 + 32 * 0.45 * 0.5);
  });

  it("通用模块 marker 的附文参与同容器绘制和命中", () => {
    const editor = store();
    const layerId = "example.module.marker";
    (editor.state.layers as Map<string, FixedLayerState>).set(layerId, {
      layerId,
      moduleVersion: "1.0.0",
      zIndex: 3500,
      visible: true,
      locked: false,
      opacity: 1,
      runtimeStatus: "available",
      allowedKinds: ["overlay"],
    });
    const instanceId = crypto.randomUUID();
    editor.addModuleInstance({
      kind: "overlay",
      objectKind: "free-overlay",
      overlayType: "marker",
      instanceId,
      elementId: "example.module:marker",
      layerId,
      point: { x: 64, y: 64 },
      orderInLayer: 0,
      styleOverrides: {},
      attributes: { label: "模块附文" },
      extensions: {},
      runtimeStatus: "available",
    });
    const resolver: GenericModuleVisualResolver = {
      resolve: () => ({
        kind: "marker",
        shape: "diamond",
        color: "#FFFFFFFF",
        opacity: 1,
        displaySize: 20,
        rotation: 0,
        label: "模块附文",
      }),
    };
    const parent = new Container();
    new GenericModuleRenderer(parent, resolver).render(
      editor.state,
      { minX: 0, minY: 0, maxX: 128, maxY: 128 },
      [],
      1,
    );
    const layer = parent.children[0];
    const item = layer instanceof Container ? layer.children[0] : undefined;
    expect(item).toBeInstanceOf(Container);
    expect((item as Container).children).toHaveLength(2);
    const fontSize = markerLabelFontSize(20);
    const labelPoint = markerLabelPoint({ x: 64, y: 64 }, 20, fontSize);
    expect(
      hitTestGenericModule(editor.state, resolver, labelPoint, undefined, 1),
    ).toBe(instanceId);
  });
});
