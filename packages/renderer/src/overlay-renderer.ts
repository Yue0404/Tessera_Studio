import { Container } from "pixi.js";
import { type MapRect, type ProjectState } from "@tessera/core";
import { createPixiMarker, createPixiText } from "./pixi-visual.js";
import { overlayAnchorPoint } from "./render-utils.js";
import { configureRenderLayer } from "./render-layer-order.js";
import {
  markerMapSize,
  overlayBufferedViewport,
  textMapSize,
} from "./overlay-visibility.js";
import { textBackgroundColor } from "./visual-style.js";

export class OverlayRenderer {
  readonly #parent: Container;
  readonly #layerContainers = new Map<string, Container>();

  constructor(container: Container) {
    this.#parent = container;
  }

  render(state: Readonly<ProjectState>, viewport: MapRect, zoom: number): void {
    for (const [layerId, container] of this.#layerContainers) {
      configureRenderLayer(container, state, layerId);
      for (const child of container.removeChildren()) child.destroy();
    }
    const bufferedViewport = overlayBufferedViewport(viewport, zoom);
    const sorted = [...state.overlays.query(bufferedViewport)].sort(
      (left, right) =>
        (state.layers.get(left.layerId)?.zIndex ?? 0) -
          (state.layers.get(right.layerId)?.zIndex ?? 0) ||
        (left.layerId < right.layerId
          ? -1
          : left.layerId > right.layerId
            ? 1
            : 0) ||
        left.orderInLayer - right.orderInLayer ||
        (left.overlayId < right.overlayId
          ? -1
          : left.overlayId > right.overlayId
            ? 1
            : 0),
    );
    for (const overlay of sorted) {
      const layer = state.layers.get(overlay.layerId);
      if (layer?.visible === false) continue;
      const point = overlayAnchorPoint(state, overlay);
      if (
        point === undefined ||
        point.x < bufferedViewport.minX ||
        point.x > bufferedViewport.maxX ||
        point.y < bufferedViewport.minY ||
        point.y > bufferedViewport.maxY
      ) {
        continue;
      }
      const opacity = overlay.style.opacity * (layer?.opacity ?? 1);
      const container = this.#containerFor(state, overlay.layerId);
      if (overlay.overlayType === "marker") {
        container.addChild(
          createPixiMarker(
            point,
            overlay.style.markerShape,
            markerMapSize(overlay.style.size, zoom),
            overlay.style.rotation,
            overlay.style.color,
            opacity,
          ),
        );
      } else {
        container.addChild(
          createPixiText(
            point,
            overlay.text,
            {
              fontSize: textMapSize(overlay.style.fontSize, zoom),
              rotation: overlay.style.rotation,
              opacity,
              color: overlay.style.color,
              fontWeight: overlay.style.fontWeight,
              align: overlay.style.align,
              backgroundVisible: overlay.style.backgroundVisible,
            },
            overlay.style.backgroundVisible
              ? textBackgroundColor(state.style.canvasBackground)
              : null,
          ),
        );
      }
    }
  }

  #containerFor(state: Readonly<ProjectState>, layerId: string): Container {
    let container = this.#layerContainers.get(layerId);
    if (container === undefined) {
      container = new Container();
      this.#layerContainers.set(layerId, container);
      this.#parent.addChild(container);
    }
    configureRenderLayer(container, state, layerId);
    return container;
  }
}
