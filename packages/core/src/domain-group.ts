import { axialToOddR, oddRToAxial, parseCellId } from "./coordinates.js";
import { cellCenter, edgeIdentity } from "./geometry.js";
import type { ProjectGrid } from "./types.js";

export const DOMAIN_GROUP_MAX_MEMBERS = 4096;
export const DOMAIN_GROUP_LAYOUT_EXTENSION_KEY =
  "tessera.studio:domain-group-layout";

export type DomainGroupRelativeOffset =
  | { readonly rowDelta: number; readonly columnDelta: number }
  | { readonly dq: number; readonly dr: number };

export type DomainGroupLayout =
  | {
      readonly version: "1";
      readonly anchorCellId: string;
      readonly coordinateSystem: "row-column";
      readonly relativeOffsets: readonly Extract<
        DomainGroupRelativeOffset,
        { readonly rowDelta: number }
      >[];
    }
  | {
      readonly version: "1";
      readonly anchorCellId: string;
      readonly coordinateSystem: "axial-q-r";
      readonly relativeOffsets: readonly Extract<
        DomainGroupRelativeOffset,
        { readonly dq: number }
      >[];
    };

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
      | "domain-group-members-disconnected"
      | "domain-group-layout-invalid"
      | "domain-group-layout-coordinate-system-mismatch"
      | "domain-group-layout-members-mismatch",
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

function assertGridCell(grid: ProjectGrid, value: string) {
  let coordinate: ReturnType<typeof parseCellId>;
  try {
    coordinate = parseCellId(value);
  } catch {
    throw new DomainGroupError("domain-group-layout-invalid", { value });
  }
  if (
    coordinate.gridType !== grid.type ||
    coordinate.row < 0 ||
    coordinate.column < 0 ||
    coordinate.row >= grid.height ||
    coordinate.column >= grid.width
  )
    throw new DomainGroupError("domain-group-member-out-of-bounds", {
      cellId: value,
    });
  return coordinate;
}

/** 从 v1 的成员事实确定性选择左上成员为锚点，并生成规范相对坐标。 */
export function deriveDomainGroupLayout(
  grid: ProjectGrid,
  memberCellIds: readonly string[],
): DomainGroupLayout {
  const members = domainGroupGeometry(grid, memberCellIds).memberCellIds;
  const anchorCellId = members[0];
  if (anchorCellId === undefined)
    throw new DomainGroupError("domain-group-layout-invalid");
  const anchor = assertGridCell(grid, anchorCellId);
  if (grid.type === "square") {
    return Object.freeze({
      version: "1" as const,
      anchorCellId,
      coordinateSystem: "row-column" as const,
      relativeOffsets: Object.freeze(
        members.map((cellId) => {
          const coordinate = assertGridCell(grid, cellId);
          return Object.freeze({
            rowDelta: coordinate.row - anchor.row,
            columnDelta: coordinate.column - anchor.column,
          });
        }),
      ),
    });
  }
  const anchorAxial = oddRToAxial(anchor);
  return Object.freeze({
    version: "1" as const,
    anchorCellId,
    coordinateSystem: "axial-q-r" as const,
    relativeOffsets: Object.freeze(
      members.map((cellId) => {
        const coordinate = assertGridCell(grid, cellId);
        const axial = oddRToAxial(coordinate);
        return Object.freeze({
          dq: axial.q - anchorAxial.q,
          dr: axial.r - anchorAxial.r,
        });
      }),
    ),
  });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function parseDomainGroupLayout(
  grid: ProjectGrid,
  value: unknown,
): DomainGroupLayout {
  if (
    !isRecord(value) ||
    value.version !== "1" ||
    typeof value.anchorCellId !== "string" ||
    !Array.isArray(value.relativeOffsets) ||
    value.relativeOffsets.length < 1 ||
    value.relativeOffsets.length > DOMAIN_GROUP_MAX_MEMBERS
  )
    throw new DomainGroupError("domain-group-layout-invalid");
  const expectedSystem = grid.type === "square" ? "row-column" : "axial-q-r";
  if (value.coordinateSystem !== expectedSystem)
    throw new DomainGroupError(
      "domain-group-layout-coordinate-system-mismatch",
      { expected: expectedSystem, actual: value.coordinateSystem },
    );
  const anchorCellId = value.anchorCellId;
  assertGridCell(grid, anchorCellId);
  if (expectedSystem === "row-column") {
    const relativeOffsets = value.relativeOffsets.map((candidate) => {
      if (
        !isRecord(candidate) ||
        !integer(candidate.rowDelta) ||
        !integer(candidate.columnDelta)
      )
        throw new DomainGroupError("domain-group-layout-invalid");
      return Object.freeze({
        rowDelta: candidate.rowDelta,
        columnDelta: candidate.columnDelta,
      });
    });
    return Object.freeze({
      version: "1",
      anchorCellId,
      coordinateSystem: "row-column",
      relativeOffsets: Object.freeze(relativeOffsets),
    });
  }
  const relativeOffsets = value.relativeOffsets.map((candidate) => {
    if (
      !isRecord(candidate) ||
      !integer(candidate.dq) ||
      !integer(candidate.dr)
    )
      throw new DomainGroupError("domain-group-layout-invalid");
    return Object.freeze({ dq: candidate.dq, dr: candidate.dr });
  });
  return Object.freeze({
    version: "1",
    anchorCellId,
    coordinateSystem: "axial-q-r",
    relativeOffsets: Object.freeze(relativeOffsets),
  });
}

/** 从锚点和相对坐标派生 v1 memberCellIds 事实。 */
export function domainGroupMemberCellIdsFromLayout(
  grid: ProjectGrid,
  layout: DomainGroupLayout,
): readonly string[] {
  const anchor = assertGridCell(grid, layout.anchorCellId);
  const members = layout.relativeOffsets.map((offset) => {
    if (layout.coordinateSystem === "row-column") {
      if (!("rowDelta" in offset))
        throw new DomainGroupError("domain-group-layout-invalid");
      const row = anchor.row + offset.rowDelta;
      const column = anchor.column + offset.columnDelta;
      return `cell:${grid.type}:${row}:${column}`;
    }
    if (!("dq" in offset))
      throw new DomainGroupError("domain-group-layout-invalid");
    const anchorAxial = oddRToAxial(anchor);
    const { row, column } = axialToOddR({
      q: anchorAxial.q + offset.dq,
      r: anchorAxial.r + offset.dr,
    });
    return `cell:${grid.type}:${row}:${column}`;
  });
  for (const member of members) assertGridCell(grid, member);
  return domainGroupGeometry(grid, members).memberCellIds;
}

/** 旧工程无布局扩展时确定性推导；新工程扩展必须与 v1 成员事实严格一致。 */
export function resolveDomainGroupLayout(
  grid: ProjectGrid,
  memberCellIds: readonly string[],
  extensions: Readonly<Record<string, unknown>>,
): DomainGroupLayout {
  const value = extensions[DOMAIN_GROUP_LAYOUT_EXTENSION_KEY];
  if (value === undefined) return deriveDomainGroupLayout(grid, memberCellIds);
  const layout = parseDomainGroupLayout(grid, value);
  const derived = domainGroupMemberCellIdsFromLayout(grid, layout);
  const facts = domainGroupGeometry(grid, memberCellIds).memberCellIds;
  if (
    derived.length !== facts.length ||
    derived.some((cellId, index) => cellId !== facts[index])
  )
    throw new DomainGroupError("domain-group-layout-members-mismatch", {
      anchorCellId: layout.anchorCellId,
    });
  return layout;
}

/** 写入 Tessera 命名空间时仅覆盖自有键，第三方未知扩展保持原样。 */
export function domainGroupExtensionsWithLayout(
  grid: ProjectGrid,
  memberCellIds: readonly string[],
  extensions: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    ...extensions,
    [DOMAIN_GROUP_LAYOUT_EXTENSION_KEY]: deriveDomainGroupLayout(
      grid,
      memberCellIds,
    ),
  });
}

/** 恢复时保留有效显式锚点；旧工程缺少自有扩展时补入确定性布局。 */
export function normalizedDomainGroupExtensions(
  grid: ProjectGrid,
  memberCellIds: readonly string[],
  extensions: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    ...extensions,
    [DOMAIN_GROUP_LAYOUT_EXTENSION_KEY]: resolveDomainGroupLayout(
      grid,
      memberCellIds,
      extensions,
    ),
  });
}

/**
 * 领域对象的成员、外边界与几何中心共享同一套 O(memberCount) 推导。
 * v1 将成员上限固定为 4096，因此不会因地图理论尺寸增长而退化。
 */
export function domainGroupGeometry(
  grid: ProjectGrid,
  inputCellIds: readonly string[],
  limits: Readonly<{ minMembers?: number; maxMembers?: number }> = {},
): DomainGroupGeometry {
  const minMembers = limits.minMembers ?? 1;
  const maxMembers = limits.maxMembers ?? DOMAIN_GROUP_MAX_MEMBERS;
  if (
    inputCellIds.length < minMembers ||
    inputCellIds.length > maxMembers ||
    minMembers < 1 ||
    maxMembers > DOMAIN_GROUP_MAX_MEMBERS ||
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
