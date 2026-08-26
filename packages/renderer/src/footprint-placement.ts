import {
  DOMAIN_GROUP_MAX_MEMBERS,
  type MapPoint,
  type VisibleCell,
} from "@tessera/core";

export type FootprintPlacementRejection =
  "footprint-out-of-bounds" | "footprint-too-large" | "footprint-empty";

interface FootprintDraft {
  readonly pointerId: number;
  readonly startPoint: MapPoint;
  readonly previewPoint: MapPoint;
  readonly startCellId: string;
}

function membersInBounds(
  draft: FootprintDraft,
  cells: readonly VisibleCell[],
): VisibleCell[] {
  const left = Math.min(draft.startPoint.x, draft.previewPoint.x);
  const right = Math.max(draft.startPoint.x, draft.previewPoint.x);
  const top = Math.min(draft.startPoint.y, draft.previewPoint.y);
  const bottom = Math.max(draft.startPoint.y, draft.previewPoint.y);
  const members = cells.filter(
    (cell) =>
      cell.center.x >= left &&
      cell.center.x <= right &&
      cell.center.y >= top &&
      cell.center.y <= bottom,
  );
  if (!members.some((cell) => cell.cellId === draft.startCellId)) {
    const start = cells.find((cell) => cell.cellId === draft.startCellId);
    if (start !== undefined) members.push(start);
  }
  return members;
}

/** 对象 footprint 仅保存在渲染器瞬态状态中，不随鼠标移动发布工程状态。 */
export class FootprintPlacementState {
  #draft: FootprintDraft | null = null;

  get active(): boolean {
    return this.#draft !== null;
  }

  begin(pointerId: number, point: MapPoint, cellId: string): void {
    this.#draft = {
      pointerId,
      startPoint: { ...point },
      previewPoint: { ...point },
      startCellId: cellId,
    };
  }

  move(pointerId: number, point: MapPoint): boolean {
    if (this.#draft === null || this.#draft.pointerId !== pointerId)
      return false;
    this.#draft = { ...this.#draft, previewPoint: { ...point } };
    return true;
  }

  preview(cells: readonly VisibleCell[]): readonly VisibleCell[] {
    return this.#draft === null ? [] : membersInBounds(this.#draft, cells);
  }

  finish(
    pointerId: number,
    point: MapPoint,
    endCell: VisibleCell | undefined,
    cells: readonly VisibleCell[],
  ):
    | {
        readonly status: "committed";
        readonly memberCellIds: readonly string[];
      }
    | {
        readonly status: "rejected";
        readonly code: FootprintPlacementRejection;
      }
    | { readonly status: "ignored" } {
    if (this.#draft === null || this.#draft.pointerId !== pointerId)
      return { status: "ignored" };
    const draft = {
      ...this.#draft,
      previewPoint: { ...(endCell?.center ?? point) },
    };
    this.#draft = null;
    if (endCell === undefined)
      return { status: "rejected", code: "footprint-out-of-bounds" };
    const members = membersInBounds(draft, cells);
    if (members.length === 0)
      return { status: "rejected", code: "footprint-empty" };
    if (members.length > DOMAIN_GROUP_MAX_MEMBERS)
      return { status: "rejected", code: "footprint-too-large" };
    return {
      status: "committed",
      memberCellIds: members.map((cell) => cell.cellId),
    };
  }

  cancel(): boolean {
    if (this.#draft === null) return false;
    this.#draft = null;
    return true;
  }
}
