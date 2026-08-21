import { Graphics } from "pixi.js";
import type { Container } from "pixi.js";
import {
  clipSegmentToRect,
  pointInRect,
  type MapRect,
  type ProjectState,
} from "@tessera/core";
import { colorValue, endpointPoint } from "./render-utils.js";

export class ConnectionRenderer {
  readonly #graphics = new Graphics();

  constructor(container: Container) {
    container.addChild(this.#graphics);
  }

  render(state: Readonly<ProjectState>, viewport: MapRect): void {
    this.#graphics.clear();
    const layer = state.layers.get("tessera.basic.connection");
    if (layer?.visible === false) return;
    for (const connection of state.connections.values()) {
      const start = endpointPoint(state, connection.start);
      const end = endpointPoint(state, connection.end);
      if (start === undefined || end === undefined) continue;
      const clipped = clipSegmentToRect(start, end, viewport);
      if (clipped === null) continue;
      const stroke = colorValue(connection.style.strokeColor);
      this.#graphics
        .moveTo(clipped[0].x, clipped[0].y)
        .lineTo(clipped[1].x, clipped[1].y)
        .stroke({
          color: stroke.color,
          alpha:
            stroke.alpha *
            connection.style.strokeOpacity *
            (layer?.opacity ?? 1),
          width: connection.style.strokeWidth,
        });
      if (
        connection.kind === "arrow" &&
        connection.arrowEnd &&
        pointInRect(end, viewport)
      ) {
        this.#drawArrow(clipped[0], clipped[1], stroke.color, stroke.alpha);
      }
    }
  }

  #drawArrow(
    start: { x: number; y: number },
    end: { x: number; y: number },
    color: number,
    alpha: number,
  ): void {
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const size = 10;
    this.#graphics
      .poly([
        end.x,
        end.y,
        end.x - size * Math.cos(angle - Math.PI / 6),
        end.y - size * Math.sin(angle - Math.PI / 6),
        end.x - size * Math.cos(angle + Math.PI / 6),
        end.y - size * Math.sin(angle + Math.PI / 6),
      ])
      .fill({ color, alpha });
  }
}
