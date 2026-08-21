import { Container, Graphics, Text } from "pixi.js";
import { type MapRect, type ProjectState } from "@tessera/core";
import { colorValue, overlayAnchorPoint } from "./render-utils.js";
import { anchorInsideBufferedViewport } from "./overlay-visibility.js";

export class OverlayRenderer {
  readonly #container = new Container();

  constructor(container: Container) {
    container.addChild(this.#container);
  }

  render(state: Readonly<ProjectState>, viewport: MapRect): void {
    for (const child of this.#container.removeChildren()) child.destroy();
    const sorted = [...state.overlays.values()].sort(
      (left, right) =>
        (state.layers.get(left.layerId)?.zIndex ?? 0) -
          (state.layers.get(right.layerId)?.zIndex ?? 0) ||
        left.orderInLayer - right.orderInLayer ||
        left.overlayId.localeCompare(right.overlayId),
    );
    for (const overlay of sorted) {
      const layer = state.layers.get(overlay.layerId);
      if (layer?.visible === false) continue;
      const point = overlayAnchorPoint(state, overlay);
      if (
        point === undefined ||
        !anchorInsideBufferedViewport(point, viewport)
      ) {
        continue;
      }
      const color = colorValue(overlay.style.color);
      if (overlay.overlayType === "marker") {
        const size = Math.min(256, Math.max(8, overlay.style.size));
        const marker = new Graphics().circle(0, 0, size / 2).fill({
          color: color.color,
          alpha: color.alpha * overlay.style.opacity * (layer?.opacity ?? 1),
        });
        marker.position.set(point.x, point.y);
        marker.rotation = overlay.style.rotation;
        this.#container.addChild(marker);
      } else {
        const label = new Text({
          text: overlay.text,
          style: {
            fill: color.color,
            fontSize: Math.min(96, Math.max(8, overlay.style.fontSize)),
            fontWeight: overlay.style.fontWeight,
            align: overlay.style.align,
          },
        });
        label.anchor.set(0.5);
        label.position.set(point.x, point.y);
        label.rotation = overlay.style.rotation;
        label.alpha = overlay.style.opacity * (layer?.opacity ?? 1);
        this.#container.addChild(label);
      }
    }
  }
}
