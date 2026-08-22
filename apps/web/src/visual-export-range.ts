import type { MapRect, ProjectState } from "@tessera/core";
import type {
  VisualExportRange,
  VisualExportSnapshot,
} from "@tessera/renderer/visual-export";

export type VisualExportRangeSource =
  | { readonly kind: "viewport" }
  | { readonly kind: "selection" }
  | { readonly kind: "custom"; readonly bounds: Readonly<MapRect> }
  | { readonly kind: "content-bounds" }
  | { readonly kind: "full-map" };

export interface InteractionRangeSnapshot {
  readonly viewportBounds: Readonly<MapRect> | null;
  readonly selectionBounds: Readonly<MapRect> | null;
}

export interface ResolvedVisualExportRange {
  readonly kind: VisualExportRange["kind"];
  readonly bounds: Readonly<MapRect>;
}

export class VisualExportRangeSnapshotError extends Error {
  constructor(
    readonly code: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(code);
    this.name = "VisualExportRangeSnapshotError";
  }
}

export interface VisualExportRangeModule {
  captureVisualExportSnapshot(
    state: Readonly<ProjectState>,
  ): VisualExportSnapshot;
  resolveVisualExportBounds(
    snapshot: VisualExportSnapshot,
    range: VisualExportRange,
  ): MapRect;
}

type VisualExportRangeModuleLoader = () => Promise<VisualExportRangeModule>;

const loadVisualExportRangeModule: VisualExportRangeModuleLoader = () =>
  import("@tessera/renderer/visual-export");

/** 使用调用方在开始导出时冻结的 snapshot 解析范围，避免二次捕获造成竞态。 */
export function resolveVisualExportRangeFromSnapshot(
  snapshot: VisualExportSnapshot,
  source: VisualExportRangeSource,
  interaction: InteractionRangeSnapshot,
  module: Pick<VisualExportRangeModule, "resolveVisualExportBounds">,
): ResolvedVisualExportRange {
  const request = rangeRequest(source, interaction);
  const bounds = module.resolveVisualExportBounds(snapshot, request);
  return Object.freeze({
    kind: request.kind,
    bounds: Object.freeze({ ...bounds }),
  });
}

function rangeRequest(
  source: VisualExportRangeSource,
  interaction: InteractionRangeSnapshot,
): VisualExportRange {
  if (source.kind === "viewport") {
    if (interaction.viewportBounds === null) {
      throw new VisualExportRangeSnapshotError(
        "visual-export-viewport-unavailable",
      );
    }
    return { kind: source.kind, bounds: { ...interaction.viewportBounds } };
  }
  if (source.kind === "selection") {
    if (interaction.selectionBounds === null) {
      throw new VisualExportRangeSnapshotError(
        "visual-export-selection-unavailable",
      );
    }
    return { kind: source.kind, bounds: { ...interaction.selectionBounds } };
  }
  if (source.kind === "custom") {
    return { kind: source.kind, bounds: { ...source.bounds } };
  }
  return { kind: source.kind };
}

/** 仅在导出事件发生时动态载入重模块，解析过程不修改工程或交互状态。 */
export async function resolveVisualExportRangeSnapshot(
  state: Readonly<ProjectState>,
  source: VisualExportRangeSource,
  interaction: InteractionRangeSnapshot,
  loadModule: VisualExportRangeModuleLoader = loadVisualExportRangeModule,
): Promise<ResolvedVisualExportRange> {
  const module = await loadModule();
  const snapshot = module.captureVisualExportSnapshot(state);
  return resolveVisualExportRangeFromSnapshot(
    snapshot,
    source,
    interaction,
    module,
  );
}
