import { createProject, type FixedLayerState } from "@tessera/core";
import { describe, expect, it } from "vitest";
import { renderLayerRank } from "./render-layer-order.js";

describe("跨 renderer 图层顺序", () => {
  it("默认模型顺序为 placed-object < connection < annotation", () => {
    const state = createProject({
      name: "图层顺序",
      grid: { type: "square", width: 2, height: 2, cellSize: 20 },
      style: {
        canvasBackground: "#000000FF",
        defaultCellColor: "#000000FF",
        gridColor: "#FFFFFFFF",
        gridOpacity: 1,
        gridWidth: 1,
        defaultEdgeColor: "#FFFFFFFF",
      },
    });
    expect(renderLayerRank(state, "tessera.basic.placed-object")).toBeLessThan(
      renderLayerRank(state, "tessera.basic.connection"),
    );
    expect(renderLayerRank(state, "tessera.basic.connection")).toBeLessThan(
      renderLayerRank(state, "tessera.basic.annotation"),
    );
  });

  it("模型 zIndex 改变时所有 renderer 使用同一动态顺序", () => {
    const state = createProject({
      name: "动态图层顺序",
      grid: { type: "square", width: 2, height: 2, cellSize: 20 },
      style: {
        canvasBackground: "#000000FF",
        defaultCellColor: "#000000FF",
        gridColor: "#FFFFFFFF",
        gridOpacity: 1,
        gridWidth: 1,
        defaultEdgeColor: "#FFFFFFFF",
      },
    });
    const layers = state.layers as Map<string, FixedLayerState>;
    const placed = layers.get("tessera.basic.placed-object");
    const connection = layers.get("tessera.basic.connection");
    const annotation = layers.get("tessera.basic.annotation");
    if (
      placed === undefined ||
      connection === undefined ||
      annotation === undefined
    ) {
      throw new Error("test-layer-missing");
    }
    layers.set(placed.layerId, { ...placed, zIndex: 9000 });
    layers.set(connection.layerId, { ...connection, zIndex: 100 });
    layers.set(annotation.layerId, { ...annotation, zIndex: 5000 });

    expect(renderLayerRank(state, connection.layerId)).toBeLessThan(
      renderLayerRank(state, annotation.layerId),
    );
    expect(renderLayerRank(state, annotation.layerId)).toBeLessThan(
      renderLayerRank(state, placed.layerId),
    );
  });
});
