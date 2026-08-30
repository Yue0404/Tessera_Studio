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
import {
  arrowShaftSegment,
  arrowSize,
  connectionLabelPoint,
  connectionLabelStyle,
  textBackgroundColor,
} from "./visual-style.js";

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
      const size =
        connection.kind === "arrow"
          ? arrowSize(connection.style.strokeWidth, state.grid.cellSize)
          : 0;
      const shaft =
        connection.kind === "arrow"
          ? arrowShaftSegment(
              start,
              end,
              connection.arrowStart,
              connection.arrowEnd,
              size,
            )
          : ([start, end] as const);
      const clipped =
        shaft === null ? null : clipSegmentToRect(shaft[0], shaft[1], viewport);
      const arrowVisible =
        connection.kind === "arrow" &&
        ((connection.arrowStart && pointInRect(start, viewport)) ||
          (connection.arrowEnd && pointInRect(end, viewport)));
      if (clipped === null && !arrowVisible) continue;
      const item = new Container();
      const graphics = new Graphics();
      const opacity = connection.style.strokeOpacity * (layer?.opacity ?? 1);
      if (shaft !== null && clipped !== null)
        drawPixiStroke(graphics, shaft[0], shaft[1], clipped[0], clipped[1], {
          color: connection.style.strokeColor,
          width: connection.style.strokeWidth,
          opacity,
          lineStyle: connection.style.lineStyle,
          ...(connection.kind === "arrow" ? { lineCap: "butt" as const } : {}),
        });
      if (connection.kind === "arrow") {
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
            connectionLabelPoint(
              start,
              end,
              state.grid.cellSize,
              connection.style.strokeWidth,
            ),
            connection.label,
            connectionLabelStyle(
              state.grid.cellSize,
              connection.style.strokeColor,
              opacity,
            ),
            textBackgroundColor(state.style.canvasBackground),
          ),
        );
      }
      this.#container.addChild(item);
    }
  }
}
