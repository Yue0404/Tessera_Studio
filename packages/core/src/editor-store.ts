import { assertGridCoordinate, parseCellId } from "./coordinates.js";
import { ConnectionManager } from "./connection-manager.js";
import { planFillRegion } from "./fill-region.js";
import { cellId } from "./geometry.js";
import { EdgeManager } from "./edge-manager.js";
import { createFixedLayerMap } from "./layers.js";
import { OverlayManager } from "./overlay-manager.js";
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
  NewProjectInput,
  OverlayAnchor,
  OverlayData,
  ProjectState,
  SelectedObject,
} from "./types.js";

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

type Listener = () => void;
type ManagerName =
  "cells" | "edges" | "connections" | "overlays" | "layers" | "chunks";

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

  get toolState() {
    return this.#toolMachine.state;
  }

  get selection(): readonly SelectedObject[] {
    return [...this.#selection.values()];
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

  pointerDown(point: MapPoint, targetCellId: string | null): void {
    this.#toolMachine.pointerDown(point, targetCellId);
    this.#publish(false);
  }

  pointerMove(point: MapPoint): void {
    this.#toolMachine.pointerMove(point);
    this.#publish(false);
  }

  pointerUp(point: MapPoint): void {
    this.#toolMachine.pointerUp(point);
    this.#publish(false);
  }

  paintCell(row: number, column: number, fillColor: string): void {
    try {
      assertGridCoordinate(this.#state.grid, { row, column });
    } catch (error) {
      this.cancelBatch();
      throw error;
    }
    if (this.#layerLocked("tessera.basic.cell-style")) return;
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
    if (previous === undefined || this.#layerLocked("tessera.basic.cell-style"))
      return;
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
    if (this.#layerLocked("tessera.basic.cell-style")) return 0;
    const matched = planFillRegion(this.#state, row, column, fillColor, limit);
    this.beginBatch();
    try {
      for (const cell of matched)
        this.paintCell(cell.row, cell.column, fillColor);
      this.commitBatch();
      return matched.length;
    } catch (error) {
      this.cancelBatch();
      throw error;
    }
  }

  paintEdge(
    edgeId: string,
    adjacentCellIds: readonly string[],
    strokeColor: string,
  ): void {
    if (this.#layerLocked("tessera.basic.edge-style")) return;
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
            strokeColor,
            strokeWidth: width,
            persistence: "explicit-style",
          };
    const ownerCellId = adjacentCellIds[0];
    if (ownerCellId === undefined) throw new Error("edge-owner-missing");
    this.#executeTransaction([
      {
        managers: new Set(["edges"]),
        apply: () => {
          this.#state.edges.ensure(next);
          this.#state.edges.setPersistence(edgeId, "explicit-style");
          this.#state.edges.updateStyle(edgeId, next);
        },
        revert: () => {
          if (previous === undefined) this.#state.edges.delete(edgeId);
          else {
            this.#state.edges.updateStyle(edgeId, previous);
            this.#state.edges.setPersistence(edgeId, previous.persistence);
          }
        },
      },
      {
        managers: new Set(["chunks"]),
        apply: () => this.#state.cells.assignEdge(edgeId, ownerCellId),
        revert: () => this.#state.cells.unassignEdge(edgeId, ownerCellId),
      },
    ]);
  }

  updateEdgeStyle(edgeId: string, style: EdgeStyle): void {
    const previous = this.#state.edges.get(edgeId);
    if (previous === undefined) throw new Error(`edge-not-found:${edgeId}`);
    const before = cloneEdge(previous);
    this.#execute({
      managers: new Set(["edges"]),
      apply: () => {
        this.#state.edges.updateStyle(edgeId, style);
        this.#state.edges.setPersistence(edgeId, "explicit-style");
      },
      revert: () => {
        this.#state.edges.updateStyle(edgeId, before);
        this.#state.edges.setPersistence(
          edgeId,
          before.persistence ?? "explicit-style",
        );
      },
    });
  }

  placeMarker(anchor: OverlayAnchor | MapPoint, color = "#D9B866FF"): string {
    if (this.#layerLocked("tessera.basic.placed-object")) return "";
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
              markerShape: "pin",
            },
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
              markerShape: "pin",
            },
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

  placeEdgeMarker(edge: EdgeOverride, color = "#D9B866FF"): string {
    return this.#placeEdgeOverlay(edge, "marker", null, { color });
  }

  #placeEdgeOverlay(
    edge: EdgeOverride,
    overlayType: "marker" | "text",
    text: string | null,
    style: Partial<TextPlacementStyle>,
  ): string {
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
              markerShape: "diamond",
            },
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
    this.#execute({
      managers: new Set(["connections"]),
      apply: () => void this.#state.connections.replace(next),
      revert: () => void this.#state.connections.replace(previous),
    });
  }

  deleteSelection(): void {
    this.beginBatch();
    try {
      for (const selected of [...this.#selection.values()]) {
        if (selected.kind === "cell") {
          const coordinate = parseCellId(selected.id);
          this.eraseCell(coordinate.row, coordinate.column);
        } else if (selected.kind === "edge") {
          const edge = this.#state.edges.get(selected.id);
          if (edge === undefined) continue;
          const snapshot = cloneEdge(edge);
          const ownerCellId = edge.adjacentCellIds[0];
          if (ownerCellId === undefined) throw new Error("edge-owner-missing");
          const overlays = [...this.#state.overlays.values()].filter(
            (overlay) =>
              overlay.kind === "anchored-overlay" &&
              overlay.anchor.kind === "edge" &&
              overlay.anchor.edgeId === selected.id,
          );
          const connections = [...this.#state.connections.values()].filter(
            (connection) =>
              (connection.start.kind === "edge-midpoint" &&
                connection.start.edgeId === selected.id) ||
              (connection.end.kind === "edge-midpoint" &&
                connection.end.edgeId === selected.id),
          );
          this.#executeTransaction([
            ...overlays.flatMap((overlay): Change[] => [
              {
                managers: new Set(["overlays"]),
                apply: () =>
                  void this.#state.overlays.delete(overlay.overlayId),
                revert: () => void this.#state.overlays.add(overlay),
              },
              {
                managers: new Set(["chunks"]),
                apply: () =>
                  this.#state.cells.unassignOverlay(
                    overlay.overlayId,
                    ownerCellId,
                  ),
                revert: () =>
                  this.#state.cells.assignOverlay(
                    overlay.overlayId,
                    ownerCellId,
                  ),
              },
            ]),
            ...connections.map((connection): Change => ({
              managers: new Set(["connections"]),
              apply: () =>
                void this.#state.connections.delete(connection.connectionId),
              revert: () => void this.#state.connections.add(connection),
            })),
            {
              managers: new Set(["edges"]),
              apply: () => void this.#state.edges.delete(selected.id),
              revert: () => void this.#state.edges.ensure(snapshot),
            },
            {
              managers: new Set(["chunks"]),
              apply: () =>
                this.#state.cells.unassignEdge(selected.id, ownerCellId),
              revert: () =>
                this.#state.cells.assignEdge(selected.id, ownerCellId),
            },
          ]);
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
              : [...this.#state.overlays.values()].some(
                  (candidate) =>
                    candidate.overlayId !== overlay.overlayId &&
                    candidate.kind === "anchored-overlay" &&
                    candidate.anchor.kind === "edge" &&
                    candidate.anchor.edgeId === referencedEdge.edgeId,
                ) ||
                [...this.#state.connections.values()].some(
                  (connection) =>
                    (connection.start.kind === "edge-midpoint" &&
                      connection.start.edgeId === referencedEdge.edgeId) ||
                    (connection.end.kind === "edge-midpoint" &&
                      connection.end.edgeId === referencedEdge.edgeId),
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
              const usedByOverlay = [...this.#state.overlays.values()].some(
                (overlay) =>
                  overlay.kind === "anchored-overlay" &&
                  overlay.anchor.kind === "edge" &&
                  overlay.anchor.edgeId === edge.edgeId,
              );
              const usedByOtherConnection = [
                ...this.#state.connections.values(),
              ].some(
                (candidate) =>
                  candidate.connectionId !== connection.connectionId &&
                  ((candidate.start.kind === "edge-midpoint" &&
                    candidate.start.edgeId === edge.edgeId) ||
                    (candidate.end.kind === "edge-midpoint" &&
                      candidate.end.edgeId === edge.edgeId)),
              );
              return !usedByOverlay && !usedByOtherConnection;
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
      this.commitBatch();
      this.#selection.clear();
      this.#publish(false);
    } catch (error) {
      this.cancelBatch();
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

  setLayerState(
    layerId: string,
    patch: Partial<Pick<FixedLayerState, "visible" | "locked" | "opacity">>,
  ): void {
    const current = this.#state.layers.get(layerId);
    if (current === undefined) throw new Error(`layer-not-found:${layerId}`);
    if (layerId === "tessera.system.grid" && patch.locked === false) {
      throw new Error("system-layer-must-stay-locked");
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

  #layerLocked(layerId: string): boolean {
    const layer = this.#state.layers.get(layerId);
    return layer?.locked === true || layer?.visible === false;
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
