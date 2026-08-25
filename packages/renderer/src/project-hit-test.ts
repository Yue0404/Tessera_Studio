import {
  distanceToSegment,
  edgeIdentity,
  edgeSegment,
  nearestEdge,
  pointInRotatedBounds,
  type MapPoint,
  type ProjectState,
  type SelectedObject,
  type VisibleCell,
} from "@tessera/core";
import { endpointPoint, overlayAnchorPoint } from "./render-utils.js";
import {
  MARKER_MAX_CSS_PX,
  markerMapSize,
  textMapSize,
} from "./overlay-visibility.js";
import { conservativeTextBoundsSize } from "./visual-style.js";

function compareCodePoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function selectionLayerId(
  state: Readonly<ProjectState>,
  selected: SelectedObject,
): string | undefined {
  if (selected.kind === "cell") return "tessera.basic.cell-style";
  if (selected.kind === "edge") return "tessera.basic.edge-style";
  if (selected.kind === "overlay")
    return state.overlays.get(selected.id)?.layerId;
  if (selected.kind === "connection")
    return state.connections.get(selected.id)?.layerId;
  return state.moduleInstances.get(selected.id)?.layerId;
}

function selectionOrder(
  state: Readonly<ProjectState>,
  selected: SelectedObject,
): number {
  if (selected.kind === "overlay")
    return state.overlays.get(selected.id)?.orderInLayer ?? 0;
  if (selected.kind === "module-instance") {
    const instance = state.moduleInstances.get(selected.id);
    return instance?.kind === "overlay" ? instance.orderInLayer : 0;
  }
  return 0;
}

function compareSelections(
  state: Readonly<ProjectState>,
  left: SelectedObject,
  right: SelectedObject,
): number {
  const leftLayerId = selectionLayerId(state, left) ?? "";
  const rightLayerId = selectionLayerId(state, right) ?? "";
  const leftLayer = state.layers.get(leftLayerId);
  const rightLayer = state.layers.get(rightLayerId);
  return (
    (leftLayer?.zIndex ?? Number.NEGATIVE_INFINITY) -
      (rightLayer?.zIndex ?? Number.NEGATIVE_INFINITY) ||
    compareCodePoint(leftLayerId, rightLayerId) ||
    selectionOrder(state, left) - selectionOrder(state, right) ||
    compareCodePoint(left.id, right.id)
  );
}

function topmostSelection(
  state: Readonly<ProjectState>,
  candidates: readonly SelectedObject[],
): SelectedObject | null {
  return (
    [...candidates]
      .sort((left, right) => compareSelections(state, left, right))
      .at(-1) ?? null
  );
}

/** 在基础与扩展命中候选间复用实际图层高度，避免低层对象抢占选择。 */
export function topmostProjectHit(
  state: Readonly<ProjectState>,
  basic: SelectedObject | null,
  moduleInstanceId: string | null,
): SelectedObject | null {
  if (moduleInstanceId === null) return basic;
  const moduleHit: SelectedObject = {
    kind: "module-instance",
    id: moduleInstanceId,
  };
  if (basic === null) return moduleHit;
  return topmostSelection(state, [basic, moduleHit]);
}

/** 按固定图层高度与层内顺序，返回画布单击的最上层对象。 */
export function hitTestProjectObject(
  state: Readonly<ProjectState>,
  point: MapPoint,
  cell: VisibleCell | undefined,
  zoom = 1,
): SelectedObject | null {
  const queryRadius = Math.max(
    MARKER_MAX_CSS_PX / Math.max(zoom, 0.01),
    state.grid.cellSize * 2,
  );
  const queryRect = {
    minX: point.x - queryRadius,
    minY: point.y - queryRadius,
    maxX: point.x + queryRadius,
    maxY: point.y + queryRadius,
  };
  const candidates: SelectedObject[] = [];
  for (const overlay of state.overlays.query(queryRect)) {
    if (state.layers.get(overlay.layerId)?.visible === false) continue;
    const anchor = overlayAnchorPoint(state, overlay);
    if (anchor === undefined) continue;
    const matches =
      overlay.overlayType === "marker"
        ? Math.hypot(point.x - anchor.x, point.y - anchor.y) <=
          markerMapSize(overlay.style.size, zoom) / 2
        : (() => {
            const size = conservativeTextBoundsSize(
              overlay.text,
              textMapSize(overlay.style.fontSize, zoom),
              overlay.style.backgroundVisible,
            );
            return pointInRotatedBounds(
              point,
              anchor,
              size.width,
              size.height,
              overlay.style.rotation,
            );
          })();
    if (matches) {
      candidates.push({ kind: "overlay", id: overlay.overlayId });
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
      candidates.push({ kind: "connection", id: connection.connectionId });
    }
  }
  if (cell === undefined) return topmostSelection(state, candidates);
  const identity = edgeIdentity(state.grid, cell, nearestEdge(cell, point));
  const edge = state.edges.get(identity.edgeId);
  if (edge?.persistence === "explicit-style") {
    const segment = edgeSegment(state.grid, edge.edgeId, edge.adjacentCellIds);
    if (
      segment !== undefined &&
      distanceToSegment(point, segment[0], segment[1]) <=
        Math.max(6, edge.strokeWidth + 3)
    ) {
      candidates.push({ kind: "edge", id: edge.edgeId });
    }
  }
  candidates.push({ kind: "cell", id: cell.cellId });
  return topmostSelection(state, candidates);
}
