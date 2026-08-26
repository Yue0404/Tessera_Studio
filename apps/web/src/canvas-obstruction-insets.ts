import type { ScreenInsets, ScreenRect } from "@tessera/renderer";

export interface CanvasObstruction {
  readonly side: "left" | "right";
  readonly rect: ScreenRect;
}

function verticalOverlap(a: Readonly<ScreenRect>, b: Readonly<ScreenRect>) {
  return a.y < b.y + b.height && b.y < a.y + a.height;
}

/** 以实际可见 DOM 矩形计算左右占用，不复制任何面板 CSS 宽度。 */
export function canvasObstructionInsets(
  viewport: Readonly<ScreenRect>,
  obstructions: readonly CanvasObstruction[],
): ScreenInsets {
  let left = 0;
  let right = 0;
  const viewportRight = viewport.x + viewport.width;
  for (const obstruction of obstructions) {
    if (
      obstruction.rect.width <= 0 ||
      obstruction.rect.height <= 0 ||
      !verticalOverlap(viewport, obstruction.rect)
    ) {
      continue;
    }
    if (obstruction.side === "left") {
      left = Math.max(
        left,
        Math.min(viewportRight, obstruction.rect.x + obstruction.rect.width) -
          viewport.x,
      );
    } else {
      right = Math.max(
        right,
        viewportRight - Math.max(viewport.x, obstruction.rect.x),
      );
    }
  }
  return {
    top: 0,
    right: Math.max(0, Math.min(viewport.width, right)),
    bottom: 0,
    left: Math.max(0, Math.min(viewport.width, left)),
  };
}
