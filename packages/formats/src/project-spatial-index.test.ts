import { EditorStore, createProject } from "@tessera/core";
import { describe, expect, it } from "vitest";
import { restoreProjectV1, stringifyProjectV1 } from "./project-format.js";

describe("Project v1 空间索引恢复", () => {
  it("恢复后 Connection/Overlay 可直接做局部查询并继续同步增删改", () => {
    const store = new EditorStore(
      createProject({
        name: "索引恢复",
        grid: { type: "square", width: 100, height: 100, cellSize: 10 },
        style: {
          canvasBackground: "#111111FF",
          defaultCellColor: "#222222FF",
          gridColor: "#FFFFFFFF",
          gridOpacity: 1,
          gridWidth: 1,
          defaultEdgeColor: "#FFFFFFFF",
        },
      }),
    );
    const overlayId = store.placeMarker({ x: 20, y: 20 });
    const connectionId = store.createConnection(
      { kind: "map-point", point: { x: 10, y: 10 } },
      { kind: "map-point", point: { x: 40, y: 40 } },
      "line",
    );
    const restored = restoreProjectV1(stringifyProjectV1(store.state));
    const local = { minX: 0, minY: 0, maxX: 50, maxY: 50 };
    expect(restored.overlays.query(local)[0]?.overlayId).toBe(overlayId);
    expect(restored.connections.query(local)[0]?.connectionId).toBe(
      connectionId,
    );

    const overlay = restored.overlays.get(overlayId);
    if (overlay?.kind !== "free-overlay") {
      throw new Error("overlay-test-fixture-missing");
    }
    restored.overlays.replace({
      ...overlay,
      point: { x: 500, y: 500 },
    });
    expect(restored.overlays.query(local)).toEqual([]);
    expect(
      restored.overlays.query({
        minX: 490,
        minY: 490,
        maxX: 510,
        maxY: 510,
      })[0]?.overlayId,
    ).toBe(overlayId);
    restored.connections.delete(connectionId);
    expect(restored.connections.query(local)).toEqual([]);
  });
});
