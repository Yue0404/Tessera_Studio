import {
  projectConnectionEndpointPoint,
  projectOverlayAnchorPoint,
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
  return projectOverlayAnchorPoint(state, overlay);
}

export function endpointPoint(
  state: Readonly<ProjectState>,
  endpoint: ConnectionEndpoint,
): Point | undefined {
  return projectConnectionEndpointPoint(state, endpoint);
}
