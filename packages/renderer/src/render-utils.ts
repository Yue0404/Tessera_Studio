import {
  cellCenter,
  edgeSegment,
  type ConnectionEndpoint,
  type Point,
  type OverlayData,
  type ProjectState,
} from "@tessera/core";

export function colorValue(color: string): { color: number; alpha: number } {
  const normalized = color.replace("#", "");
  return {
    color: Number.parseInt(normalized.slice(0, 6), 16),
    alpha:
      normalized.length === 8
        ? Number.parseInt(normalized.slice(6), 16) / 255
        : 1,
  };
}

export function overlayAnchorPoint(
  state: Readonly<ProjectState>,
  overlay: OverlayData,
): Point | undefined {
  if (overlay.kind === "free-overlay") return overlay.point;
  if (overlay.anchor.kind === "cell") {
    const parts = overlay.anchor.cellId.split(":");
    const row = Number(parts.at(-2));
    const column = Number(parts.at(-1));
    return Number.isInteger(row) && Number.isInteger(column)
      ? cellCenter(state.grid, row, column)
      : undefined;
  }
  const edge = state.edges.get(overlay.anchor.edgeId);
  if (edge === undefined) return undefined;
  const segment = edgeSegment(state.grid, edge.edgeId, edge.adjacentCellIds);
  return segment === undefined
    ? undefined
    : {
        x: (segment[0].x + segment[1].x) / 2,
        y: (segment[0].y + segment[1].y) / 2,
      };
}

export function endpointPoint(
  state: Readonly<ProjectState>,
  endpoint: ConnectionEndpoint,
): Point | undefined {
  if (endpoint.kind === "map-point") return endpoint.point;
  if (endpoint.kind === "cell-center") {
    const parts = endpoint.cellId.split(":");
    const row = Number(parts.at(-2));
    const column = Number(parts.at(-1));
    if (!Number.isInteger(row) || !Number.isInteger(column)) return undefined;
    return cellCenter(state.grid, row, column);
  }
  const edge = state.edges.get(endpoint.edgeId);
  if (edge === undefined) return undefined;
  const segment = edgeSegment(state.grid, edge.edgeId, edge.adjacentCellIds);
  if (segment === undefined) return undefined;
  return {
    x: (segment[0].x + segment[1].x) / 2,
    y: (segment[0].y + segment[1].y) / 2,
  };
}
