import { assertGridCoordinate, parseCellId } from "./coordinates.js";
import { ConnectionManager } from "./connection-manager.js";
import {
  planFillRegion,
  startFillRegionTask,
  type FillRegionTaskOptions,
} from "./fill-region.js";
import { BackgroundTaskError, type BackgroundTask } from "./background-task.js";
import { cellId } from "./geometry.js";
import {
  domainGroupExtensionsWithLayout,
  domainGroupGeometry,
  normalizedDomainGroupExtensions,
} from "./domain-group.js";
import {
  validateGridSettingsUpdate,
  type GridSettingsInput,
  type GridSettingsUpdateResult,
} from "./grid-settings.js";
import { EdgeManager } from "./edge-manager.js";
import { createFixedLayerMap } from "./layers.js";
import {
  isBuiltInDomainObjectInstance,
  ModuleInstanceStore,
} from "./module-instance-store.js";
import { OverlayManager } from "./overlay-manager.js";
import { configureProjectSpatialIndexes } from "./project-spatial-index.js";
import { normalizeRotationDegrees } from "./rotation.js";
import { SparseChunkStore } from "./sparse-chunk-store.js";
import { ToolStateMachine } from "./tool-state-machine.js";
import type {
  CellOverride,
  ConnectionData,
  ConnectionEndpoint,
  EdgeLike,
  EdgeOverride,
  EdgeStyle,
  EditorTool,
  FixedLayerState,
  MapPoint,
  MarkerStyle,
  NewProjectInput,
  OverlayAnchor,
  OverlayData,
  ProjectState,
  SelectedObject,
} from "./types.js";
import type { ModuleRuntimeInstance } from "./module-instance-store.js";

export interface TextPlacementStyle {
  fontSize: number;
  color: string;
  fontWeight: "normal" | "bold";
  align: "left" | "center" | "right";
  rotation: number;
}

export interface ConnectionPlacementOptions {
  kind: "line" | "arrow";
  arrowMode: "end" | "both";
  label: string | null;
}

export interface EditorOperationRejection {
  readonly code:
    | "layer-locked"
    | "layer-hidden"
    | "layer-module-missing"
    | "layer-unavailable";
  readonly layerId: string;
}

type Listener = () => void;
type ManagerName =
  | "cells"
  | "edges"
  | "connections"
  | "overlays"
  | "module-instances"
  | "layers"
  | "grid"
  | "chunks";

interface Change {
  readonly managers: ReadonlySet<ManagerName>;
  apply(): void;
  revert(): void;
}

interface HistoryEntry extends Change {
  readonly transactionId: string;
}

function newUuid(): string {
  return crypto.randomUUID();
}

function structureEdgeInstanceId(edgeId: string): string {
  return `tessera.structure-edge:${edgeId}`;
}

function cloneEdge(edge: EdgeLike): EdgeOverride {
  return {
    instanceId: edge.instanceId,
    edgeId: edge.edgeId,
    adjacentCellIds: [...edge.adjacentCellIds],
    strokeColor: edge.strokeColor,
    strokeWidth: edge.strokeWidth,
    strokeOpacity: edge.strokeOpacity,
    lineStyle: edge.lineStyle,
    persistence: edge.persistence,
  };
}

function moduleStructureEdgeIds(
  instance: ModuleRuntimeInstance,
): readonly string[] {
  if (instance.kind === "edge") return [instance.edgeId];
  if (instance.kind === "overlay")
    return instance.objectKind === "anchored-overlay" &&
      instance.anchor?.kind === "edge"
      ? [instance.anchor.edgeId]
      : [];
  if (instance.kind !== "connection") return [];
  return [
    ...(instance.start.kind === "edge-midpoint" ? [instance.start.edgeId] : []),
    ...(instance.end.kind === "edge-midpoint" ? [instance.end.edgeId] : []),
  ].filter((edgeId, index, values) => values.indexOf(edgeId) === index);
}

interface ProjectContentSnapshot {
  readonly cells: readonly CellOverride[];
  readonly edges: readonly EdgeOverride[];
  readonly overlays: readonly OverlayData[];
  readonly connections: readonly ConnectionData[];
  readonly moduleInstances: readonly ModuleRuntimeInstance[];
}

function projectContentSnapshot(
  state: Readonly<ProjectState>,
): ProjectContentSnapshot {
  return {
    cells: structuredClone([...state.cells.values()]),
    edges: [...state.edges.values()].map(cloneEdge),
    overlays: structuredClone([...state.overlays.values()]),
    connections: structuredClone([...state.connections.values()]),
    moduleInstances: structuredClone([...state.moduleInstances.values()]),
  };
}

function restoreProjectContent(
  state: ProjectState,
  snapshot: ProjectContentSnapshot,
): void {
  const cells = new SparseChunkStore(snapshot.cells);
  const edges = new EdgeManager(snapshot.edges);
  const overlays = new OverlayManager(snapshot.overlays);
  const connections = new ConnectionManager(snapshot.connections);
  const moduleInstances = new ModuleInstanceStore(snapshot.moduleInstances);
  for (const edge of edges.values()) {
    const ownerCellId = edge.adjacentCellIds[0];
    if (ownerCellId !== undefined) cells.assignEdge(edge.edgeId, ownerCellId);
  }
  for (const overlay of overlays.values()) {
    if (overlay.kind !== "anchored-overlay") continue;
    const ownerCellId =
      overlay.anchor.kind === "cell"
        ? overlay.anchor.cellId
        : edges.get(overlay.anchor.edgeId)?.adjacentCellIds[0];
    if (ownerCellId !== undefined)
      cells.assignOverlay(overlay.overlayId, ownerCellId);
  }
  state.cells = cells;
  state.edges = edges;
  state.overlays = overlays;
  state.connections = connections;
  state.moduleInstances = moduleInstances;
  configureProjectSpatialIndexes(state);
}

function referencedEdgeIds(
  overlays: readonly OverlayData[],
  connections: readonly ConnectionData[],
  moduleInstances: readonly ModuleRuntimeInstance[],
): ReadonlySet<string> {
  const edgeIds = new Set<string>();
  for (const overlay of overlays)
    if (overlay.kind === "anchored-overlay" && overlay.anchor.kind === "edge")
      edgeIds.add(overlay.anchor.edgeId);
  for (const connection of connections)
    for (const endpoint of [connection.start, connection.end])
      if (endpoint.kind === "edge-midpoint") edgeIds.add(endpoint.edgeId);
  for (const instance of moduleInstances)
    for (const edgeId of moduleStructureEdgeIds(instance)) edgeIds.add(edgeId);
  return edgeIds;
}

export function createProject(input: NewProjectInput): ProjectState {
  assertGridCoordinate(input.grid, { row: 0, column: 0 });
  const now = new Date().toISOString();
  const state: ProjectState = {
    projectId: newUuid(),
    name: input.name,
    createdAt: now,
    updatedAt: now,
    grid: { ...input.grid },
    style: { ...input.style },
    cells: new SparseChunkStore(),
    edges: new EdgeManager(),
    connections: new ConnectionManager(),
    overlays: new OverlayManager(),
    moduleInstances: new ModuleInstanceStore(),
    layers: createFixedLayerMap(),
    formatSource: Object.freeze({
      exportScope: "full",
      isComplete: true,
      lineage: null,
      opaqueDocument: null,
    }),
    revision: 0,
    lastTransactionId: null,
  };
  Object.defineProperty(state, "formatSource", {
    value: state.formatSource,
    writable: false,
    configurable: false,
    enumerable: true,
  });
  configureProjectSpatialIndexes(state);
  return state;
}

export class EditorStore {
  readonly #listeners = new Set<Listener>();
  readonly #undo: HistoryEntry[] = [];
  readonly #redo: HistoryEntry[] = [];
  readonly #toolMachine = new ToolStateMachine();
  readonly #selection = new Map<string, SelectedObject>();
  #state: ProjectState;
  #version = 0;
  #batch: { transactionId: string; changes: Change[] } | undefined;
  #operationRejection: EditorOperationRejection | null = null;

  constructor(state: ProjectState) {
    this.#state = state;
  }

  get state(): Readonly<ProjectState> {
    return this.#state;
  }

  get version(): number {
    return this.#version;
  }

  get canUndo(): boolean {
    return this.#undo.length > 0;
  }

  get canRedo(): boolean {
    return this.#redo.length > 0;
  }

  get canClearEditableContent(): boolean {
    const unlocked = (layerId: string) =>
      this.#state.layers.get(layerId)?.locked === false;
    if (
      unlocked("tessera.basic.cell-style") &&
      this.#state.cells.values().next().done === false
    )
      return true;
    if (unlocked("tessera.basic.edge-style"))
      for (const edge of this.#state.edges.values())
        if (edge.persistence === "explicit-style") return true;
    for (const overlay of this.#state.overlays.values())
      if (unlocked(overlay.layerId)) return true;
    for (const connection of this.#state.connections.values())
      if (unlocked(connection.layerId)) return true;
    for (const instance of this.#state.moduleInstances.values())
      if (unlocked(instance.layerId)) return true;
    return false;
  }

  get toolState() {
    return this.#toolMachine.state;
  }

  get selection(): readonly SelectedObject[] {
    return [...this.#selection.values()];
  }

  get operationRejection(): EditorOperationRejection | null {
    return this.#operationRejection;
  }

  clearOperationRejection(): void {
    if (this.#operationRejection === null) return;
    this.#operationRejection = null;
    this.#publish(false);
  }

  subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  replace(state: ProjectState): void {
    this.#state = state;
    this.#undo.length = 0;
    this.#redo.length = 0;
    this.#selection.clear();
    this.#toolMachine.selectTool("select");
    this.#publish(false);
  }

  setTool(tool: EditorTool): void {
    this.#toolMachine.selectTool(tool);
    this.#publish(false);
  }

  cancelTool(): void {
    this.#toolMachine.cancel();
    this.#publish(false);
  }

  updateGridSettings(input: GridSettingsInput): GridSettingsUpdateResult {
    const validation = validateGridSettingsUpdate(this.#state, input);
    if (validation.status === "rejected") return validation;
    const before = { ...this.#state.grid };
    const next = { ...validation.grid };
    if (
      before.width === next.width &&
      before.height === next.height &&
      before.cellSize === next.cellSize
    )
      return { status: "unchanged", grid: before };

    // Manager 的空间索引闭包捕获 state.grid；切换尺寸时重建同一份稀疏事实，
    // 同时让 renderer 通过 cells 身份变化丢弃旧 cellSize 几何缓存。
    const content = projectContentSnapshot(this.#state);
    const replaceGrid = (grid: typeof before): void => {
      this.#state.grid = { ...grid };
      restoreProjectContent(this.#state, content);
    };
    this.#execute({
      managers: new Set([
        "grid",
        "cells",
        "edges",
        "overlays",
        "connections",
        "module-instances",
        "chunks",
      ]),
      apply: () => replaceGrid(next),
      revert: () => replaceGrid(before),
    });
    return { status: "updated", grid: { ...next } };
  }

  resizeMap(width: number, height: number): GridSettingsUpdateResult {
    return this.updateGridSettings({
      width,
      height,
      cellSize: this.#state.grid.cellSize,
    });
  }

  addModuleInstance(
    instance: ModuleRuntimeInstance,
    structuralEdges: readonly {
      readonly edgeId: string;
      readonly adjacentCellIds: readonly string[];
    }[] = [],
  ): string {
    if (instance.kind === "domain-group") {
      const memberCellIds = domainGroupGeometry(
        this.#state.grid,
        instance.memberCellIds,
      ).memberCellIds;
      instance = {
        ...instance,
        memberCellIds,
        extensions: normalizedDomainGroupExtensions(
          this.#state.grid,
          memberCellIds,
          instance.extensions,
        ),
      };
    }
    if (
      instance.elementId.startsWith("tessera.basic:") &&
      !isBuiltInDomainObjectInstance(instance)
    )
      throw new Error(`module-instance-basic-owned:${instance.instanceId}`);
    if (this.#rejectBlockedLayer(instance.layerId)) return "";
    const layer = this.#state.layers.get(instance.layerId);
    if (layer === undefined || !layer.allowedKinds.includes(instance.kind))
      throw new Error(`module-instance-kind-not-allowed:${instance.kind}`);
    if (
      this.#state.cells.getByInstanceId(instance.instanceId) !== undefined ||
      this.#state.edges.getByInstanceId(instance.instanceId) !== undefined ||
      this.#state.overlays.get(instance.instanceId) !== undefined ||
      this.#state.connections.get(instance.instanceId) !== undefined
    )
      throw new Error(
        `module-instance-basic-id-conflict:${instance.instanceId}`,
      );
    if (this.#state.moduleInstances.get(instance.instanceId) !== undefined)
      throw new Error(`module-instance-duplicate:${instance.instanceId}`);
    const edgeById = new Map(
      structuralEdges.map((edge) => [edge.edgeId, edge]),
    );
    if (instance.kind === "edge")
      edgeById.set(instance.edgeId, {
        edgeId: instance.edgeId,
        adjacentCellIds: instance.adjacentCellIds,
      });
    const requiredEdgeIds = moduleStructureEdgeIds(instance);
    for (const edgeId of requiredEdgeIds) {
      const edge = edgeById.get(edgeId) ?? this.#state.edges.get(edgeId);
      if (edge === undefined)
        throw new Error(`module-instance-edge-structure-missing:${edgeId}`);
      const existing = this.#state.edges.get(edgeId);
      if (
        existing !== undefined &&
        existing.adjacentCellIds.join("|") !== edge.adjacentCellIds.join("|")
      )
        throw new Error(`edge-structure-adjacency-conflict:${edgeId}`);
      edgeById.set(edgeId, edge);
    }
    const createdEdges = new Map(
      requiredEdgeIds.flatMap((edgeId) => {
        if (this.#state.edges.get(edgeId) !== undefined) return [];
        const edge = edgeById.get(edgeId);
        if (edge === undefined)
          throw new Error(`module-instance-edge-structure-missing:${edgeId}`);
        return [
          [
            edgeId,
            {
              instanceId: structureEdgeInstanceId(edgeId),
              edgeId,
              adjacentCellIds: [...edge.adjacentCellIds],
              strokeColor: this.#state.style.defaultEdgeColor,
              strokeWidth: Math.max(1, this.#state.style.gridWidth),
              strokeOpacity: 1,
              lineStyle: "solid" as const,
              persistence: "reference-only" as const,
            },
          ] as const,
        ];
      }),
    );
    this.#execute({
      managers: new Set([
        "module-instances",
        "chunks",
        ...(requiredEdgeIds.length > 0 ? (["edges"] as const) : []),
      ]),
      apply: () => {
        for (const edge of createdEdges.values())
          this.#state.edges.ensure(edge);
        this.#state.moduleInstances.add(instance);
        this.#invalidateModuleInstanceCarrier(instance);
      },
      revert: () => {
        this.#state.moduleInstances.delete(instance.instanceId);
        for (const edgeId of createdEdges.keys())
          if (!this.#edgeHasReference(edgeId)) this.#state.edges.delete(edgeId);
        this.#invalidateModuleInstanceCarrier(instance);
      },
    });
    return instance.instanceId;
  }

  updateModuleInstance(
    instanceId: string,
    patch: Readonly<{
      attributes?: ModuleRuntimeInstance["attributes"];
      styleOverrides?: ModuleRuntimeInstance["styleOverrides"];
      label?: string | null;
    }>,
  ): void {
    const previous = this.#state.moduleInstances.get(instanceId);
    if (previous === undefined)
      throw new Error(`module-instance-not-found:${instanceId}`);
    if (previous.runtimeStatus === "missing") {
      this.#operationRejection = {
        code: "layer-module-missing",
        layerId: previous.layerId,
      };
      this.#publish(false);
      return;
    }
    if (this.#rejectBlockedLayer(previous.layerId)) return;
    if (patch.label !== undefined && previous.kind !== "connection")
      throw new Error(`module-instance-label-unsupported:${instanceId}`);
    const next = {
      ...previous,
      ...(patch.attributes === undefined
        ? {}
        : { attributes: structuredClone(patch.attributes) }),
      ...(patch.styleOverrides === undefined
        ? {}
        : { styleOverrides: structuredClone(patch.styleOverrides) }),
      ...(patch.label === undefined ? {} : { label: patch.label }),
    } as ModuleRuntimeInstance;
    this.#execute({
      managers: new Set(["module-instances", "chunks"]),
      apply: () => {
        this.#state.moduleInstances.replace(next);
        this.#invalidateModuleInstanceCarrier(next);
      },
      revert: () => {
        this.#state.moduleInstances.replace(previous);
        this.#invalidateModuleInstanceCarrier(previous);
      },
    });
  }

  updateDomainGroupMembers(
    instanceId: string,
    memberCellIds: readonly string[],
  ): void {
    const previous = this.#state.moduleInstances.get(instanceId);
    if (previous === undefined)
      throw new Error(`module-instance-not-found:${instanceId}`);
    if (previous.kind !== "domain-group")
      throw new Error(`module-instance-domain-group-required:${instanceId}`);
    if (previous.runtimeStatus === "missing") {
      this.#operationRejection = {
        code: "layer-module-missing",
        layerId: previous.layerId,
      };
      this.#publish(false);
      return;
    }
    if (this.#rejectBlockedLayer(previous.layerId)) return;
    const next = {
      ...previous,
      memberCellIds: domainGroupGeometry(this.#state.grid, memberCellIds)
        .memberCellIds,
      extensions: domainGroupExtensionsWithLayout(
        this.#state.grid,
        memberCellIds,
        previous.extensions,
      ),
    };
    this.#execute({
      managers: new Set(["module-instances", "chunks"]),
      apply: () => {
        this.#state.moduleInstances.replace(next);
        // 成员集合可跨分块移动，旧、新占用分块都必须在同一事务中失效。
        this.#invalidateModuleInstanceCarrier(previous);
        this.#invalidateModuleInstanceCarrier(next);
      },
      revert: () => {
        this.#state.moduleInstances.replace(previous);
        this.#invalidateModuleInstanceCarrier(next);
        this.#invalidateModuleInstanceCarrier(previous);
      },
    });
  }

  deleteModuleInstance(instanceId: string): boolean {
    const previous = this.#state.moduleInstances.get(instanceId);
    if (previous === undefined) return false;
    if (this.#rejectBlockedLayer(previous.layerId)) return false;
    const previousStructures = new Map(
      moduleStructureEdgeIds(previous).map((edgeId) => {
        const structure = this.#state.edges.get(edgeId);
        if (structure === undefined)
          throw new Error(`module-instance-edge-structure-missing:${edgeId}`);
        return [edgeId, structure] as const;
      }),
    );
    this.#execute({
      managers: new Set([
        "module-instances",
        "chunks",
        ...(previousStructures.size > 0 ? (["edges"] as const) : []),
      ]),
      apply: () => {
        this.#state.moduleInstances.delete(instanceId);
        for (const edgeId of previousStructures.keys()) {
          const edge = this.#state.edges.get(edgeId);
          if (
            edge?.persistence === "reference-only" &&
            !this.#edgeHasReference(edgeId)
          )
            this.#state.edges.delete(edgeId);
        }
        this.#invalidateModuleInstanceCarrier(previous);
      },
      revert: () => {
        for (const edge of previousStructures.values())
          this.#state.edges.ensure(cloneEdge(edge));
        this.#state.moduleInstances.add(previous);
        this.#invalidateModuleInstanceCarrier(previous);
      },
    });
    return true;
  }

  pointerDown(point: MapPoint, targetCellId: string | null): void {
    if (this.#toolMachine.pointerDown(point, targetCellId))
      this.#publish(false);
  }

  pointerMove(point: MapPoint): void {
    if (this.#toolMachine.pointerMove(point)) this.#publish(false);
  }

  pointerUp(point: MapPoint): void {
    if (this.#toolMachine.pointerUp(point)) this.#publish(false);
  }

  /** 清除所有未锁定图层中的持久化编辑内容，并作为一个事务记录。 */
  clearEditableContent(): boolean {
    if (!this.canClearEditableContent) return false;
    const before = projectContentSnapshot(this.#state);
    const unlocked = (layerId: string) =>
      this.#state.layers.get(layerId)?.locked === false;
    const cells = unlocked("tessera.basic.cell-style") ? [] : before.cells;
    const overlays = before.overlays.filter(
      (overlay) => !unlocked(overlay.layerId),
    );
    const connections = before.connections.filter(
      (connection) => !unlocked(connection.layerId),
    );
    const moduleInstances = before.moduleInstances.filter(
      (instance) => !unlocked(instance.layerId),
    );
    const edgeReferences = referencedEdgeIds(
      overlays,
      connections,
      moduleInstances,
    );
    const clearEdges = unlocked("tessera.basic.edge-style");
    const edges = before.edges.flatMap((edge): EdgeOverride[] => {
      if (edge.persistence === "reference-only")
        return edgeReferences.has(edge.edgeId) ? [edge] : [];
      if (!clearEdges) return [edge];
      if (!edgeReferences.has(edge.edgeId)) return [];
      return [
        {
          ...edge,
          instanceId: structureEdgeInstanceId(edge.edgeId),
          persistence: "reference-only",
        },
      ];
    });
    const after: ProjectContentSnapshot = {
      cells,
      edges,
      overlays,
      connections,
      moduleInstances,
    };
    this.#selection.clear();
    this.#execute({
      managers: new Set([
        "cells",
        "edges",
        "overlays",
        "connections",
        "module-instances",
        "chunks",
      ]),
      apply: () => restoreProjectContent(this.#state, after),
      revert: () => restoreProjectContent(this.#state, before),
    });
    return true;
  }

  paintCell(row: number, column: number, fillColor: string): void {
    try {
      assertGridCoordinate(this.#state.grid, { row, column });
    } catch (error) {
      this.cancelBatch();
      throw error;
    }
    if (this.#rejectBlockedLayer("tessera.basic.cell-style")) return;
    const id = cellId(this.#state.grid.type, row, column);
    const previous = this.#state.cells.get(id);
    if (previous?.fillColor === fillColor) return;
    const next: CellOverride = {
      instanceId: previous?.instanceId ?? newUuid(),
      cellId: id,
      row,
      column,
      fillColor,
      fillOpacity: previous?.fillOpacity ?? 1,
      ...(previous?.label === undefined ? {} : { label: previous.label }),
    };
    this.#execute({
      managers: new Set(["cells", "chunks"]),
      apply: () => this.#state.cells.set(id, next),
      revert: () =>
        previous === undefined
          ? this.#state.cells.delete(id)
          : this.#state.cells.set(id, previous),
    });
  }

  eraseCell(row: number, column: number): void {
    const id = cellId(this.#state.grid.type, row, column);
    const previous = this.#state.cells.get(id);
    if (this.#rejectBlockedLayer("tessera.basic.cell-style")) return;
    if (previous === undefined) return;
    this.#execute({
      managers: new Set(["cells", "chunks"]),
      apply: () => void this.#state.cells.delete(id),
      revert: () => void this.#state.cells.set(id, previous),
    });
  }

  fillCells(
    row: number,
    column: number,
    fillColor: string,
    limit = 10_000,
  ): number {
    assertGridCoordinate(this.#state.grid, { row, column });
    if (this.#rejectBlockedLayer("tessera.basic.cell-style")) return 0;
    const matched = planFillRegion(this.#state, row, column, fillColor, limit);
    this.#commitFillPlan(matched, fillColor);
    return matched.length;
  }

  startFillCells(
    row: number,
    column: number,
    fillColor: string,
    options: FillRegionTaskOptions = {},
  ): BackgroundTask<number> {
    assertGridCoordinate(this.#state.grid, { row, column });
    if (this.#rejectBlockedLayer("tessera.basic.cell-style")) {
      const empty = startFillRegionTask(
        this.#state,
        row,
        column,
        this.#state.cells.get(cellId(this.#state.grid.type, row, column))
          ?.fillColor ?? this.#state.style.defaultCellColor,
        options,
      );
      return { ...empty, result: empty.result.then(() => 0) };
    }
    const stateAtStart = this.#state;
    const revisionAtStart = this.#state.revision;
    const planning = startFillRegionTask(
      this.#state,
      row,
      column,
      fillColor,
      options,
    );
    return {
      taskId: planning.taskId,
      subscribeProgress: planning.subscribeProgress,
      cancel: planning.cancel,
      result: planning.result.then((matched) => {
        if (
          this.#state !== stateAtStart ||
          this.#state.revision !== revisionAtStart
        ) {
          throw new BackgroundTaskError(
            "batch-state-changed",
            { revisionAtStart, revisionNow: this.#state.revision },
            "retry",
          );
        }
        this.#commitFillPlan(matched, fillColor);
        return matched.length;
      }),
    };
  }

  paintEdge(
    edgeId: string,
    adjacentCellIds: readonly string[],
    strokeColor: string,
  ): void {
    if (this.#rejectBlockedLayer("tessera.basic.edge-style")) return;
    const previous = this.#state.edges.get(edgeId);
    if (
      previous?.strokeColor === strokeColor &&
      previous.persistence === "explicit-style"
    )
      return;
    const width = Math.max(2, this.#state.style.gridWidth * 2);
    const next: EdgeOverride =
      previous === undefined
        ? {
            instanceId: newUuid(),
            edgeId,
            adjacentCellIds: [...adjacentCellIds],
            strokeColor,
            strokeWidth: width,
            strokeOpacity: 1,
            lineStyle: "solid",
            persistence: "explicit-style",
          }
        : {
            ...cloneEdge(previous),
            instanceId:
              previous.persistence === "reference-only"
                ? newUuid()
                : previous.instanceId,
            strokeColor,
            strokeWidth: width,
            persistence: "explicit-style",
          };
    const ownerCellId = adjacentCellIds[0];
    if (ownerCellId === undefined) throw new Error("edge-owner-missing");
    const before = previous === undefined ? undefined : cloneEdge(previous);
    this.#execute({
      managers: new Set(["edges", "chunks"]),
      apply: () => {
        if (before === undefined) {
          this.#state.edges.ensure(next);
          this.#state.cells.assignEdge(edgeId, ownerCellId);
        } else {
          this.#state.edges.replace(next);
          this.#state.cells.invalidateRuntimeChunkForCell(ownerCellId);
        }
      },
      revert: () => {
        if (before === undefined) {
          this.#state.edges.delete(edgeId);
          this.#state.cells.unassignEdge(edgeId, ownerCellId);
        } else {
          this.#state.edges.replace(before);
          this.#state.cells.invalidateRuntimeChunkForCell(ownerCellId);
        }
      },
    });
  }

  updateEdgeStyle(edgeId: string, style: EdgeStyle): void {
    const previous = this.#state.edges.get(edgeId);
    if (previous === undefined) throw new Error(`edge-not-found:${edgeId}`);
    if (this.#rejectBlockedLayer("tessera.basic.edge-style")) return;
    const before = cloneEdge(previous);
    const ownerCellId = before.adjacentCellIds[0];
    if (ownerCellId === undefined) throw new Error("edge-owner-missing");
    const next: EdgeOverride = {
      ...before,
      ...style,
      instanceId:
        before.persistence === "reference-only" ? newUuid() : before.instanceId,
      persistence: "explicit-style",
    };
    this.#execute({
      managers: new Set(["edges", "chunks"]),
      apply: () => {
        this.#state.edges.replace(next);
        // 边几何由 owner 分块批次绘制，样式变化必须精准推进该分块 revision。
        this.#state.cells.invalidateRuntimeChunkForCell(ownerCellId);
      },
      revert: () => {
        this.#state.edges.replace(before);
        this.#state.cells.invalidateRuntimeChunkForCell(ownerCellId);
      },
    });
  }

  placeMarker(
    anchor: OverlayAnchor | MapPoint,
    color = "#D9B866FF",
    markerShape: MarkerStyle["markerShape"] = "pin",
    label: string | null = null,
  ): string {
    if (this.#rejectBlockedLayer("tessera.basic.placed-object")) return "";
    const overlayId = newUuid();
    const overlay: OverlayData =
      "kind" in anchor
        ? {
            kind: "anchored-overlay",
            overlayId,
            elementId: "tessera.basic:marker",
            layerId: "tessera.basic.placed-object",
            overlayType: "marker",
            anchor,
            orderInLayer: 0,
            style: {
              size: this.#state.grid.cellSize * 0.45,
              rotation: 0,
              opacity: 1,
              color,
              markerShape,
            },
            label,
            text: null,
          }
        : {
            kind: "free-overlay",
            overlayId,
            elementId: "tessera.basic:marker",
            layerId: "tessera.basic.placed-object",
            overlayType: "marker",
            point: anchor,
            orderInLayer: 0,
            style: {
              size: this.#state.grid.cellSize * 0.45,
              rotation: 0,
              opacity: 1,
              color,
              markerShape,
            },
            label,
            text: null,
          };
    const ownerCellId =
      overlay.kind === "anchored-overlay"
        ? this.#overlayOwnerCellId(overlay.anchor)
        : null;
    this.#executeTransaction([
      {
        managers: new Set(["overlays"]),
        apply: () => void this.#state.overlays.add(overlay),
        revert: () => void this.#state.overlays.delete(overlayId),
      },
      ...(ownerCellId === null
        ? []
        : [
            {
              managers: new Set<ManagerName>(["chunks"]),
              apply: () =>
                this.#state.cells.assignOverlay(overlayId, ownerCellId),
              revert: () =>
                this.#state.cells.unassignOverlay(overlayId, ownerCellId),
            },
          ]),
    ]);
    return overlayId;
  }

  placeText(
    anchor: OverlayAnchor | MapPoint,
    text: string,
    style: Partial<TextPlacementStyle> = {},
  ): string {
    if (this.#rejectBlockedLayer("tessera.basic.annotation")) return "";
    const overlayId = newUuid();
    const base = {
      overlayId,
      elementId: "tessera.basic:text" as const,
      layerId: "tessera.basic.annotation" as const,
      overlayType: "text" as const,
      orderInLayer: 0,
      style: {
        fontSize: style.fontSize ?? this.#state.grid.cellSize * 0.5,
        rotation: normalizeRotationDegrees(style.rotation ?? 0),
        opacity: 1,
        color: style.color ?? "#F4EFE4FF",
        fontWeight: style.fontWeight ?? ("normal" as const),
        align: style.align ?? ("center" as const),
        backgroundVisible: false,
      },
      text,
    };
    const overlay: OverlayData =
      "kind" in anchor
        ? { ...base, kind: "anchored-overlay", anchor }
        : { ...base, kind: "free-overlay", point: anchor };
    const ownerCellId =
      overlay.kind === "anchored-overlay"
        ? this.#overlayOwnerCellId(overlay.anchor)
        : null;
    this.#executeTransaction([
      {
        managers: new Set(["overlays"]),
        apply: () => void this.#state.overlays.add(overlay),
        revert: () => void this.#state.overlays.delete(overlayId),
      },
      ...(ownerCellId === null
        ? []
        : [
            {
              managers: new Set<ManagerName>(["chunks"]),
              apply: () =>
                this.#state.cells.assignOverlay(overlayId, ownerCellId),
              revert: () =>
                this.#state.cells.unassignOverlay(overlayId, ownerCellId),
            },
          ]),
    ]);
    return overlayId;
  }

  placeEdgeText(
    edge: EdgeOverride,
    text: string,
    style: Partial<TextPlacementStyle> = {},
  ): string {
    return this.#placeEdgeOverlay(edge, "text", text, style);
  }

  placeEdgeMarker(
    edge: EdgeOverride,
    color = "#D9B866FF",
    markerShape: MarkerStyle["markerShape"] = "diamond",
    label: string | null = null,
  ): string {
    return this.#placeEdgeOverlay(edge, "marker", label, {
      color,
      markerShape,
    });
  }

  #placeEdgeOverlay(
    edge: EdgeOverride,
    overlayType: "marker" | "text",
    text: string | null,
    style: Partial<TextPlacementStyle> &
      Partial<Pick<MarkerStyle, "color" | "markerShape">>,
  ): string {
    const layerId =
      overlayType === "marker"
        ? "tessera.basic.placed-object"
        : "tessera.basic.annotation";
    if (this.#rejectBlockedLayer(layerId)) return "";
    const existing = this.#state.edges.get(edge.edgeId);
    const edgeData: EdgeOverride = {
      ...edge,
      persistence: existing?.persistence ?? "reference-only",
    };
    const overlayId = newUuid();
    const common = {
      kind: "anchored-overlay" as const,
      overlayId,
      anchor: { kind: "edge" as const, edgeId: edge.edgeId },
      orderInLayer: 0,
    };
    const overlay: OverlayData =
      overlayType === "marker"
        ? {
            ...common,
            elementId: "tessera.basic:marker",
            layerId: "tessera.basic.placed-object",
            overlayType,
            style: {
              size: this.#state.grid.cellSize * 0.35,
              rotation: 0,
              opacity: 1,
              color: style.color ?? "#D9B866FF",
              markerShape: style.markerShape ?? "diamond",
            },
            label: text,
            text: null,
          }
        : {
            ...common,
            elementId: "tessera.basic:text",
            layerId: "tessera.basic.annotation",
            overlayType,
            style: {
              fontSize: style.fontSize ?? this.#state.grid.cellSize * 0.5,
              rotation: normalizeRotationDegrees(style.rotation ?? 0),
              opacity: 1,
              color: style.color ?? "#F4EFE4FF",
              fontWeight: style.fontWeight ?? "normal",
              align: style.align ?? "center",
              backgroundVisible: false,
            },
            text: text ?? "",
          };
    const ownerCellId = edge.adjacentCellIds[0];
    if (ownerCellId === undefined) throw new Error("edge-owner-missing");
    this.#executeTransaction([
      {
        managers: new Set(["edges"]),
        apply: () => void this.#state.edges.ensure(edgeData),
        revert: () => {
          if (existing === undefined) this.#state.edges.delete(edge.edgeId);
        },
      },
      {
        managers: new Set(["overlays"]),
        apply: () => void this.#state.overlays.add(overlay),
        revert: () => void this.#state.overlays.delete(overlayId),
      },
      {
        managers: new Set(["chunks"]),
        apply: () => this.#state.cells.assignEdge(edge.edgeId, ownerCellId),
        revert: () => this.#state.cells.unassignEdge(edge.edgeId, ownerCellId),
      },
      {
        managers: new Set(["chunks"]),
        apply: () => this.#state.cells.assignOverlay(overlayId, ownerCellId),
        revert: () => this.#state.cells.unassignOverlay(overlayId, ownerCellId),
      },
    ]);
    return overlayId;
  }

  createConnection(
    start: ConnectionEndpoint,
    end: ConnectionEndpoint,
    options: Partial<ConnectionPlacementOptions> | "line" | "arrow" = {},
  ): string {
    if (this.#rejectBlockedLayer("tessera.basic.connection")) return "";
    const placement = typeof options === "string" ? { kind: options } : options;
    const connectionId = newUuid();
    const base = {
      connectionId,
      layerId: "tessera.basic.connection" as const,
      start,
      end,
      style: {
        strokeColor: "#73B7C8FF",
        strokeWidth: 3,
        strokeOpacity: 1,
        lineStyle: "solid" as const,
      },
      label: placement.label ?? null,
    };
    const kind = placement.kind ?? "arrow";
    const connection: ConnectionData =
      kind === "arrow"
        ? {
            ...base,
            kind,
            elementId: "tessera.basic:connection.arrow",
            arrowStart: placement.arrowMode === "both",
            arrowEnd: true,
          }
        : { ...base, kind, elementId: "tessera.basic:connection.line" };
    this.#execute({
      managers: new Set(["connections"]),
      apply: () => void this.#state.connections.add(connection),
      revert: () => void this.#state.connections.delete(connectionId),
    });
    return connectionId;
  }

  updateOverlay(overlayId: string, next: OverlayData): void {
    const previous = this.#state.overlays.get(overlayId);
    if (previous === undefined || next.overlayId !== overlayId)
      throw new Error(`overlay-not-found:${overlayId}`);
    if (this.#rejectBlockedLayer(previous.layerId)) return;
    const normalized = {
      ...next,
      style: {
        ...next.style,
        rotation: normalizeRotationDegrees(next.style.rotation),
      },
    } as OverlayData;
    this.#execute({
      managers: new Set(["overlays"]),
      apply: () => void this.#state.overlays.replace(normalized),
      revert: () => void this.#state.overlays.replace(previous),
    });
  }

  updateConnection(connectionId: string, next: ConnectionData): void {
    const previous = this.#state.connections.get(connectionId);
    if (previous === undefined || next.connectionId !== connectionId)
      throw new Error(`connection-not-found:${connectionId}`);
    if (this.#rejectBlockedLayer(previous.layerId)) return;
    this.#execute({
      managers: new Set(["connections"]),
      apply: () => void this.#state.connections.replace(next),
      revert: () => void this.#state.connections.replace(previous),
    });
  }

  reverseConnection(connectionId: string): boolean {
    const previous = this.#state.connections.get(connectionId);
    if (previous === undefined)
      throw new Error(`connection-not-found:${connectionId}`);
    if (this.#rejectBlockedLayer(previous.layerId)) return false;
    const next: ConnectionData =
      previous.kind === "arrow"
        ? {
            ...previous,
            start: previous.end,
            end: previous.start,
            arrowStart: previous.arrowEnd,
            arrowEnd: previous.arrowStart,
          }
        : { ...previous, start: previous.end, end: previous.start };
    this.#execute({
      managers: new Set(["connections"]),
      apply: () => void this.#state.connections.replace(next),
      revert: () => void this.#state.connections.replace(previous),
    });
    return true;
  }

  rebindConnectionCellEndpoint(
    connectionId: string,
    endpoint: "start" | "end",
    targetCellId: string,
  ): boolean {
    const previous = this.#state.connections.get(connectionId);
    if (previous === undefined)
      throw new Error(`connection-not-found:${connectionId}`);
    if (this.#rejectBlockedLayer(previous.layerId)) return false;
    const coordinate = parseCellId(targetCellId);
    if (coordinate.gridType !== this.#state.grid.type) {
      throw new RangeError("connection-cell-grid-mismatch");
    }
    assertGridCoordinate(this.#state.grid, coordinate);
    const replacement = { kind: "cell-center" as const, cellId: targetCellId };
    const other = endpoint === "start" ? previous.end : previous.start;
    if (other.kind === "cell-center" && other.cellId === targetCellId) {
      throw new Error("connection-self-not-allowed");
    }
    const next = { ...previous, [endpoint]: replacement } as ConnectionData;
    this.#execute({
      managers: new Set(["connections"]),
      apply: () => void this.#state.connections.replace(next),
      revert: () => void this.#state.connections.replace(previous),
    });
    return true;
  }

  deleteSelection(): void {
    this.#deleteObjects([...this.#selection.values()], true);
  }

  /** 按命中顺序跳过锁定对象，只删除首个可编辑的真实持久对象。 */
  eraseFirstEditable(
    candidates: readonly SelectedObject[],
  ): SelectedObject | null {
    let firstBlockedLayerId: string | undefined;
    for (const candidate of candidates) {
      if (!this.#selectedObjectExists(candidate)) continue;
      const layerId = this.#selectedObjectLayerId(candidate);
      if (layerId === undefined) continue;
      const layer = this.#state.layers.get(layerId);
      if (
        layer === undefined ||
        layer.runtimeStatus === "missing" ||
        layer.locked ||
        !layer.visible
      ) {
        firstBlockedLayerId ??= layerId;
        continue;
      }
      this.#deleteObjects([candidate], false);
      return candidate;
    }
    if (firstBlockedLayerId !== undefined)
      this.#rejectBlockedLayer(firstBlockedLayerId);
    return null;
  }

  #selectedObjectLayerId(selected: SelectedObject): string | undefined {
    if (selected.kind === "cell") return "tessera.basic.cell-style";
    if (selected.kind === "edge") return "tessera.basic.edge-style";
    if (selected.kind === "connection") return "tessera.basic.connection";
    if (selected.kind === "module-instance")
      return this.#state.moduleInstances.get(selected.id)?.layerId;
    return this.#state.overlays.get(selected.id)?.layerId;
  }

  #selectedObjectExists(selected: SelectedObject): boolean {
    if (selected.kind === "cell")
      return this.#state.cells.get(selected.id) !== undefined;
    if (selected.kind === "edge")
      return (
        this.#state.edges.get(selected.id)?.persistence === "explicit-style"
      );
    if (selected.kind === "overlay")
      return this.#state.overlays.get(selected.id) !== undefined;
    if (selected.kind === "connection")
      return this.#state.connections.get(selected.id) !== undefined;
    return this.#state.moduleInstances.get(selected.id) !== undefined;
  }

  #deleteObjects(
    objects: readonly SelectedObject[],
    clearSelection: boolean,
  ): void {
    for (const selected of objects) {
      const layerId = this.#selectedObjectLayerId(selected);
      if (layerId !== undefined && this.#rejectBlockedLayer(layerId)) return;
    }
    const ownsBatch = this.#batch === undefined;
    if (ownsBatch) this.beginBatch();
    try {
      for (const selected of objects) {
        if (selected.kind === "module-instance") {
          this.deleteModuleInstance(selected.id);
        } else if (selected.kind === "cell") {
          const coordinate = parseCellId(selected.id);
          this.eraseCell(coordinate.row, coordinate.column);
        } else if (selected.kind === "edge") {
          const edge = this.#state.edges.get(selected.id);
          if (edge === undefined) continue;
          const snapshot = cloneEdge(edge);
          const ownerCellId = edge.adjacentCellIds[0];
          if (ownerCellId === undefined) throw new Error("edge-owner-missing");
          const retainStructure = this.#edgeHasReference(selected.id);
          const structure: EdgeOverride = {
            ...snapshot,
            instanceId: structureEdgeInstanceId(selected.id),
            persistence: "reference-only",
          };
          this.#execute({
            managers: new Set(["edges", "chunks"]),
            apply: () => {
              if (retainStructure) {
                this.#state.edges.replace(structure);
                this.#state.cells.invalidateRuntimeChunkForCell(ownerCellId);
              } else {
                this.#state.edges.delete(selected.id);
                this.#state.cells.unassignEdge(selected.id, ownerCellId);
              }
            },
            revert: () => {
              if (retainStructure) {
                this.#state.edges.replace(snapshot);
                this.#state.cells.invalidateRuntimeChunkForCell(ownerCellId);
              } else {
                this.#state.edges.ensure(snapshot);
                this.#state.cells.assignEdge(selected.id, ownerCellId);
              }
            },
          });
        } else if (selected.kind === "overlay") {
          const overlay = this.#state.overlays.get(selected.id);
          if (overlay === undefined) continue;
          const ownerCellId =
            overlay.kind === "anchored-overlay"
              ? this.#overlayOwnerCellId(overlay.anchor)
              : null;
          const referencedEdge =
            overlay.kind === "anchored-overlay" &&
            overlay.anchor.kind === "edge"
              ? this.#state.edges.get(overlay.anchor.edgeId)
              : undefined;
          const hasOtherReference =
            referencedEdge === undefined
              ? true
              : this.#state.overlays.hasEdgeReference(
                  referencedEdge.edgeId,
                  overlay.overlayId,
                ) ||
                this.#state.connections.hasEdgeReference(
                  referencedEdge.edgeId,
                ) ||
                this.#state.moduleInstances.hasEdgeReference(
                  referencedEdge.edgeId,
                );
          const recycleEdge =
            referencedEdge !== undefined &&
            referencedEdge.persistence === "reference-only" &&
            !hasOtherReference;
          const edgeSnapshot =
            referencedEdge === undefined
              ? undefined
              : cloneEdge(referencedEdge);
          this.#executeTransaction([
            {
              managers: new Set(["overlays"]),
              apply: () => void this.#state.overlays.delete(selected.id),
              revert: () => void this.#state.overlays.add(overlay),
            },
            ...(ownerCellId === null
              ? []
              : [
                  {
                    managers: new Set<ManagerName>(["chunks"]),
                    apply: () =>
                      this.#state.cells.unassignOverlay(
                        selected.id,
                        ownerCellId,
                      ),
                    revert: () =>
                      this.#state.cells.assignOverlay(selected.id, ownerCellId),
                  },
                ]),
            ...(recycleEdge &&
            edgeSnapshot !== undefined &&
            ownerCellId !== null
              ? [
                  {
                    managers: new Set<ManagerName>(["edges"]),
                    apply: () =>
                      void this.#state.edges.delete(edgeSnapshot.edgeId),
                    revert: () => void this.#state.edges.ensure(edgeSnapshot),
                  },
                  {
                    managers: new Set<ManagerName>(["chunks"]),
                    apply: () =>
                      this.#state.cells.unassignEdge(
                        edgeSnapshot.edgeId,
                        ownerCellId,
                      ),
                    revert: () =>
                      this.#state.cells.assignEdge(
                        edgeSnapshot.edgeId,
                        ownerCellId,
                      ),
                  },
                ]
              : []),
          ]);
        } else {
          const connection = this.#state.connections.get(selected.id);
          if (connection === undefined) continue;
          const edgeIds = new Set(
            [connection.start, connection.end]
              .filter((endpoint) => endpoint.kind === "edge-midpoint")
              .map((endpoint) => endpoint.edgeId),
          );
          const recyclable = [...edgeIds]
            .map((edgeId) => this.#state.edges.get(edgeId))
            .filter((edge): edge is EdgeLike => {
              if (edge === undefined || edge.persistence !== "reference-only")
                return false;
              return (
                !this.#state.overlays.hasEdgeReference(edge.edgeId) &&
                !this.#state.connections.hasEdgeReference(
                  edge.edgeId,
                  connection.connectionId,
                ) &&
                !this.#state.moduleInstances.hasEdgeReference(edge.edgeId)
              );
            })
            .map(cloneEdge);
          this.#executeTransaction([
            {
              managers: new Set(["connections"]),
              apply: () => void this.#state.connections.delete(selected.id),
              revert: () => void this.#state.connections.add(connection),
            },
            ...recyclable.flatMap((edge): Change[] => {
              const ownerCellId = edge.adjacentCellIds[0];
              if (ownerCellId === undefined)
                throw new Error("edge-owner-missing");
              return [
                {
                  managers: new Set(["chunks"]),
                  apply: () =>
                    this.#state.cells.unassignEdge(edge.edgeId, ownerCellId),
                  revert: () =>
                    this.#state.cells.assignEdge(edge.edgeId, ownerCellId),
                },
                {
                  managers: new Set(["edges"]),
                  apply: () => void this.#state.edges.delete(edge.edgeId),
                  revert: () => void this.#state.edges.ensure(edge),
                },
              ];
            }),
          ]);
        }
      }
      if (clearSelection) this.#selection.clear();
      else
        for (const selected of objects)
          this.#selection.delete(`${selected.kind}:${selected.id}`);
      if (ownsBatch) this.commitBatch();
      if (clearSelection) this.#publish(false);
    } catch (error) {
      if (ownsBatch) this.cancelBatch();
      throw error;
    }
  }

  commitConnection(
    start: ConnectionEndpoint,
    end: ConnectionEndpoint,
    options: Partial<ConnectionPlacementOptions> = {},
    edgeReferences: readonly Pick<
      EdgeOverride,
      "edgeId" | "adjacentCellIds"
    >[] = [],
  ): string {
    if (this.#toolMachine.state.phase !== "committing") {
      throw new Error("connection-not-ready-to-commit");
    }
    if (this.#rejectBlockedLayer("tessera.basic.connection")) {
      this.#toolMachine.commitFailed();
      this.#publish(false);
      return "";
    }
    try {
      this.beginBatch();
      for (const edge of edgeReferences) {
        if (this.#state.edges.get(edge.edgeId) !== undefined) continue;
        const ownerCellId = edge.adjacentCellIds[0];
        if (ownerCellId === undefined) throw new Error("edge-owner-missing");
        const data: EdgeOverride = {
          instanceId: newUuid(),
          ...edge,
          strokeColor: this.#state.style.defaultEdgeColor,
          strokeWidth: Math.max(2, this.#state.style.gridWidth * 2),
          strokeOpacity: 1,
          lineStyle: "solid",
          persistence: "reference-only",
        };
        this.#executeTransaction([
          {
            managers: new Set(["edges"]),
            apply: () => void this.#state.edges.ensure(data),
            revert: () => void this.#state.edges.delete(data.edgeId),
          },
          {
            managers: new Set(["chunks"]),
            apply: () => this.#state.cells.assignEdge(data.edgeId, ownerCellId),
            revert: () =>
              this.#state.cells.unassignEdge(data.edgeId, ownerCellId),
          },
        ]);
      }
      const id = this.createConnection(start, end, options);
      this.commitBatch();
      this.#toolMachine.commitSucceeded();
      this.#publish(false);
      return id;
    } catch (error) {
      this.cancelBatch();
      this.#toolMachine.commitFailed();
      this.#publish(false);
      throw error;
    }
  }

  /** 让扩展模块连接复用基础连接相同的状态机提交边界。 */
  commitExternalConnection(create: () => string): string {
    if (this.#toolMachine.state.phase !== "committing")
      throw new Error("connection-not-ready-to-commit");
    try {
      const instanceId = create();
      if (instanceId === "") {
        this.#toolMachine.commitFailed();
        this.#publish(false);
        return "";
      }
      this.#toolMachine.commitSucceeded();
      this.#publish(false);
      return instanceId;
    } catch (error) {
      this.#toolMachine.commitFailed();
      this.#publish(false);
      throw error;
    }
  }

  setLayerState(
    layerId: string,
    patch: Partial<Pick<FixedLayerState, "visible" | "locked" | "opacity">>,
  ): void {
    const current = this.#state.layers.get(layerId);
    if (current === undefined) throw new Error(`layer-not-found:${layerId}`);
    if (layerId === "tessera.system.grid" && patch.locked === false) {
      throw new Error("system-layer-must-stay-locked");
    }
    if (current.runtimeStatus === "missing" && patch.locked === false) {
      throw new Error("missing-module-layer-must-stay-locked");
    }
    const next = { ...current, ...patch };
    if (next.opacity < 0 || next.opacity > 1)
      throw new RangeError("layer-opacity-invalid");
    const layers = this.#state.layers as Map<string, FixedLayerState>;
    this.#execute({
      managers: new Set(["layers"]),
      apply: () => void layers.set(layerId, next),
      revert: () => void layers.set(layerId, current),
    });
  }

  select(objects: readonly SelectedObject[], additive = false): void {
    if (!additive) this.#selection.clear();
    for (const object of objects) {
      const key = `${object.kind}:${object.id}`;
      if (additive && this.#selection.has(key)) this.#selection.delete(key);
      else this.#selection.set(key, object);
    }
    this.#publish(false);
  }

  selectInstantiatedEdges(edgeIds: Iterable<string>, additive = false): void {
    const selected = [...edgeIds]
      .filter((edgeId) => this.#state.edges.get(edgeId) !== undefined)
      .map((id): SelectedObject => ({ kind: "edge", id }));
    this.select(selected, additive);
  }

  updateSelectionColor(color: string): void {
    for (const selected of this.#selection.values()) {
      const layerId =
        selected.kind === "cell"
          ? "tessera.basic.cell-style"
          : selected.kind === "edge"
            ? "tessera.basic.edge-style"
            : selected.kind === "connection"
              ? "tessera.basic.connection"
              : this.#state.overlays.get(selected.id)?.layerId;
      if (layerId !== undefined && this.#rejectBlockedLayer(layerId)) return;
    }
    this.beginBatch();
    try {
      for (const selected of this.#selection.values()) {
        if (selected.kind === "cell") {
          const coordinate = parseCellId(selected.id);
          this.paintCell(coordinate.row, coordinate.column, color);
        } else if (selected.kind === "edge") {
          const edge = this.#state.edges.get(selected.id);
          if (edge !== undefined) {
            this.paintEdge(edge.edgeId, edge.adjacentCellIds, color);
          }
        } else if (selected.kind === "overlay") {
          const overlay = this.#state.overlays.get(selected.id);
          if (overlay === undefined) continue;
          const next = {
            ...overlay,
            style: { ...overlay.style, color },
          } as OverlayData;
          this.#execute({
            managers: new Set(["overlays"]),
            apply: () => void this.#state.overlays.replace(next),
            revert: () => void this.#state.overlays.replace(overlay),
          });
        } else {
          const connection = this.#state.connections.get(selected.id);
          if (connection === undefined) continue;
          const next = {
            ...connection,
            style: { ...connection.style, strokeColor: color },
          } as ConnectionData;
          this.#execute({
            managers: new Set(["connections"]),
            apply: () => void this.#state.connections.replace(next),
            revert: () => void this.#state.connections.replace(connection),
          });
        }
      }
      this.commitBatch();
    } catch (error) {
      this.cancelBatch();
      throw error;
    }
  }

  beginBatch(): void {
    if (this.#batch === undefined) {
      this.#batch = { transactionId: newUuid(), changes: [] };
    }
  }

  commitBatch(): void {
    const batch = this.#batch;
    this.#batch = undefined;
    if (batch === undefined || batch.changes.length === 0) return;
    const managers = new Set(
      batch.changes.flatMap((change) => [...change.managers]),
    );
    this.#recordHistory({
      transactionId: batch.transactionId,
      managers,
      apply: () => this.#applyAtomically(batch.changes),
      revert: () => {
        for (const change of [...batch.changes].reverse()) change.revert();
      },
    });
    this.#state.lastTransactionId = batch.transactionId;
    this.#publish(true);
  }

  cancelBatch(): void {
    const batch = this.#batch;
    this.#batch = undefined;
    if (batch === undefined) return;
    for (const change of [...batch.changes].reverse()) change.revert();
    this.#publish(false);
  }

  undo(): void {
    const change = this.#undo.pop();
    if (change === undefined) return;
    change.revert();
    this.#redo.push(change);
    this.#state.lastTransactionId = change.transactionId;
    this.#publish(true);
  }

  redo(): void {
    const change = this.#redo.pop();
    if (change === undefined) return;
    change.apply();
    this.#undo.push(change);
    this.#state.lastTransactionId = change.transactionId;
    this.#publish(true);
  }

  #execute(change: Change): void {
    this.#operationRejection = null;
    try {
      change.apply();
    } catch (error) {
      this.cancelBatch();
      throw error;
    }
    if (this.#batch !== undefined) {
      this.#batch.changes.push(change);
      this.#publish(false);
      return;
    }
    const entry: HistoryEntry = { ...change, transactionId: newUuid() };
    this.#recordHistory(entry);
    this.#state.lastTransactionId = entry.transactionId;
    this.#publish(true);
  }

  #executeTransaction(changes: readonly Change[]): void {
    try {
      this.#applyAtomically(changes);
    } catch (error) {
      this.cancelBatch();
      throw error;
    }
    const managers = new Set(changes.flatMap((change) => [...change.managers]));
    const change: Change = {
      managers,
      apply: () => this.#applyAtomically(changes),
      revert: () => {
        for (const step of [...changes].reverse()) step.revert();
      },
    };
    if (this.#batch !== undefined) {
      this.#batch.changes.push(change);
      this.#publish(false);
      return;
    }
    const entry: HistoryEntry = { ...change, transactionId: newUuid() };
    this.#recordHistory(entry);
    this.#state.lastTransactionId = entry.transactionId;
    this.#publish(true);
  }

  #applyAtomically(changes: readonly Change[]): void {
    const applied: Change[] = [];
    try {
      for (const change of changes) {
        change.apply();
        applied.push(change);
      }
    } catch (error) {
      for (const change of applied.reverse()) change.revert();
      throw error;
    }
  }

  #recordHistory(entry: HistoryEntry): void {
    this.#undo.push(entry);
    if (this.#undo.length > 100) this.#undo.shift();
    this.#redo.length = 0;
  }

  #commitFillPlan(
    matched: readonly { row: number; column: number }[],
    fillColor: string,
  ): void {
    if (matched.length === 0) return;
    const changes = matched.map(({ row, column }) => {
      const id = cellId(this.#state.grid.type, row, column);
      const previous = this.#state.cells.get(id);
      const next: CellOverride = {
        instanceId: previous?.instanceId ?? newUuid(),
        cellId: id,
        row,
        column,
        fillColor,
        fillOpacity: previous?.fillOpacity ?? 1,
        ...(previous?.label === undefined ? {} : { label: previous.label }),
      };
      return { id, previous, next };
    });
    this.#execute({
      managers: new Set(["cells", "chunks"]),
      apply: () => {
        for (const change of changes) {
          this.#state.cells.set(change.id, change.next);
        }
      },
      revert: () => {
        for (const change of changes) {
          if (change.previous === undefined) {
            this.#state.cells.delete(change.id);
          } else {
            this.#state.cells.set(change.id, change.previous);
          }
        }
      },
    });
  }

  #rejectBlockedLayer(layerId: string): boolean {
    const layer = this.#state.layers.get(layerId);
    const code: EditorOperationRejection["code"] | null =
      layer === undefined
        ? "layer-unavailable"
        : layer.runtimeStatus === "missing"
          ? "layer-module-missing"
          : layer.locked
            ? "layer-locked"
            : !layer.visible
              ? "layer-hidden"
              : null;
    if (code === null) return false;
    if (
      this.#operationRejection?.code !== code ||
      this.#operationRejection.layerId !== layerId
    ) {
      this.#operationRejection = { code, layerId };
      this.#publish(false);
    }
    return true;
  }

  #invalidateModuleInstanceCarrier(instance: ModuleRuntimeInstance): void {
    const invalidateEdge = (edgeId: string) => {
      const ownerCellId = this.#state.edges.get(edgeId)?.adjacentCellIds[0];
      if (ownerCellId !== undefined)
        this.#state.cells.invalidateRuntimeChunkForCell(ownerCellId);
    };
    if (instance.kind === "cell") {
      this.#state.cells.invalidateRuntimeChunkForCell(instance.cellId);
    } else if (instance.kind === "edge") {
      const ownerCellId = instance.adjacentCellIds[0];
      if (ownerCellId !== undefined)
        this.#state.cells.invalidateRuntimeChunkForCell(ownerCellId);
    } else if (instance.kind === "overlay") {
      if (instance.objectKind === "anchored-overlay") {
        if (instance.anchor?.kind === "cell")
          this.#state.cells.invalidateRuntimeChunkForCell(
            instance.anchor.cellId,
          );
        else if (instance.anchor?.kind === "edge")
          invalidateEdge(instance.anchor.edgeId);
      }
    } else if (instance.kind === "connection") {
      for (const endpoint of [instance.start, instance.end]) {
        if (endpoint.kind === "cell-center")
          this.#state.cells.invalidateRuntimeChunkForCell(endpoint.cellId);
        else if (endpoint.kind === "edge-midpoint")
          invalidateEdge(endpoint.edgeId);
      }
    } else {
      for (const cellId of instance.memberCellIds)
        this.#state.cells.invalidateRuntimeChunkForCell(cellId);
    }
  }

  #edgeHasReference(edgeId: string): boolean {
    if (this.#state.moduleInstances.hasEdgeReference(edgeId)) return true;
    return (
      this.#state.overlays.hasEdgeReference(edgeId) ||
      this.#state.connections.hasEdgeReference(edgeId)
    );
  }

  #overlayOwnerCellId(anchor: OverlayAnchor): string {
    if (anchor.kind === "cell") return anchor.cellId;
    const edge = this.#state.edges.get(anchor.edgeId);
    const ownerCellId = edge?.adjacentCellIds[0];
    if (ownerCellId === undefined) {
      throw new Error(`overlay-edge-anchor-not-found:${anchor.edgeId}`);
    }
    return ownerCellId;
  }

  #publish(updateRevision: boolean): void {
    if (updateRevision) {
      this.#state.revision += 1;
      this.#state.updatedAt = new Date().toISOString();
    }
    this.#version += 1;
    for (const listener of this.#listeners) listener();
  }
}
