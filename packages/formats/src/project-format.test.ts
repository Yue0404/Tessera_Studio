import { createProject, EditorStore } from "@tessera/core";
import { describe, expect, it } from "vitest";
import { parseProjectV1, stringifyProjectV1 } from "./index.js";

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
    const restored = parseProjectV1(stringifyProjectV1(store.state));
    expect(restored.name).toBe("往返");
    expect(restored.cells.get("cell:square:2:3")?.fillColor).toBe("#E3614DFF");
    expect(restored.edges.size).toBe(1);
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
    expect(() => parseProjectV1(JSON.stringify(parsed))).toThrow(
      "Project Format v1",
    );
  });
});
