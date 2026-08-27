import {
  axialToOddR,
  cellId,
  DOMAIN_GROUP_MAX_MEMBERS,
  oddRToAxial,
  type ProjectGrid,
  type VisibleCell,
} from "@tessera/core";

export type FootprintPlacementRejection =
  "footprint-out-of-bounds" | "footprint-too-large" | "footprint-empty";

export type FixedFootprintPlacementPreset =
  | {
      readonly gridType: "square";
      readonly offsets: readonly {
        readonly row: number;
        readonly column: number;
      }[];
    }
  | {
      readonly gridType: "hex-pointy";
      readonly offsets: readonly {
        readonly q: number;
        readonly r: number;
      }[];
    };

type FixedFootprintPlan =
  | { readonly status: "committed"; readonly memberCellIds: readonly string[] }
  | { readonly status: "rejected"; readonly code: FootprintPlacementRejection };

function insideGrid(grid: Readonly<ProjectGrid>, row: number, column: number) {
  return row >= 0 && column >= 0 && row < grid.height && column < grid.width;
}

/** 从声明式相对坐标一次性计算固定 footprint，不枚举地图面积。 */
export function planFixedFootprint(
  grid: Readonly<ProjectGrid>,
  anchor: Readonly<{ row: number; column: number }>,
  preset: Readonly<FixedFootprintPlacementPreset>,
): FixedFootprintPlan {
  if (preset.gridType !== grid.type)
    return { status: "rejected", code: "footprint-empty" };
  if (preset.offsets.length === 0)
    return { status: "rejected", code: "footprint-empty" };
  if (preset.offsets.length > DOMAIN_GROUP_MAX_MEMBERS)
    return { status: "rejected", code: "footprint-too-large" };
  const anchorAxial = grid.type === "hex-pointy" ? oddRToAxial(anchor) : null;
  const coordinates = preset.offsets.map((offset) => {
    if (preset.gridType === "square") {
      if (!("row" in offset)) return null;
      return {
        row: anchor.row + offset.row,
        column: anchor.column + offset.column,
      };
    }
    if (!("q" in offset) || anchorAxial === null) return null;
    return axialToOddR({
      q: anchorAxial.q + offset.q,
      r: anchorAxial.r + offset.r,
    });
  });
  if (
    coordinates.some(
      (coordinate) =>
        coordinate === null ||
        !insideGrid(grid, coordinate.row, coordinate.column),
    )
  )
    return { status: "rejected", code: "footprint-out-of-bounds" };
  const validCoordinates = coordinates.filter(
    (
      coordinate,
    ): coordinate is { readonly row: number; readonly column: number } =>
      coordinate !== null,
  );
  const memberCellIds = validCoordinates.map((coordinate) =>
    cellId(grid.type, coordinate.row, coordinate.column),
  );
  if (new Set(memberCellIds).size !== memberCellIds.length)
    return { status: "rejected", code: "footprint-empty" };
  return { status: "committed", memberCellIds };
}

interface FootprintDraft {
  readonly pointerId: number;
  readonly memberCellIds: readonly string[];
  readonly rejection: FootprintPlacementRejection | null;
}

/** 对象固定 footprint 仅保存在渲染器瞬态状态中，拖动不发布工程状态。 */
export class FootprintPlacementState {
  #draft: FootprintDraft | null = null;

  get active(): boolean {
    return this.#draft !== null;
  }

  begin(
    pointerId: number,
    grid: Readonly<ProjectGrid>,
    anchor: Readonly<{ row: number; column: number }>,
    preset: Readonly<FixedFootprintPlacementPreset>,
  ): void {
    const plan = planFixedFootprint(grid, anchor, preset);
    this.#draft = {
      pointerId,
      memberCellIds: plan.status === "committed" ? plan.memberCellIds : [],
      rejection: plan.status === "rejected" ? plan.code : null,
    };
  }

  /** 固定预设不响应拖动，避免高频重绘和工程状态发布。 */
  move(pointerId: number): boolean {
    void pointerId;
    return false;
  }

  preview(cells: readonly VisibleCell[]): readonly VisibleCell[] {
    if (this.#draft === null) return [];
    const members = new Set(this.#draft.memberCellIds);
    return cells.filter((cell) => members.has(cell.cellId));
  }

  finish(
    pointerId: number,
  ): FixedFootprintPlan | { readonly status: "ignored" } {
    if (this.#draft === null || this.#draft.pointerId !== pointerId)
      return { status: "ignored" };
    const draft = this.#draft;
    this.#draft = null;
    return draft.rejection === null
      ? { status: "committed", memberCellIds: draft.memberCellIds }
      : { status: "rejected", code: draft.rejection };
  }

  cancel(): boolean {
    if (this.#draft === null) return false;
    this.#draft = null;
    return true;
  }
}
