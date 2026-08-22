import type { Container } from "pixi.js";
import type { ProjectState } from "@tessera/core";

function compareCodePoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** 将模型的 (zIndex, layerId) 稳定顺序映射为 Pixi 可排序的连续层级。 */
export function renderLayerRank(
  state: Readonly<ProjectState>,
  layerId: string,
): number {
  const ordered = [...state.layers.values()].sort(
    (left, right) =>
      left.zIndex - right.zIndex ||
      compareCodePoint(left.layerId, right.layerId),
  );
  const rank = ordered.findIndex((layer) => layer.layerId === layerId);
  return rank < 0 ? ordered.length : rank;
}

export function configureRenderLayer(
  container: Container,
  state: Readonly<ProjectState>,
  layerId: string,
): void {
  container.label = `tessera-layer:${layerId}`;
  container.zIndex = renderLayerRank(state, layerId);
}

export function enableRenderLayerSorting(container: Container): void {
  container.sortableChildren = true;
}
