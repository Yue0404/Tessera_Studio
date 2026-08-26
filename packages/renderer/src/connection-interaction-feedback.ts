import type {
  ConnectionEndpoint,
  MapPoint,
  MapRect,
  VisibleCell,
} from "@tessera/core";

export type ConnectionExpectedTarget =
  "cell-center" | "edge-midpoint" | "map-point";

export type ConnectionTargetHit =
  "cell-center" | "cell-edge" | "map-point" | "map-position" | "outside-map";

export interface ConnectionFeedbackTarget {
  readonly point: MapPoint;
  readonly hit: ConnectionTargetHit;
  readonly row?: number;
  readonly column?: number;
  readonly edgeId?: string;
}

export type RendererInteractionRejection = Readonly<{
  code:
    | "connection-self-not-allowed"
    | "connection-target-invalid"
    | "connection-rebind-target-invalid"
    | "connection-commit-failed";
  expected: ConnectionExpectedTarget;
  target: ConnectionFeedbackTarget;
}>;

export function pointInsideMapBounds(
  point: Readonly<MapPoint>,
  bounds: Readonly<MapRect>,
): boolean {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}

/** 只在离散点击时建立反馈快照，避免把指针移动变成 React 高频状态。 */
export function connectionFeedbackTarget(
  point: Readonly<MapPoint>,
  cell: Readonly<VisibleCell> | undefined,
  endpoint: Readonly<ConnectionEndpoint> | null,
  mapBounds: Readonly<MapRect>,
): ConnectionFeedbackTarget {
  const base = { point: { ...point } };
  if (endpoint?.kind === "cell-center" && cell !== undefined) {
    return {
      ...base,
      hit: "cell-center",
      row: cell.row,
      column: cell.column,
    };
  }
  if (endpoint?.kind === "edge-midpoint" && cell !== undefined) {
    return {
      ...base,
      hit: "cell-edge",
      row: cell.row,
      column: cell.column,
      edgeId: endpoint.edgeId,
    };
  }
  if (endpoint?.kind === "map-point") return { ...base, hit: "map-point" };
  return {
    ...base,
    hit: pointInsideMapBounds(point, mapBounds)
      ? "map-position"
      : "outside-map",
  };
}
