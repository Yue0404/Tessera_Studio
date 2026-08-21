import { createProject, edgeIdentity, EditorStore } from "@tessera/core";
import { describe, expect, it } from "vitest";
import {
  parseProjectV1,
  ProjectFormatError,
  stringifyProjectV1,
} from "./index.js";

describe("Project Format v1", () => {
  it("完整工程可往返并保留地格与共享边", () => {
    const store = new EditorStore(
      createProject({
        name: "往返",
        grid: { type: "square", width: 10, height: 12, cellSize: 32 },
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
    store.paintCell(2, 3, "#E3614DFF");
    store.paintEdge(
      "edge:square:2:3|2:4",
      ["cell:square:2:3", "cell:square:2:4"],
      "#D9B866FF",
    );
    const serialized = JSON.parse(stringifyProjectV1(store.state)) as any;
    expect(
      serialized.managers.edgeManager.edges[0].layerInstances[0].attributes,
    ).toEqual({ persistence: "explicit-style" });
    const restored = parseProjectV1(JSON.stringify(serialized));
    expect(restored.name).toBe("往返");
    expect(restored.cells.get("cell:square:2:3")?.fillColor).toBe("#E3614DFF");
    expect(restored.edges.size).toBe(1);
    expect([...restored.edges.values()][0]?.persistence).toBe("explicit-style");
  });

  it("拒绝未知顶层字段", () => {
    const state = createProject({
      name: "拒绝",
      grid: { type: "hex-pointy", width: 2, height: 2, cellSize: 32 },
      style: {
        canvasBackground: "#09141DFF",
        defaultCellColor: "#14232DFF",
        gridColor: "#59656AFF",
        gridOpacity: 0.7,
        gridWidth: 1,
        defaultEdgeColor: "#59656AFF",
      },
    });
    const parsed = JSON.parse(stringifyProjectV1(state)) as Record<
      string,
      unknown
    >;
    parsed.unknown = true;
    try {
      parseProjectV1(JSON.stringify(parsed));
      throw new Error("expected-project-format-error");
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectFormatError);
      expect(error).toMatchObject({
        code: "project-schema-invalid",
        message: "project-schema-invalid",
        details: {},
      });
      expect((error as ProjectFormatError).issues.length).toBeGreaterThan(0);
    }
  });

  it("兼容 persistence 字段出现前的 v1 Edge，按显式样式保守载入", () => {
    const store = new EditorStore(
      createProject({
        name: "旧 v1",
        grid: { type: "square", width: 2, height: 2, cellSize: 32 },
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
    store.paintEdge(
      "edge:square:0:0|0:1",
      ["cell:square:0:0", "cell:square:0:1"],
      "#59656AFF",
    );
    const document = JSON.parse(stringifyProjectV1(store.state)) as any;
    document.managers.edgeManager.edges[0].layerInstances[0].attributes = {};
    expect(
      [...parseProjectV1(JSON.stringify(document)).edges.values()][0]
        ?.persistence,
    ).toBe("explicit-style");
  });

  it("完整往返三 Manager、端点 tagged union 与 64×64 owner 闭包", () => {
    const store = new EditorStore(
      createProject({
        name: "M1 往返",
        grid: { type: "square", width: 256, height: 256, cellSize: 32 },
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
    const edge = edgeIdentity(store.state.grid, { row: 70, column: 70 }, 1);
    const markerId = store.placeEdgeMarker({
      instanceId: crypto.randomUUID(),
      ...edge,
      strokeColor: "#59656AFF",
      strokeWidth: 2,
      strokeOpacity: 1,
      lineStyle: "solid",
    });
    store.placeMarker({ x: 12.5, y: 20.25 });
    store.placeText({ kind: "cell", cellId: "cell:square:70:70" }, "说明");
    store.createConnection(
      { kind: "cell-center", cellId: "cell:square:70:70" },
      { kind: "map-point", point: { x: 500.5, y: 300.25 } },
      "arrow",
    );

    const document = JSON.parse(stringifyProjectV1(store.state)) as any;
    expect(
      document.managers.edgeManager.edges[0].layerInstances[0].attributes,
    ).toEqual({ persistence: "reference-only" });
    expect(document.managers.connectionManager.connections[0]).toMatchObject({
      kind: "arrow",
      start: { kind: "cell-center" },
      end: { kind: "map-point" },
    });
    expect(
      document.chunks.some((chunk: any) =>
        chunk.ownedOverlayIds.includes(markerId),
      ),
    ).toBe(true);

    const restored = parseProjectV1(JSON.stringify(document));
    expect(restored.edges.size).toBe(1);
    expect([...restored.edges.values()][0]?.persistence).toBe("reference-only");
    expect(restored.connections.size).toBe(1);
    expect(restored.overlays.size).toBe(3);
    expect(restored.connections.values().next().value?.end).toEqual({
      kind: "map-point",
      point: { x: 500.5, y: 300.25 },
    });
    expect(restored.layers.get("tessera.basic.connection")).toMatchObject({
      zIndex: 4300,
      visible: true,
    });
  });
});
