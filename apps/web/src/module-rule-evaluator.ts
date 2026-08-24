import {
  cellCenter,
  cellId,
  cellNeighbors,
  edgeIdentity,
  edgeSegment,
  mapPointToCell,
  parseCellId,
  type EditorStore,
  type MapPoint,
  type ModuleRuntimeInstance,
} from "@tessera/core";
import {
  resolveLocalizedText,
  type AnchorKind,
  type ConstraintCondition,
  type JsonPrimitive,
  type ModuleConstraintDefinition,
  type ModuleElementDefinition,
  type ParsedModulePackage,
} from "@tessera/module-runtime";

export interface ProjectRuleHint {
  readonly instanceId: string;
  readonly elementId: string;
  readonly severity: "error" | "warning" | "info";
  readonly kind: "occupancy" | "constraint";
  readonly message: string;
  readonly constraintId?: string;
  readonly slotId?: string;
  readonly count?: number;
}

interface AnchorContext {
  readonly kind: AnchorKind;
  readonly key: string;
  readonly cellIds: readonly string[];
  readonly cellId?: string;
  readonly edgeId?: string;
  readonly point?: Readonly<MapPoint>;
}

interface ConstraintRecord {
  readonly definition: ModuleConstraintDefinition;
  readonly message: string;
}

function primitiveEqual(left: unknown, right: JsonPrimitive): boolean {
  return left === right;
}

function pointKey(point: Readonly<MapPoint>): string {
  return `map:${point.x}:${point.y}`;
}

function pointRect(point: Readonly<MapPoint>) {
  return { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y };
}

/** 规则求值只读取当前工程事实；不修改对象，也不把 error 当作编辑门禁。 */
export class ProjectModuleRuleEvaluator {
  readonly #store: EditorStore;
  readonly #elementById: ReadonlyMap<string, ModuleElementDefinition>;
  readonly #constraintById: ReadonlyMap<string, ConstraintRecord>;

  constructor(
    store: EditorStore,
    modules: readonly ParsedModulePackage[],
    language: string,
  ) {
    this.#store = store;
    this.#elementById = new Map(
      modules.flatMap((module) =>
        module.elements.map((element) => [element.elementId, element] as const),
      ),
    );
    this.#constraintById = new Map(
      modules.flatMap((module) =>
        module.constraints.map(
          (definition) =>
            [
              definition.constraintId,
              {
                definition,
                message:
                  definition.messageKey.kind === "literal"
                    ? definition.messageKey.text
                    : resolveLocalizedText(
                        definition.messageKey,
                        language,
                        module.locales,
                        module.manifest.defaultLanguage,
                      ),
              },
            ] as const,
        ),
      ),
    );
  }

  hintsForInstance(instanceId: string): readonly ProjectRuleHint[] {
    const instance = this.#store.state.moduleInstances.get(instanceId);
    const element =
      instance === undefined
        ? undefined
        : this.#elementById.get(instance.elementId);
    if (instance === undefined || element === undefined) return [];
    const anchors = this.#anchors(instance, element);
    const hints: ProjectRuleHint[] = [];
    for (const occupancy of element.occupancy) {
      if (occupancy.conflict === "allow") continue;
      const invalidCounts = anchors
        .filter((item) => item.kind === occupancy.anchor)
        .map((anchor) => this.#occupancyCount(anchor, occupancy.slotId))
        .filter((count) => count < occupancy.min || count > occupancy.max);
      const count = invalidCounts[0];
      if (count === undefined) continue;
      hints.push({
        instanceId,
        elementId: instance.elementId,
        severity: occupancy.conflict,
        kind: "occupancy",
        message: "",
        slotId: occupancy.slotId,
        count,
      });
    }
    for (const constraintId of element.constraintIds) {
      const record = this.#constraintById.get(constraintId);
      if (record === undefined) continue;
      if (
        !this.#conditionWithinLimits(
          record.definition.condition,
          record.definition.maxRadius,
          element,
        )
      )
        continue;
      if (!record.definition.appliesTo.includes(instance.elementId)) continue;
      const valid =
        anchors.length > 0 &&
        anchors.every((anchor) =>
          this.#evaluate(record.definition.condition, instance, anchor),
        );
      if (valid) continue;
      hints.push({
        instanceId,
        elementId: instance.elementId,
        severity: record.definition.severity,
        kind: "constraint",
        message: record.message,
        constraintId,
      });
    }
    return hints.sort(
      (left, right) =>
        ({ error: 0, warning: 1, info: 2 })[left.severity] -
          { error: 0, warning: 1, info: 2 }[right.severity] ||
        (left.constraintId ?? left.slotId ?? "").localeCompare(
          right.constraintId ?? right.slotId ?? "",
        ),
    );
  }

  #anchors(
    instance: ModuleRuntimeInstance,
    element: ModuleElementDefinition,
  ): readonly AnchorContext[] {
    if (instance.kind === "cell")
      return [this.#cellAnchor("cell", instance.cellId)];
    if (instance.kind === "edge") return [this.#edgeAnchor(instance.edgeId)];
    if (instance.kind === "overlay") {
      if (
        instance.objectKind === "free-overlay" &&
        instance.point !== undefined
      )
        return [this.#mapAnchor(instance.point)];
      if (instance.anchor?.kind === "edge")
        return [this.#edgeAnchor(instance.anchor.edgeId)];
      if (instance.anchor?.kind === "cell") {
        const kind =
          element.anchors.includes("cell-center") &&
          !element.anchors.includes("cell")
            ? "cell-center"
            : "cell";
        return [this.#cellAnchor(kind, instance.anchor.cellId)];
      }
      return [];
    }
    if (instance.kind !== "connection") return [];
    return [instance.start, instance.end].map((endpoint) =>
      endpoint.kind === "cell-center"
        ? this.#cellAnchor("cell-center", endpoint.cellId)
        : endpoint.kind === "edge-midpoint"
          ? this.#edgeAnchor(endpoint.edgeId)
          : this.#mapAnchor(endpoint.point),
    );
  }

  #cellAnchor(kind: "cell" | "cell-center", value: string): AnchorContext {
    return { kind, key: `cell:${value}`, cellId: value, cellIds: [value] };
  }

  #edgeAnchor(edgeIdValue: string): AnchorContext {
    const edge = this.#store.state.edges.get(edgeIdValue);
    return {
      kind: "edge",
      key: `edge:${edgeIdValue}`,
      edgeId: edgeIdValue,
      cellIds: edge?.adjacentCellIds ?? [],
    };
  }

  #mapAnchor(point: Readonly<MapPoint>): AnchorContext {
    const coordinate = mapPointToCell(this.#store.state.grid, point);
    return {
      kind: "map-point",
      key: pointKey(point),
      point,
      cellIds:
        coordinate === undefined
          ? []
          : [
              cellId(
                this.#store.state.grid.type,
                coordinate.row,
                coordinate.column,
              ),
            ],
    };
  }

  #candidatesAt(anchor: AnchorContext): readonly ModuleRuntimeInstance[] {
    const state = this.#store.state;
    const byId = new Map<string, ModuleRuntimeInstance>();
    if (anchor.cellId !== undefined) {
      for (const item of state.moduleInstances.valuesForCarrier(
        "cell",
        anchor.cellId,
      ))
        byId.set(item.instanceId, item);
      for (const item of state.moduleInstances.valuesForOverlayAnchor(
        "cell",
        anchor.cellId,
      ))
        byId.set(item.instanceId, item);
      const coordinate = parseCellId(anchor.cellId);
      const point = cellCenter(state.grid, coordinate.row, coordinate.column);
      for (const item of state.moduleInstances.queryConnections(
        pointRect(point),
      )) {
        if (
          (item.start.kind === "cell-center" &&
            item.start.cellId === anchor.cellId) ||
          (item.end.kind === "cell-center" && item.end.cellId === anchor.cellId)
        )
          byId.set(item.instanceId, item);
      }
    } else if (anchor.edgeId !== undefined) {
      for (const item of state.moduleInstances.valuesForCarrier(
        "edge",
        anchor.edgeId,
      ))
        byId.set(item.instanceId, item);
      for (const item of state.moduleInstances.valuesForOverlayAnchor(
        "edge",
        anchor.edgeId,
      ))
        byId.set(item.instanceId, item);
      const edge = state.edges.get(anchor.edgeId);
      const segment =
        edge === undefined
          ? undefined
          : edgeSegment(state.grid, edge.edgeId, edge.adjacentCellIds);
      if (segment !== undefined) {
        const point = {
          x: (segment[0].x + segment[1].x) / 2,
          y: (segment[0].y + segment[1].y) / 2,
        };
        for (const item of state.moduleInstances.queryConnections(
          pointRect(point),
        )) {
          if (
            (item.start.kind === "edge-midpoint" &&
              item.start.edgeId === anchor.edgeId) ||
            (item.end.kind === "edge-midpoint" &&
              item.end.edgeId === anchor.edgeId)
          )
            byId.set(item.instanceId, item);
        }
      }
    } else if (anchor.point !== undefined) {
      for (const item of state.moduleInstances.queryFreeOverlays(
        pointRect(anchor.point),
      )) {
        if (item.point?.x === anchor.point.x && item.point.y === anchor.point.y)
          byId.set(item.instanceId, item);
      }
      for (const item of state.moduleInstances.queryConnections(
        pointRect(anchor.point),
      )) {
        const points = [item.start, item.end].flatMap((endpoint) =>
          endpoint.kind === "map-point" ? [endpoint.point] : [],
        );
        if (
          points.some(
            (point) =>
              point.x === anchor.point?.x && point.y === anchor.point?.y,
          )
        )
          byId.set(item.instanceId, item);
      }
    }
    return [...byId.values()];
  }

  #occupancyCount(anchor: AnchorContext, slotId: string): number {
    return this.#candidatesAt(anchor).filter((candidate) =>
      this.#occupiesSlotAt(candidate, anchor, slotId),
    ).length;
  }

  #occupiesSlotAt(
    candidate: ModuleRuntimeInstance,
    anchor: AnchorContext,
    slotId: string,
  ): boolean {
    const definition = this.#elementById.get(candidate.elementId);
    if (definition === undefined) return false;
    return this.#anchors(candidate, definition).some(
      (candidateAnchor) =>
        candidateAnchor.key === anchor.key &&
        definition.occupancy.some(
          (occupancy) =>
            occupancy.slotId === slotId &&
            occupancy.anchor === candidateAnchor.kind,
        ),
    );
  }

  #neighborCells(anchor: AnchorContext, radius: number): readonly string[] {
    const grid = this.#store.state.grid;
    const seen = new Set(anchor.cellIds);
    let frontier = [...anchor.cellIds];
    const result = new Set<string>();
    for (let distance = 1; distance <= radius; distance += 1) {
      const next: string[] = [];
      for (const currentId of frontier) {
        const current = parseCellId(currentId);
        for (const neighbor of cellNeighbors(grid, current)) {
          const id = cellId(grid.type, neighbor.row, neighbor.column);
          if (seen.has(id)) continue;
          seen.add(id);
          result.add(id);
          next.push(id);
        }
      }
      frontier = next;
    }
    return [...result];
  }

  #neighborCount(
    anchor: AnchorContext,
    condition: Extract<ConstraintCondition, { op: "neighbor-count" }>,
  ): number {
    const ids = new Set<string>();
    for (const neighborCellId of this.#neighborCells(
      anchor,
      condition.radius,
    )) {
      const neighborAnchor = this.#cellAnchor("cell", neighborCellId);
      for (const candidate of this.#candidatesAt(neighborAnchor)) {
        if (condition.elementId !== undefined) {
          if (candidate.elementId === condition.elementId)
            ids.add(candidate.instanceId);
        } else if (
          condition.slotId !== undefined &&
          this.#occupiesSlotAt(candidate, neighborAnchor, condition.slotId)
        ) {
          ids.add(candidate.instanceId);
        }
      }
    }
    return ids.size;
  }

  #property(
    instance: ModuleRuntimeInstance,
    anchor: AnchorContext,
    path: string,
  ): unknown {
    if (path === "grid.type") return this.#store.state.grid.type;
    if (path === "anchor.kind") return anchor.kind;
    if (path === "cell.row" || path === "cell.column") {
      const id = anchor.cellId ?? anchor.cellIds[0];
      if (id === undefined) return undefined;
      const coordinate = parseCellId(id);
      return path === "cell.row" ? coordinate.row : coordinate.column;
    }
    if (path === "edge.side" && anchor.edgeId !== undefined) {
      const edge = this.#store.state.edges.get(anchor.edgeId);
      const first = edge?.adjacentCellIds[0];
      if (first === undefined) return undefined;
      const coordinate = parseCellId(first);
      const sides = this.#store.state.grid.type === "square" ? 4 : 6;
      for (let side = 0; side < sides; side += 1) {
        if (
          edgeIdentity(this.#store.state.grid, coordinate, side).edgeId ===
          anchor.edgeId
        )
          return side;
      }
      return undefined;
    }
    return path.startsWith("attributes.")
      ? instance.attributes[path.slice("attributes.".length)]
      : undefined;
  }

  #evaluate(
    condition: ConstraintCondition,
    instance: ModuleRuntimeInstance,
    anchor: AnchorContext,
  ): boolean {
    switch (condition.op) {
      case "all":
        return condition.conditions.every((child) =>
          this.#evaluate(child, instance, anchor),
        );
      case "any":
        return condition.conditions.some((child) =>
          this.#evaluate(child, instance, anchor),
        );
      case "not":
        return !this.#evaluate(condition.condition, instance, anchor);
      case "grid-is":
        return condition.grids.includes(this.#store.state.grid.type);
      case "anchor-is":
        return condition.anchors.includes(anchor.kind);
      case "property-equals":
        return primitiveEqual(
          this.#property(instance, anchor, condition.path),
          condition.value,
        );
      case "property-in": {
        const value = this.#property(instance, anchor, condition.path);
        return condition.values.some((candidate) =>
          primitiveEqual(value, candidate),
        );
      }
      case "number-range": {
        const value = this.#property(instance, anchor, condition.path);
        return (
          typeof value === "number" &&
          value >= condition.min &&
          value <= condition.max
        );
      }
      case "occupancy-count": {
        const count = this.#occupancyCount(anchor, condition.slotId);
        return count >= condition.min && count <= condition.max;
      }
      case "neighbor-count": {
        const count = this.#neighborCount(anchor, condition);
        return count >= condition.min && count <= condition.max;
      }
    }
  }

  #conditionWithinLimits(
    condition: ConstraintCondition,
    maxRadius: number,
    element: ModuleElementDefinition,
  ): boolean {
    const pending: { condition: ConstraintCondition; depth: number }[] = [
      { condition, depth: 1 },
    ];
    let nodes = 0;
    while (pending.length > 0) {
      const current = pending.pop();
      if (current === undefined) break;
      nodes += 1;
      if (nodes > 256 || current.depth > 16) return false;
      if (
        current.condition.op === "neighbor-count" &&
        (current.condition.radius > maxRadius || current.condition.radius > 6)
      )
        return false;
      if (
        (current.condition.op === "property-equals" ||
          current.condition.op === "property-in" ||
          current.condition.op === "number-range") &&
        !this.#propertyPathAllowed(element, current.condition.path)
      )
        return false;
      if (current.condition.op === "all" || current.condition.op === "any") {
        for (const child of current.condition.conditions)
          pending.push({ condition: child, depth: current.depth + 1 });
      } else if (current.condition.op === "not") {
        pending.push({
          condition: current.condition.condition,
          depth: current.depth + 1,
        });
      }
    }
    return true;
  }

  #propertyPathAllowed(
    element: ModuleElementDefinition,
    path: string,
  ): boolean {
    if (
      path === "grid.type" ||
      path === "anchor.kind" ||
      path === "cell.row" ||
      path === "cell.column" ||
      path === "edge.side"
    )
      return true;
    if (!path.startsWith("attributes.")) return false;
    const key = path.slice("attributes.".length);
    return (
      key.length > 0 &&
      !key.includes(".") &&
      Object.prototype.hasOwnProperty.call(
        element.attributeSchema.properties,
        key,
      )
    );
  }
}
