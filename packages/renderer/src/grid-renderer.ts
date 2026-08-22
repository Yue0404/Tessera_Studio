import { Container, Graphics } from "pixi.js";
import {
  edgeSegment,
  type ProjectState,
  type VisibleCell,
} from "@tessera/core";
import { createPixiText, drawPixiStroke } from "./pixi-visual.js";
import { colorValue } from "./render-utils.js";
import { configureRenderLayer } from "./render-layer-order.js";
import { cellLabelStyle as sharedCellLabelStyle } from "./visual-style.js";

export class GridRenderer {
  readonly #cellGraphics = new Graphics();
  readonly #cellLabels = new Container();
  readonly #gridGraphics = new Graphics();
  readonly #edgeGraphics = new Graphics();

  constructor(container: Container) {
    container.addChild(
      this.#cellGraphics,
      this.#cellLabels,
      this.#gridGraphics,
      this.#edgeGraphics,
    );
  }

  render(state: Readonly<ProjectState>, visible: readonly VisibleCell[]): void {
    configureRenderLayer(this.#cellGraphics, state, "tessera.basic.cell-style");
    configureRenderLayer(this.#cellLabels, state, "tessera.basic.cell-style");
    configureRenderLayer(this.#gridGraphics, state, "tessera.system.grid");
    configureRenderLayer(this.#edgeGraphics, state, "tessera.basic.edge-style");
    this.#cellGraphics.clear();
    this.#gridGraphics.clear();
    this.#edgeGraphics.clear();
    for (const child of this.#cellLabels.removeChildren()) child.destroy();
    const cellLayer = state.layers.get("tessera.basic.cell-style");
    const gridLayer = state.layers.get("tessera.system.grid");
    const edgeLayer = state.layers.get("tessera.basic.edge-style");
    const gridColor = colorValue(state.style.gridColor);
    for (const cell of visible) {
      const override = state.cells.get(cell.cellId);
      const fill = colorValue(
        override?.fillColor ?? state.style.defaultCellColor,
      );
      if (cellLayer?.visible !== false) {
        this.#cellGraphics
          .poly(cell.polygon.flatMap((point) => [point.x, point.y]))
          .fill({
            color: fill.color,
            alpha:
              fill.alpha *
              (override?.fillOpacity ?? 1) *
              (cellLayer?.opacity ?? 1),
          });
        if (override?.label !== undefined) {
          const style = sharedCellLabelStyle(state.grid.cellSize);
          this.#cellLabels.addChild(
            createPixiText(
              cell.center,
              override.label,
              {
                ...style,
                opacity: style.opacity * (cellLayer?.opacity ?? 1),
              },
              null,
            ),
          );
        }
      }
      if (gridLayer?.visible !== false) {
        this.#gridGraphics
          .poly(cell.polygon.flatMap((point) => [point.x, point.y]))
          .stroke({
            color: gridColor.color,
            alpha: state.style.gridOpacity * (gridLayer?.opacity ?? 1),
            width: state.style.gridWidth,
          });
      }
    }
    if (edgeLayer?.visible === false) return;
    for (const edge of [...state.edges.values()].sort((left, right) =>
      left.edgeId < right.edgeId ? -1 : left.edgeId > right.edgeId ? 1 : 0,
    )) {
      if (edge.persistence !== "explicit-style") continue;
      const segment = edgeSegment(
        state.grid,
        edge.edgeId,
        edge.adjacentCellIds,
      );
      if (segment === undefined) continue;
      drawPixiStroke(
        this.#edgeGraphics,
        segment[0],
        segment[1],
        segment[0],
        segment[1],
        {
          color: edge.strokeColor,
          width: edge.strokeWidth,
          opacity: edge.strokeOpacity * (edgeLayer?.opacity ?? 1),
          lineStyle: edge.lineStyle,
        },
      );
    }
  }
}
