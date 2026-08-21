import { describe, expect, it } from "vitest";
import {
  cellCenter,
  createProject,
  edgeIdentity,
  edgeSegment,
  EditorStore,
  visibleCells,
} from "@tessera/core";
import { hitTestProjectObject } from "./project-hit-test.js";

function store() {
  return new EditorStore(
    createProject({
      name: "命中",
      grid: { type: "square", width: 20, height: 20, cellSize: 32 },
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

describe("固定图层直接命中", () => {
  it("分别命中已有 cell、edge、connection 与 overlay", () => {
    const cellStore = store();
    const cells = visibleCells(cellStore.state.grid, 640, 640);
    const cell = cells.find((item) => item.row === 2 && item.column === 2);
    if (cell === undefined) throw new Error("missing-cell");
    expect(hitTestProjectObject(cellStore.state, cell.center, cell)).toEqual({
      kind: "cell",
      id: cell.cellId,
    });

    const edgeStore = store();
    const identity = edgeIdentity(edgeStore.state.grid, cell, 1);
    edgeStore.paintEdge(identity.edgeId, identity.adjacentCellIds, "#FFFFFFFF");
    const segment = edgeSegment(
      edgeStore.state.grid,
      identity.edgeId,
      identity.adjacentCellIds,
    );
    if (segment === undefined) throw new Error("missing-segment");
    const midpoint = {
      x: (segment[0].x + segment[1].x) / 2,
      y: (segment[0].y + segment[1].y) / 2,
    };
    expect(hitTestProjectObject(edgeStore.state, midpoint, cell)).toEqual({
      kind: "edge",
      id: identity.edgeId,
    });

    const connectionStore = store();
    const connectionId = connectionStore.createConnection(
      { kind: "map-point", point: { x: 50.25, y: 100.5 } },
      { kind: "map-point", point: { x: 250.75, y: 100.5 } },
      "line",
    );
    expect(
      hitTestProjectObject(connectionStore.state, { x: 150.5, y: 100.5 }, cell),
    ).toEqual({ kind: "connection", id: connectionId });

    const overlayStore = store();
    const overlayId = overlayStore.placeMarker({
      kind: "cell",
      cellId: cell.cellId,
    });
    expect(
      hitTestProjectObject(
        overlayStore.state,
        cellCenter(overlayStore.state.grid, cell.row, cell.column),
        cell,
      ),
    ).toEqual({ kind: "overlay", id: overlayId });
  });
});
