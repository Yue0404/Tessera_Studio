import { Graphics } from "pixi.js";
import type { Container } from "pixi.js";
import {
  edgeSegment,
  type ProjectState,
  type VisibleCell,
} from "@tessera/core";
import { colorValue } from "./render-utils.js";

export class GridRenderer {
  readonly #graphics = new Graphics();

  constructor(container: Container) {
    container.addChild(this.#graphics);
  }

  render(state: Readonly<ProjectState>, visible: readonly VisibleCell[]): void {
    this.#graphics.clear();
    const cellLayer = state.layers.get("tessera.basic.cell-style");
    const gridLayer = state.layers.get("tessera.system.grid");
    const edgeLayer = state.layers.get("tessera.basic.edge-style");
    const gridColor = colorValue(state.style.gridColor);
    for (const cell of visible) {
      const override = state.cells.get(cell.cellId);
      const fill = colorValue(
        override?.fillColor ?? state.style.defaultCellColor,
      );
      const path = this.#graphics.poly(
        cell.polygon.flatMap((point) => [point.x, point.y]),
      );
      if (cellLayer?.visible !== false) {
        path.fill({
          color: fill.color,
          alpha:
            fill.alpha *
            (override?.fillOpacity ?? 1) *
            (cellLayer?.opacity ?? 1),
        });
      }
      if (gridLayer?.visible !== false) {
        path.stroke({
          color: gridColor.color,
          alpha: state.style.gridOpacity * (gridLayer?.opacity ?? 1),
          width: state.style.gridWidth,
        });
      }
    }
    if (edgeLayer?.visible === false) return;
    for (const edge of state.edges.values()) {
      const segment = edgeSegment(
        state.grid,
        edge.edgeId,
        edge.adjacentCellIds,
      );
      if (segment === undefined) continue;
      const stroke = colorValue(edge.strokeColor);
      this.#graphics
        .moveTo(segment[0].x, segment[0].y)
        .lineTo(segment[1].x, segment[1].y)
        .stroke({
          color: stroke.color,
          alpha: stroke.alpha * edge.strokeOpacity * (edgeLayer?.opacity ?? 1),
          width: edge.strokeWidth,
        });
    }
  }
}
