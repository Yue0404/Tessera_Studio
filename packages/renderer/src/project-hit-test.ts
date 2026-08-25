import {
  clipSegmentToRect,
  distanceToSegment,
  edgeIdentity,
  edgeSegment,
  markerLabelBounds,
  markerLabelFontSize,
  markerLabelPoint,
  pointInRotatedBounds,
  type MapPoint,
  type MapRect,
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

export function projectHitLayerId(
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
  const leftLayerId = projectHitLayerId(state, left) ?? "";
  const rightLayerId = projectHitLayerId(state, right) ?? "";
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

function isPersistedSelection(
  state: Readonly<ProjectState>,
  selected: SelectedObject,
): boolean {
  if (selected.kind === "cell")
    return state.cells.get(selected.id) !== undefined;
  if (selected.kind === "edge")
    return state.edges.get(selected.id)?.persistence === "explicit-style";
  if (selected.kind === "overlay")
    return state.overlays.get(selected.id) !== undefined;
  if (selected.kind === "connection")
    return state.connections.get(selected.id) !== undefined;
  return state.moduleInstances.get(selected.id) !== undefined;
}

/** 去重并按实际图层、层内顺序和稳定 ID 从上到下排列真实持久对象。 */
export function orderProjectHitCandidates(
  state: Readonly<ProjectState>,
  candidates: readonly SelectedObject[],
): SelectedObject[] {
  const unique = new Map<string, SelectedObject>();
  for (const candidate of candidates) {
    if (!isPersistedSelection(state, candidate)) continue;
    const layerId = projectHitLayerId(state, candidate);
    if (layerId === undefined || state.layers.get(layerId)?.visible === false)
      continue;
    unique.set(`${candidate.kind}:${candidate.id}`, candidate);
  }
  return [...unique.values()].sort((left, right) =>
    compareSelections(state, right, left),
  );
}

/** 返回有序候选中的首个可编辑对象；锁层仍保留在原候选列表中。 */
export function firstEditableProjectHit(
  state: Readonly<ProjectState>,
  candidates: readonly SelectedObject[],
): SelectedObject | null {
  for (const candidate of candidates) {
    const layerId = projectHitLayerId(state, candidate);
    const layer = layerId === undefined ? undefined : state.layers.get(layerId);
    if (
      layer !== undefined &&
      layer.visible &&
      !layer.locked &&
      layer.runtimeStatus !== "missing"
    )
      return candidate;
  }
  return null;
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
  return (
    [basic, moduleHit].sort((left, right) =>
      compareSelections(state, right, left),
    )[0] ?? null
  );
}

function pointInRect(point: MapPoint, rect: MapRect): boolean {
  return (
    point.x >= rect.minX &&
    point.x <= rect.maxX &&
    point.y >= rect.minY &&
    point.y <= rect.maxY
  );
}

/** 只遍历稀疏持久化对象，框选绝不枚举或实例化空白几何。 */
export function boxSelectProjectObjects(
  state: Readonly<ProjectState>,
  rect: MapRect,
  visibleCells: readonly VisibleCell[],
): SelectedObject[] {
  const selected: SelectedObject[] = [];
  if (state.layers.get("tessera.basic.cell-style")?.visible !== false) {
    for (const cell of visibleCells) {
      if (
        state.cells.get(cell.cellId) !== undefined &&
        pointInRect(cell.center, rect)
      )
        selected.push({ kind: "cell", id: cell.cellId });
    }
  }
  if (state.layers.get("tessera.basic.edge-style")?.visible !== false) {
    const edgeIds = new Set<string>();
    const sideCount = state.grid.type === "square" ? 4 : 6;
    for (const cell of visibleCells)
      for (let side = 0; side < sideCount; side += 1)
        edgeIds.add(edgeIdentity(state.grid, cell, side).edgeId);
    for (const edgeId of edgeIds) {
      const edge = state.edges.get(edgeId);
      if (edge?.persistence !== "explicit-style") continue;
      const segment = edgeSegment(
        state.grid,
        edge.edgeId,
        edge.adjacentCellIds,
      );
      if (
        segment !== undefined &&
        clipSegmentToRect(segment[0], segment[1], rect) !== null
      )
        selected.push({ kind: "edge", id: edge.edgeId });
    }
  }
  for (const connection of state.connections.query(rect)) {
    if (state.layers.get(connection.layerId)?.visible === false) continue;
    const start = endpointPoint(state, connection.start);
    const end = endpointPoint(state, connection.end);
    if (
      start !== undefined &&
      end !== undefined &&
      clipSegmentToRect(start, end, rect) !== null
    )
      selected.push({ kind: "connection", id: connection.connectionId });
  }
  for (const overlay of state.overlays.query(rect)) {
    if (state.layers.get(overlay.layerId)?.visible === false) continue;
    const point = overlayAnchorPoint(state, overlay);
    if (point !== undefined && pointInRect(point, rect))
      selected.push({ kind: "overlay", id: overlay.overlayId });
  }
  return selected;
}

/** 按固定图层高度与层内顺序，返回画布单击的全部真实持久对象。 */
export function hitTestProjectObjects(
  state: Readonly<ProjectState>,
  point: MapPoint,
  cell: VisibleCell | undefined,
  zoom = 1,
): SelectedObject[] {
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
        ? (() => {
            const markerSize = markerMapSize(overlay.style.size, zoom);
            if (
              Math.hypot(point.x - anchor.x, point.y - anchor.y) <=
              markerSize / 2
            )
              return true;
            if (overlay.label === null) return false;
            const fontSize = textMapSize(
              markerLabelFontSize(overlay.style.size),
              zoom,
            );
            const bounds = markerLabelBounds(
              anchor,
              overlay.label,
              markerSize,
              fontSize,
            );
            const labelPoint = markerLabelPoint(anchor, markerSize, fontSize);
            return pointInRotatedBounds(
              point,
              labelPoint,
              bounds.maxX - bounds.minX,
              bounds.maxY - bounds.minY,
              0,
            );
          })()
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
  if (cell !== undefined) {
    const sideCount = state.grid.type === "square" ? 4 : 6;
    const seenEdges = new Set<string>();
    for (let side = 0; side < sideCount; side += 1) {
      const identity = edgeIdentity(state.grid, cell, side);
      if (seenEdges.has(identity.edgeId)) continue;
      seenEdges.add(identity.edgeId);
      const edge = state.edges.get(identity.edgeId);
      if (edge?.persistence !== "explicit-style") continue;
      const segment = edgeSegment(
        state.grid,
        edge.edgeId,
        edge.adjacentCellIds,
      );
      if (
        segment !== undefined &&
        distanceToSegment(point, segment[0], segment[1]) <=
          Math.max(6, edge.strokeWidth + 3)
      ) {
        candidates.push({ kind: "edge", id: edge.edgeId });
      }
    }
    if (state.cells.get(cell.cellId) !== undefined)
      candidates.push({ kind: "cell", id: cell.cellId });
  }
  return orderProjectHitCandidates(state, candidates);
}

/**
 * 单选返回最上层持久对象；若没有持久对象，则回退到当前可见基础地格。
 * 空白地格只服务选择与领域成员预选，不进入复数候选，避免被橡皮或框选误删。
 */
export function hitTestProjectObject(
  state: Readonly<ProjectState>,
  point: MapPoint,
  cell: VisibleCell | undefined,
  zoom = 1,
): SelectedObject | null {
  const persisted = hitTestProjectObjects(state, point, cell, zoom)[0];
  if (persisted !== undefined) return persisted;
  if (
    cell !== undefined &&
    state.layers.get("tessera.basic.cell-style")?.visible !== false
  )
    return { kind: "cell", id: cell.cellId };
  return null;
}
