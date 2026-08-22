import {
  distanceToSegment,
  edgeIdentity,
  edgeSegment,
  nearestEdge,
  type MapPoint,
  type ProjectState,
  type SelectedObject,
  type VisibleCell,
} from "@tessera/core";
import { endpointPoint, overlayAnchorPoint } from "./render-utils.js";

/** 按固定图层高度与层内顺序，返回画布单击的最上层对象。 */
export function hitTestProjectObject(
  state: Readonly<ProjectState>,
  point: MapPoint,
  cell: VisibleCell | undefined,
): SelectedObject | null {
  const queryRadius = Math.max(96, state.grid.cellSize * 2);
  const queryRect = {
    minX: point.x - queryRadius,
    minY: point.y - queryRadius,
    maxX: point.x + queryRadius,
    maxY: point.y + queryRadius,
  };
  const overlays = [...state.overlays.query(queryRect)].sort((left, right) => {
    const z =
      (state.layers.get(right.layerId)?.zIndex ?? 0) -
      (state.layers.get(left.layerId)?.zIndex ?? 0);
    return z || right.orderInLayer - left.orderInLayer;
  });
  for (const overlay of overlays) {
    if (state.layers.get(overlay.layerId)?.visible === false) continue;
    const anchor = overlayAnchorPoint(state, overlay);
    if (anchor === undefined) continue;
    const radius =
      overlay.overlayType === "marker"
        ? Math.max(8, overlay.style.size / 2)
        : Math.max(12, Math.min(96, overlay.style.fontSize));
    if (Math.hypot(point.x - anchor.x, point.y - anchor.y) <= radius) {
      return { kind: "overlay", id: overlay.overlayId };
    }
  }
  for (const connection of state.connections.query(queryRect)) {
    if (state.layers.get(connection.layerId)?.visible === false) continue;
    const start = endpointPoint(state, connection.start);
    const end = endpointPoint(state, connection.end);
    if (
      start !== undefined &&
      end !== undefined &&
      distanceToSegment(point, start, end) <=
        Math.max(6, connection.style.strokeWidth + 3)
    ) {
      return { kind: "connection", id: connection.connectionId };
    }
  }
  if (cell === undefined) return null;
  const identity = edgeIdentity(state.grid, cell, nearestEdge(cell, point));
  const edge = state.edges.get(identity.edgeId);
  if (edge !== undefined) {
    const segment = edgeSegment(state.grid, edge.edgeId, edge.adjacentCellIds);
    if (
      segment !== undefined &&
      distanceToSegment(point, segment[0], segment[1]) <=
        Math.max(6, edge.strokeWidth + 3)
    ) {
      return { kind: "edge", id: edge.edgeId };
    }
  }
  return { kind: "cell", id: cell.cellId };
}
