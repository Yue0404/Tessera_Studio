import { parseCellId } from "@tessera/core";

export function compareStableId(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compareCellId(left: string, right: string): number {
  const leftCell = parseCellId(left);
  const rightCell = parseCellId(right);
  return leftCell.row - rightCell.row || leftCell.column - rightCell.column;
}

export function compareLayerInstance(
  left: { layerId: string; instanceId: string },
  right: { layerId: string; instanceId: string },
): number {
  return (
    compareStableId(left.layerId, right.layerId) ||
    compareStableId(left.instanceId, right.instanceId)
  );
}

export function isSortedUnique<T>(
  values: readonly T[],
  compare: (left: T, right: T) => number,
): boolean {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (
      previous === undefined ||
      current === undefined ||
      compare(previous, current) >= 0
    ) {
      return false;
    }
  }
  return true;
}
