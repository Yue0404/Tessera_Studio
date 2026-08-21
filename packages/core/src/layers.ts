import type { FixedLayerState } from "./types.js";

const BASIC_VERSION = "1.0.0";

export const FIXED_LAYERS: readonly FixedLayerState[] = Object.freeze([
  {
    layerId: "tessera.basic.cell-style",
    moduleVersion: BASIC_VERSION,
    zIndex: 500,
    visible: true,
    locked: false,
    opacity: 1,
    allowedKinds: ["cell"],
  },
  {
    layerId: "tessera.system.grid",
    moduleVersion: BASIC_VERSION,
    zIndex: 900,
    visible: true,
    locked: true,
    opacity: 1,
    allowedKinds: [],
  },
  {
    layerId: "tessera.basic.edge-style",
    moduleVersion: BASIC_VERSION,
    zIndex: 1500,
    visible: true,
    locked: false,
    opacity: 1,
    allowedKinds: ["edge"],
  },
  {
    layerId: "tessera.basic.placed-object",
    moduleVersion: BASIC_VERSION,
    zIndex: 3000,
    visible: true,
    locked: false,
    opacity: 1,
    allowedKinds: ["overlay"],
  },
  {
    layerId: "tessera.basic.connection",
    moduleVersion: BASIC_VERSION,
    zIndex: 4300,
    visible: true,
    locked: false,
    opacity: 1,
    allowedKinds: ["connection"],
  },
  {
    layerId: "tessera.basic.annotation",
    moduleVersion: BASIC_VERSION,
    zIndex: 4400,
    visible: true,
    locked: false,
    opacity: 1,
    allowedKinds: ["overlay"],
  },
]);

export function createFixedLayerMap(): ReadonlyMap<string, FixedLayerState> {
  return new Map(FIXED_LAYERS.map((layer) => [layer.layerId, { ...layer }]));
}

export function sortLayers(
  layers: Iterable<FixedLayerState>,
): FixedLayerState[] {
  return [...layers].sort(
    (left, right) =>
      left.zIndex - right.zIndex || left.layerId.localeCompare(right.layerId),
  );
}
