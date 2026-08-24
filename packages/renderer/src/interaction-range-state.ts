import type { MapPoint, MapRect } from "@tessera/core";

function copyRect(rect: Readonly<MapRect>): MapRect {
  return { ...rect };
}

function normalizedRect(
  start: Readonly<MapPoint>,
  end: Readonly<MapPoint>,
): MapRect | null {
  if (
    !Number.isFinite(start.x) ||
    !Number.isFinite(start.y) ||
    !Number.isFinite(end.x) ||
    !Number.isFinite(end.y)
  ) {
    return null;
  }
  const rect = {
    minX: Math.min(start.x, end.x),
    minY: Math.min(start.y, end.y),
    maxX: Math.max(start.x, end.x),
    maxY: Math.max(start.y, end.y),
  };
  return rect.minX < rect.maxX && rect.minY < rect.maxY ? rect : null;
}

/** 保存交互产生的范围快照，不暴露摄像机或拖拽中的可变状态。 */
export class InteractionRangeState {
  #viewport: MapRect = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  #selection: MapRect | null = null;

  updateViewport(
    camera: Readonly<MapPoint>,
    width: number,
    height: number,
    zoom = 1,
  ): void {
    const safeWidth = Math.max(1, width);
    const safeHeight = Math.max(1, height);
    if (!Number.isFinite(zoom) || zoom <= 0) {
      throw new RangeError("viewport-zoom-invalid");
    }
    this.#viewport = {
      minX: -camera.x / zoom,
      minY: -camera.y / zoom,
      maxX: (safeWidth - camera.x) / zoom,
      maxY: (safeHeight - camera.y) / zoom,
    };
  }

  commitSelection(
    start: Readonly<MapPoint>,
    end: Readonly<MapPoint>,
  ): MapRect | null {
    const selection = normalizedRect(start, end);
    if (selection !== null) this.#selection = selection;
    return selection === null ? null : copyRect(selection);
  }

  getViewportBounds(): MapRect {
    return copyRect(this.#viewport);
  }

  getSelectionBounds(): MapRect | null {
    return this.#selection === null ? null : copyRect(this.#selection);
  }
}
