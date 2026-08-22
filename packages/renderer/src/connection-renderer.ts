import { Container, Graphics } from "pixi.js";
import {
  clipSegmentToRect,
  pointInRect,
  type MapRect,
  type ProjectState,
} from "@tessera/core";
import {
  createPixiText,
  drawPixiArrow,
  drawPixiStroke,
} from "./pixi-visual.js";
import { endpointPoint } from "./render-utils.js";
import { configureRenderLayer } from "./render-layer-order.js";
import { arrowSize, connectionLabelStyle } from "./visual-style.js";

export class ConnectionRenderer {
  readonly #container = new Container();

  constructor(container: Container) {
    container.addChild(this.#container);
  }

  render(state: Readonly<ProjectState>, viewport: MapRect): void {
    configureRenderLayer(this.#container, state, "tessera.basic.connection");
    for (const child of this.#container.removeChildren()) child.destroy();
    const layer = state.layers.get("tessera.basic.connection");
    if (layer?.visible === false) return;
    const connections = [...state.connections.query(viewport)].sort(
      (left, right) =>
        left.connectionId < right.connectionId
          ? -1
          : left.connectionId > right.connectionId
            ? 1
            : 0,
    );
    for (const connection of connections) {
      const start = endpointPoint(state, connection.start);
      const end = endpointPoint(state, connection.end);
      if (start === undefined || end === undefined) continue;
      const clipped = clipSegmentToRect(start, end, viewport);
      if (clipped === null) continue;
      const item = new Container();
      const graphics = new Graphics();
      const opacity = connection.style.strokeOpacity * (layer?.opacity ?? 1);
      drawPixiStroke(graphics, start, end, clipped[0], clipped[1], {
        color: connection.style.strokeColor,
        width: connection.style.strokeWidth,
        opacity,
        lineStyle: connection.style.lineStyle,
      });
      if (connection.kind === "arrow") {
        const size = arrowSize(
          connection.style.strokeWidth,
          state.grid.cellSize,
        );
        if (connection.arrowStart && pointInRect(start, viewport)) {
          drawPixiArrow(
            graphics,
            end,
            start,
            size,
            connection.style.strokeColor,
            opacity,
          );
        }
        if (connection.arrowEnd && pointInRect(end, viewport)) {
          drawPixiArrow(
            graphics,
            start,
            end,
            size,
            connection.style.strokeColor,
            opacity,
          );
        }
      }
      item.addChild(graphics);
      if (connection.label !== null) {
        item.addChild(
          createPixiText(
            { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
            connection.label,
            connectionLabelStyle(
              state.grid.cellSize,
              connection.style.strokeColor,
              opacity,
            ),
            null,
          ),
        );
      }
      this.#container.addChild(item);
    }
  }
}
