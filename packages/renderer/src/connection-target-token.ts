import type { ConnectionEndpoint } from "@tessera/core";

/** 用端点的真实身份驱动自连接判定，不能只按端点所在的地格归并。 */
export function connectionTargetToken(
  endpoint: ConnectionEndpoint | null,
  fallbackCellId: string | null,
): string | null {
  if (endpoint?.kind === "map-point")
    return `point:${endpoint.point.x}:${endpoint.point.y}`;
  if (endpoint?.kind === "edge-midpoint") return endpoint.edgeId;
  if (endpoint?.kind === "cell-center") return endpoint.cellId;
  return fallbackCellId;
}
