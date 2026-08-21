import { assertFiniteMapPoint } from "./coordinates.js";
import type { OverlayData, OverlayManagerContract } from "./types.js";

function validateOverlay(overlay: OverlayData): void {
  if (overlay.kind === "free-overlay") assertFiniteMapPoint(overlay.point);
  if (!Number.isInteger(overlay.orderInLayer)) {
    throw new RangeError("overlay-order-not-integer");
  }
  if (overlay.overlayType === "text" && overlay.text.length > 2048) {
    throw new RangeError("overlay-text-too-long");
  }
}

/** 文字和标记的唯一所有者；锚定与自由位置使用互斥联合类型。 */
export class OverlayManager implements OverlayManagerContract {
  readonly #overlaysById = new Map<string, OverlayData>();

  constructor(overlays: Iterable<OverlayData> = []) {
    for (const overlay of overlays) this.add(overlay);
  }

  get overlaysById(): ReadonlyMap<string, OverlayData> {
    return this.#overlaysById;
  }

  get size(): number {
    return this.#overlaysById.size;
  }

  get(overlayId: string): OverlayData | undefined {
    return this.#overlaysById.get(overlayId);
  }

  values(): IterableIterator<OverlayData> {
    return this.#overlaysById.values();
  }

  add(overlay: OverlayData): OverlayData {
    validateOverlay(overlay);
    if (this.#overlaysById.has(overlay.overlayId)) {
      throw new Error(`duplicate-overlay:${overlay.overlayId}`);
    }
    this.#overlaysById.set(overlay.overlayId, overlay);
    return overlay;
  }

  replace(overlay: OverlayData): OverlayData {
    validateOverlay(overlay);
    if (!this.#overlaysById.has(overlay.overlayId)) {
      throw new Error(`overlay-not-found:${overlay.overlayId}`);
    }
    this.#overlaysById.set(overlay.overlayId, overlay);
    return overlay;
  }

  delete(overlayId: string): boolean {
    return this.#overlaysById.delete(overlayId);
  }
}
