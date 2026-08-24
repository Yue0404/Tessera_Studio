import { parseCellId } from "./coordinates.js";
import { cellCenter, edgeIdentity } from "./geometry.js";
import type { ProjectGrid } from "./types.js";

export interface DomainGroupBoundaryEdge {
  readonly edgeId: string;
  readonly adjacentCellIds: readonly string[];
}

export interface DomainGroupGeometry {
  readonly memberCellIds: readonly string[];
  readonly boundaryEdges: readonly DomainGroupBoundaryEdge[];
  readonly center: { readonly x: number; readonly y: number };
}

export class DomainGroupError extends Error {
  constructor(
    readonly code:
      | "domain-group-member-count-invalid"
      | "domain-group-member-duplicate"
      | "domain-group-member-out-of-bounds"
      | "domain-group-members-disconnected",
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(code);
    this.name = "DomainGroupError";
  }
}

function compareCellIds(left: string, right: string): number {
  const a = parseCellId(left);
  const b = parseCellId(right);
  return a.row - b.row || a.column - b.column;
}

/**
 * 领域对象的成员、外边界与几何中心共享同一套 O(memberCount) 推导。
 * v1 将成员上限固定为 64，因此不会因地图尺寸增长而退化。
 */
export function domainGroupGeometry(
  grid: ProjectGrid,
  inputCellIds: readonly string[],
  limits: Readonly<{ minMembers?: number; maxMembers?: number }> = {},
): DomainGroupGeometry {
  const minMembers = limits.minMembers ?? 2;
  const maxMembers = limits.maxMembers ?? 64;
  if (
    inputCellIds.length < minMembers ||
    inputCellIds.length > maxMembers ||
    minMembers < 2 ||
    maxMembers > 64 ||
    minMembers > maxMembers
  )
    throw new DomainGroupError("domain-group-member-count-invalid", {
      count: inputCellIds.length,
      minMembers,
      maxMembers,
    });

  const members = new Set(inputCellIds);
  if (members.size !== inputCellIds.length)
    throw new DomainGroupError("domain-group-member-duplicate");

  const coordinates = new Map(
    inputCellIds.map((cellId) => {
      const coordinate = parseCellId(cellId);
      if (
        coordinate.gridType !== grid.type ||
        coordinate.row < 0 ||
        coordinate.column < 0 ||
        coordinate.row >= grid.height ||
        coordinate.column >= grid.width
      )
        throw new DomainGroupError("domain-group-member-out-of-bounds", {
          cellId,
        });
      return [cellId, coordinate] as const;
    }),
  );

  const first = inputCellIds[0];
  if (first === undefined)
    throw new DomainGroupError("domain-group-member-count-invalid", {
      count: 0,
    });
  const visited = new Set([first]);
  const queue = [first];
  const boundary = new Map<string, DomainGroupBoundaryEdge>();
  let centerX = 0;
  let centerY = 0;

  for (const coordinate of coordinates.values()) {
    const center = cellCenter(grid, coordinate.row, coordinate.column);
    centerX += center.x;
    centerY += center.y;
    const sideCount = grid.type === "square" ? 4 : 6;
    for (let side = 0; side < sideCount; side += 1) {
      const edge = edgeIdentity(grid, coordinate, side);
      const memberCount = edge.adjacentCellIds.filter((id) =>
        members.has(id),
      ).length;
      if (memberCount === 1) boundary.set(edge.edgeId, edge);
    }
  }

  for (const cellId of queue) {
    const coordinate = coordinates.get(cellId);
    if (coordinate === undefined) continue;
    const sideCount = grid.type === "square" ? 4 : 6;
    for (let side = 0; side < sideCount; side += 1) {
      for (const adjacent of edgeIdentity(grid, coordinate, side)
        .adjacentCellIds) {
        if (
          adjacent !== cellId &&
          members.has(adjacent) &&
          !visited.has(adjacent)
        ) {
          visited.add(adjacent);
          queue.push(adjacent);
        }
      }
    }
  }
  if (visited.size !== members.size)
    throw new DomainGroupError("domain-group-members-disconnected", {
      connected: visited.size,
      count: members.size,
    });

  return Object.freeze({
    memberCellIds: Object.freeze([...members].sort(compareCellIds)),
    boundaryEdges: Object.freeze(
      [...boundary.values()].sort((left, right) =>
        left.edgeId < right.edgeId ? -1 : left.edgeId > right.edgeId ? 1 : 0,
      ),
    ),
    center: Object.freeze({
      x: centerX / members.size,
      y: centerY / members.size,
    }),
  });
}
