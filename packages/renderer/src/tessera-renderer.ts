import "pixi.js/unsafe-eval";
import { Application, Container, Graphics } from "pixi.js";
import {
  edgeIdentity,
  hitTestCell,
  nearestEdge,
  visibleCellsInRect,
  type MapPoint,
  type MapRect,
  type ConnectionEndpoint,
  type ProjectState,
  type SelectedObject,
  type ToolState,
  type VisibleCell,
} from "@tessera/core";
import { ConnectionRenderer } from "./connection-renderer.js";
import { connectionTargetToken } from "./connection-target-token.js";
import { GridRenderer } from "./grid-renderer.js";
import {
  GenericModuleRenderer,
  type GenericModuleVisualResolver,
} from "./generic-module-renderer.js";
import { OverlayRenderer } from "./overlay-renderer.js";
import {
  boxSelectProjectObjects,
  hitTestProjectObject,
  topmostProjectHit,
} from "./project-hit-test.js";
import { enableRenderLayerSorting } from "./render-layer-order.js";
import { InteractionRangeState } from "./interaction-range-state.js";
import {
  WebGlContextLifecycle,
  type RendererContextStatus,
} from "./webgl-context-lifecycle.js";
import {
  ZOOM_STEP,
  clampZoom,
  mapToScreen,
  screenToMap,
  strokeAlignmentOffsetMapUnits,
  zoomCameraAt,
} from "./camera-transform.js";
import type { GridRendererStats } from "./grid-renderer.js";
import {
  isEditableShortcutTarget,
  PanInteractionState,
} from "./pan-interaction-state.js";
import {
  centerBoundsPlan,
  fitBoundsPlan,
  gridMapBounds,
  projectContentBounds,
  type ViewNavigationPlan,
} from "./viewport-navigation.js";

export type BrushMode = "paint" | "erase" | "fill";
export interface OverlayPlacement {
  type: "marker" | "text";
  anchor: "cell" | "edge" | "map-point";
  markerShape: "circle" | "diamond" | "pin";
}
export interface ConnectionPlacement {
  kind: "line" | "arrow";
  endpoint: "cell-center" | "edge-midpoint" | "map-point";
  arrowMode: "end" | "both";
  label: string;
}

export interface ConnectionRebindTarget {
  readonly connectionId: string;
  readonly endpoint: "start" | "end";
}

export type RendererInteractionRejection =
  | "connection-self-not-allowed"
  | "connection-rebind-target-invalid"
  | "connection-commit-failed";

export interface PointerLogicalStatus {
  readonly row: number;
  readonly column: number;
  readonly cellId: string;
  readonly objectKind: SelectedObject["kind"] | "cell";
}

export interface EdgePlacementTarget {
  edgeId: string;
  adjacentCellIds: readonly string[];
}

export interface RendererInteraction {
  getToolState(): Readonly<ToolState>;
  beginStroke(): void;
  endStroke(): void;
  cancelStroke(): void;
  pointerDown(point: MapPoint, cellId: string | null): void;
  pointerMove(point: MapPoint): void;
  pointerUp(point: MapPoint): void;
  paintCell(row: number, column: number): void;
  eraseCell(row: number, column: number): void;
  fillCells(row: number, column: number): void;
  getBrushMode(): BrushMode;
  paintEdge(edgeId: string, adjacentCellIds: readonly string[]): void;
  getOverlayPlacement(): OverlayPlacement;
  placeOverlay(
    point: MapPoint,
    cellId: string | null,
    edge: EdgePlacementTarget | null,
  ): void;
  getConnectionPlacement(): ConnectionPlacement;
  commitConnection(
    start: ConnectionEndpoint,
    end: ConnectionEndpoint,
    edgeReferences: readonly EdgePlacementTarget[],
  ): boolean;
  getConnectionRebind(): ConnectionRebindTarget | null;
  commitConnectionRebind(
    target: ConnectionRebindTarget,
    cellId: string,
  ): boolean;
  cancelConnectionRebind(): void;
  operationRejected(code: RendererInteractionRejection): void;
  select(objects: readonly SelectedObject[], additive: boolean): void;
  cancelTool(): void;
  contextStatusChanged?(status: RendererContextStatus): void;
  zoomChanged?(zoom: number): void;
  pointerStatusChanged?(status: PointerLogicalStatus | null): void;
}

export interface RendererPerformanceStats {
  readonly zoom: number;
  readonly visibleCellCount: number;
  readonly loadedChunkCount: number;
  readonly grid: GridRendererStats;
  readonly renderDurationMs: number;
}

export class TesseraRenderer {
  readonly #application = new Application();
  readonly #root = new Container();
  readonly #content = new Container();
  readonly #preview = new Graphics();
  readonly #host: HTMLElement;
  readonly #interaction: RendererInteraction;
  readonly #gridRenderer: GridRenderer;
  readonly #connectionRenderer: ConnectionRenderer;
  readonly #overlayRenderer: OverlayRenderer;
  readonly #canvasLabel: string;
  readonly #ranges = new InteractionRangeState();
  readonly #pan = new PanInteractionState();
  #state: Readonly<ProjectState>;
  #visible: VisibleCell[] = [];
  #painting = false;
  #connectionStart: ConnectionEndpoint | null = null;
  #connectionEdges: EdgePlacementTarget[] = [];
  #camera = { x: 0, y: 0 };
  #zoom = 1;
  #spacePressed = false;
  #resizeObserver: ResizeObserver | undefined;
  #contextLifecycle: WebGlContextLifecycle | undefined;
  #contextLost = false;
  #renderDurationMs = 0;
  #applicationInitialized = false;
  #applicationDestroyed = false;
  #destroyed = false;
  readonly #genericModuleRenderer: GenericModuleRenderer | undefined;

  constructor(
    host: HTMLElement,
    state: Readonly<ProjectState>,
    interaction: RendererInteraction,
    canvasLabel: string,
    genericModuleVisualResolver?: GenericModuleVisualResolver,
  ) {
    this.#host = host;
    this.#state = state;
    this.#interaction = interaction;
    this.#canvasLabel = canvasLabel;
    enableRenderLayerSorting(this.#content);
    this.#gridRenderer = new GridRenderer(this.#content);
    this.#connectionRenderer = new ConnectionRenderer(this.#content);
    this.#overlayRenderer = new OverlayRenderer(this.#content);
    this.#genericModuleRenderer =
      genericModuleVisualResolver === undefined
        ? undefined
        : new GenericModuleRenderer(this.#content, genericModuleVisualResolver);
  }

  async initialize(): Promise<void> {
    try {
      await this.#application.init({
        preference: "webgl",
        resizeTo: this.#host,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(devicePixelRatio, 2),
        backgroundAlpha: 1,
      });
    } catch (error: unknown) {
      // Pixi 插件可能在 renderer 已创建后才 reject；保留该事实供 pending cleanup 完成释放。
      this.#applicationInitialized =
        (this.#application as unknown as { renderer?: unknown }).renderer !==
        undefined;
      if (this.#destroyed) this.#destroyApplicationOnce();
      throw error;
    }
    this.#applicationInitialized = true;
    // React StrictMode 可能在 Pixi 初始化尚未完成时先执行 cleanup。
    if (this.#destroyed) {
      this.#destroyApplicationOnce();
      return;
    }
    this.#application.canvas.dataset.testid = "map-canvas";
    this.#application.canvas.dataset.rendererStatus = "available";
    this.#application.canvas.setAttribute("aria-label", this.#canvasLabel);
    this.#application.canvas.tabIndex = 0;
    this.#host.append(this.#application.canvas);
    this.#contextLifecycle = new WebGlContextLifecycle(
      this.#application.canvas,
      {
        onLost: this.#handleContextLost,
        onRestored: this.#handleContextRestored,
      },
    );
    this.#root.addChild(this.#content, this.#preview);
    this.#application.stage.addChild(this.#root);
    this.#application.canvas.addEventListener(
      "pointerdown",
      this.#onPointerDown,
    );
    this.#application.canvas.addEventListener(
      "pointermove",
      this.#onPointerMove,
    );
    this.#application.canvas.addEventListener(
      "pointerleave",
      this.#onPointerLeave,
    );
    this.#application.canvas.addEventListener(
      "contextmenu",
      this.#onContextMenu,
    );
    this.#application.canvas.addEventListener("wheel", this.#onWheel, {
      passive: false,
    });
    window.addEventListener("pointerup", this.#onPointerUp);
    window.addEventListener("pointercancel", this.#onPointerCancel);
    window.addEventListener("keydown", this.#onKeyDown);
    window.addEventListener("keyup", this.#onKeyUp);
    window.addEventListener("blur", this.#onWindowBlur);
    this.#resizeObserver = new ResizeObserver(() => this.render(this.#state));
    this.#resizeObserver.observe(this.#host);
    this.render(this.#state);
  }

  render(state: Readonly<ProjectState>): void {
    const startedAt = performance.now();
    this.#state = state;
    if (this.#contextLost) return;
    const width = Math.max(1, this.#host.clientWidth);
    const height = Math.max(1, this.#host.clientHeight);
    this.#ranges.updateViewport(this.#camera, width, height, this.#zoom);
    const viewport = this.#ranges.getViewportBounds();
    this.#visible = visibleCellsInRect(
      state.grid,
      viewport.minX,
      viewport.minY,
      viewport.maxX,
      viewport.maxY,
    );
    state.cells.updateRuntimeViewport(state.grid, this.#visible, {
      prefetchRings: 2,
      maxLoaded: 256,
    });
    const background = this.#colorValue(state.style.canvasBackground);
    this.#application.renderer.background.color = background.color;
    this.#application.renderer.background.alpha = background.alpha;
    this.#content.position.set(this.#camera.x, this.#camera.y);
    this.#content.scale.set(this.#zoom);
    this.#gridRenderer.render(
      state,
      this.#visible,
      strokeAlignmentOffsetMapUnits(
        this.#zoom,
        this.#application.renderer.resolution,
      ),
    );
    this.#connectionRenderer.render(state, viewport);
    this.#overlayRenderer.render(state, viewport, this.#zoom);
    this.#genericModuleRenderer?.render(
      state,
      viewport,
      this.#visible,
      this.#zoom,
    );
    this.#renderPreview();
    this.#renderDurationMs = performance.now() - startedAt;
    const stats = this.getPerformanceStats();
    const canvas = this.#application.canvas;
    canvas.dataset.zoom = String(this.#zoom);
    canvas.dataset.cameraX = String(this.#camera.x);
    canvas.dataset.cameraY = String(this.#camera.y);
    canvas.dataset.gridCellSize = String(state.grid.cellSize);
    canvas.dataset.loadedChunkCount = String(stats.loadedChunkCount);
    canvas.dataset.gridBatchCount = String(stats.grid.batchCount);
    canvas.dataset.gridRebuiltCount = String(stats.grid.rebuiltCount);
    canvas.dataset.gridTotalRebuiltCount = String(stats.grid.totalRebuiltCount);
    canvas.dataset.gridBuildDurationMs = String(stats.grid.buildDurationMs);
    const resourceStats = this.#genericModuleRenderer?.resourceStats;
    canvas.dataset.moduleResourceRequestedCount = String(
      resourceStats?.requested ?? 0,
    );
    canvas.dataset.moduleResourceReadyCount = String(resourceStats?.ready ?? 0);
    canvas.dataset.moduleResourcePlaceholderCount = String(
      resourceStats?.placeholder ?? 0,
    );
    if (stats.grid.rebuiltCount > 0) {
      canvas.dataset.gridLastRebuildDurationMs = String(
        stats.grid.buildDurationMs,
      );
    }
    canvas.dataset.renderDurationMs = String(this.#renderDurationMs);
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#resizeObserver?.disconnect();
    this.#contextLifecycle?.destroy();
    this.#contextLifecycle = undefined;
    window.removeEventListener("pointerup", this.#onPointerUp);
    window.removeEventListener("pointercancel", this.#onPointerCancel);
    window.removeEventListener("keydown", this.#onKeyDown);
    window.removeEventListener("keyup", this.#onKeyUp);
    window.removeEventListener("blur", this.#onWindowBlur);
    this.#genericModuleRenderer?.destroy();
    // autoDetectRenderer reject 时 Pixi 尚无 renderer/canvas，只清理已创建的 JS 资源。
    if (!this.#applicationInitialized) return;
    this.#application.canvas.removeEventListener(
      "pointerdown",
      this.#onPointerDown,
    );
    this.#application.canvas.removeEventListener(
      "pointermove",
      this.#onPointerMove,
    );
    this.#application.canvas.removeEventListener(
      "pointerleave",
      this.#onPointerLeave,
    );
    this.#application.canvas.removeEventListener(
      "contextmenu",
      this.#onContextMenu,
    );
    this.#application.canvas.removeEventListener("wheel", this.#onWheel);
    this.#destroyApplicationOnce();
  }

  #destroyApplicationOnce(): void {
    if (!this.#applicationInitialized || this.#applicationDestroyed) return;
    this.#applicationDestroyed = true;
    this.#application.destroy({ removeView: true }, { children: true });
  }

  getViewportBounds(): MapRect {
    return this.#ranges.getViewportBounds();
  }

  getSelectionBounds(): MapRect | null {
    return this.#ranges.getSelectionBounds();
  }

  getZoom(): number {
    return this.#zoom;
  }

  setZoom(value: number, screenAnchor?: Readonly<MapPoint>): number {
    const bounds = this.#application.canvas.getBoundingClientRect();
    const anchor = screenAnchor ?? {
      x: bounds.width / 2,
      y: bounds.height / 2,
    };
    const next = zoomCameraAt(this.#camera, this.#zoom, value, anchor);
    if (next.zoom === this.#zoom) return this.#zoom;
    this.#zoom = next.zoom;
    this.#camera = next.camera;
    this.render(this.#state);
    this.#interaction.zoomChanged?.(this.#zoom);
    return this.#zoom;
  }

  zoomByStep(direction: -1 | 1): number {
    const next = Math.round((this.#zoom + direction * ZOOM_STEP) * 100) / 100;
    return this.setZoom(next);
  }

  centerMap(): ViewNavigationPlan {
    return this.#applyViewPlan(
      centerBoundsPlan(
        gridMapBounds(this.#state.grid),
        this.#host.clientWidth,
        this.#host.clientHeight,
        this.#zoom,
      ),
    );
  }

  fitMap(): ViewNavigationPlan {
    return this.#applyViewPlan(
      fitBoundsPlan(
        gridMapBounds(this.#state.grid),
        this.#host.clientWidth,
        this.#host.clientHeight,
      ),
    );
  }

  fitContent(): ViewNavigationPlan {
    return this.#applyViewPlan(
      fitBoundsPlan(
        projectContentBounds(this.#state),
        this.#host.clientWidth,
        this.#host.clientHeight,
      ),
    );
  }

  #applyViewPlan(plan: ViewNavigationPlan): ViewNavigationPlan {
    if (plan.status !== "applied") return plan;
    this.#camera = { ...plan.camera };
    this.#zoom = plan.zoom;
    this.render(this.#state);
    this.#interaction.zoomChanged?.(this.#zoom);
    return plan;
  }

  getPerformanceStats(): RendererPerformanceStats {
    return {
      zoom: this.#zoom,
      visibleCellCount: this.#visible.length,
      loadedChunkCount: this.#state.cells.loadedChunkKeys.length,
      grid: this.#gridRenderer.stats,
      renderDurationMs: this.#renderDurationMs,
    };
  }

  #screenPoint(event: PointerEvent): MapPoint {
    const bounds = this.#application.canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  #mapPoint(screen: MapPoint): MapPoint {
    return screenToMap(screen, this.#camera, this.#zoom);
  }

  #target(point: MapPoint): VisibleCell | undefined {
    return hitTestCell(this.#visible, point);
  }

  #paintAt(point: MapPoint): void {
    const cell = this.#target(point);
    if (cell === undefined) return;
    const tool = this.#interaction.getToolState().tool;
    if (tool === "brush") {
      const mode = this.#interaction.getBrushMode();
      if (mode === "erase") this.#interaction.eraseCell(cell.row, cell.column);
      else if (mode === "fill")
        this.#interaction.fillCells(cell.row, cell.column);
      else this.#interaction.paintCell(cell.row, cell.column);
    } else if (tool === "edge") {
      const side = nearestEdge(cell, point);
      const edge = edgeIdentity(this.#state.grid, cell, side);
      this.#interaction.paintEdge(edge.edgeId, edge.adjacentCellIds);
    }
  }

  #edgeTarget(cell: VisibleCell, point: MapPoint): EdgePlacementTarget {
    const side = nearestEdge(cell, point);
    return edgeIdentity(this.#state.grid, cell, side);
  }

  #connectionEndpoint(
    point: MapPoint,
    cell: VisibleCell | undefined,
  ): { endpoint: ConnectionEndpoint; edge: EdgePlacementTarget | null } | null {
    const kind = this.#interaction.getConnectionPlacement().endpoint;
    if (kind === "map-point") {
      return { endpoint: { kind, point: { ...point } }, edge: null };
    }
    if (cell === undefined) return null;
    if (kind === "cell-center") {
      return { endpoint: { kind, cellId: cell.cellId }, edge: null };
    }
    const edge = this.#edgeTarget(cell, point);
    return { endpoint: { kind, edgeId: edge.edgeId }, edge };
  }

  #boxSelection(rect: MapRect): SelectedObject[] {
    const selected = boxSelectProjectObjects(this.#state, rect, this.#visible);
    selected.push(
      ...(this.#genericModuleRenderer
        ?.boxSelection(this.#state, rect, this.#visible)
        .map((id) => ({ kind: "module-instance" as const, id })) ?? []),
    );
    return selected;
  }

  #renderPreview(): void {
    this.#preview.clear();
    const state = this.#interaction.getToolState();
    if (
      (state.phase !== "previewing-end" && state.phase !== "committing") ||
      state.startPoint === null ||
      state.previewPoint === null
    ) {
      if (
        state.phase === "box-selecting" &&
        state.startPoint !== null &&
        state.previewPoint !== null
      ) {
        const left = Math.min(state.startPoint.x, state.previewPoint.x);
        const top = Math.min(state.startPoint.y, state.previewPoint.y);
        const start = mapToScreen(
          { x: left, y: top },
          this.#camera,
          this.#zoom,
        );
        this.#preview
          .rect(
            start.x,
            start.y,
            Math.abs(state.previewPoint.x - state.startPoint.x) * this.#zoom,
            Math.abs(state.previewPoint.y - state.startPoint.y) * this.#zoom,
          )
          .stroke({ color: 0x73b7c8, alpha: 0.9, width: 1 });
      }
      return;
    }
    const start = mapToScreen(state.startPoint, this.#camera, this.#zoom);
    const end = mapToScreen(state.previewPoint, this.#camera, this.#zoom);
    this.#preview
      .moveTo(start.x, start.y)
      .lineTo(end.x, end.y)
      .stroke({ color: 0x73b7c8, alpha: 0.9, width: 2 });
  }

  readonly #onPointerDown = (event: PointerEvent): void => {
    if (this.#contextLost) return;
    const screen = this.#screenPoint(event);
    const toolBefore = this.#interaction.getToolState();
    if (
      this.#pan.begin({
        pointerId: event.pointerId,
        button: event.button,
        screenPoint: screen,
        tool: toolBefore.tool,
        spacePressed: this.#spacePressed,
      })
    ) {
      event.preventDefault();
      this.#application.canvas.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0) return;
    const point = this.#mapPoint(screen);
    const cell = this.#target(point);
    const rebind = this.#interaction.getConnectionRebind();
    if (rebind !== null) {
      event.preventDefault();
      if (cell === undefined) {
        this.#interaction.operationRejected("connection-rebind-target-invalid");
        return;
      }
      try {
        if (this.#interaction.commitConnectionRebind(rebind, cell.cellId)) {
          this.#interaction.cancelConnectionRebind();
        }
      } catch (error) {
        this.#interaction.operationRejected(
          error instanceof Error &&
            error.message === "connection-self-not-allowed"
            ? "connection-self-not-allowed"
            : "connection-commit-failed",
        );
      }
      this.render(this.#state);
      return;
    }
    if (toolBefore.tool === "brush" || toolBefore.tool === "edge") {
      this.#painting = true;
      this.#interaction.beginStroke();
    }
    const connectionTarget =
      toolBefore.tool === "connection"
        ? this.#connectionEndpoint(point, cell)
        : null;
    const targetToken = connectionTargetToken(
      connectionTarget?.endpoint ?? null,
      cell?.cellId ?? null,
    );
    try {
      this.#interaction.pointerDown(point, targetToken);
    } catch (error) {
      this.#interaction.operationRejected(
        error instanceof Error &&
          error.message === "connection-self-not-allowed"
          ? "connection-self-not-allowed"
          : "connection-commit-failed",
      );
      this.render(this.#state);
      return;
    }
    if (toolBefore.tool === "brush" || toolBefore.tool === "edge")
      this.#paintAt(point);
    else if (toolBefore.tool === "marker") {
      const placement = this.#interaction.getOverlayPlacement();
      const edge = cell === undefined ? null : this.#edgeTarget(cell, point);
      if (placement.anchor === "map-point" || cell !== undefined) {
        this.#interaction.placeOverlay(point, cell?.cellId ?? null, edge);
      }
    } else if (toolBefore.tool === "select") {
      const moduleHit = this.#genericModuleRenderer?.hitTest(
        this.#state,
        point,
        cell,
        this.#zoom,
      );
      const hit = topmostProjectHit(
        this.#state,
        hitTestProjectObject(this.#state, point, cell, this.#zoom),
        moduleHit ?? null,
      );
      this.#interaction.select(hit === null ? [] : [hit], event.shiftKey);
    } else if (
      toolBefore.tool === "connection" &&
      toolBefore.phase === "choosing-start" &&
      connectionTarget !== null
    ) {
      this.#connectionStart = connectionTarget.endpoint;
      this.#connectionEdges = connectionTarget.edge
        ? [connectionTarget.edge]
        : [];
    } else if (
      toolBefore.tool === "connection" &&
      toolBefore.phase === "previewing-end" &&
      connectionTarget !== null &&
      this.#connectionStart !== null
    ) {
      try {
        const committed = this.#interaction.commitConnection(
          this.#connectionStart,
          connectionTarget.endpoint,
          [
            ...this.#connectionEdges,
            ...(connectionTarget.edge ? [connectionTarget.edge] : []),
          ],
        );
        if (committed) {
          this.#connectionStart = null;
          this.#connectionEdges = [];
        }
      } catch {
        this.#interaction.operationRejected("connection-commit-failed");
      }
    }
    this.#application.canvas.setPointerCapture(event.pointerId);
    this.render(this.#state);
  };

  readonly #onPointerMove = (event: PointerEvent): void => {
    if (this.#contextLost) return;
    const screen = this.#screenPoint(event);
    this.#reportPointerStatus(screen);
    const panDelta = this.#pan.move(event.pointerId, event.buttons, screen);
    if (panDelta !== null) {
      this.#camera.x += panDelta.x;
      this.#camera.y += panDelta.y;
      this.render(this.#state);
      return;
    }
    const point = this.#mapPoint(screen);
    this.#interaction.pointerMove(point);
    if (this.#painting) this.#paintAt(point);
    this.render(this.#state);
  };

  readonly #onPointerLeave = (): void => {
    this.#interaction.pointerStatusChanged?.(null);
  };

  #reportPointerStatus(screen: MapPoint): void {
    const point = this.#mapPoint(screen);
    const cell = this.#target(point);
    if (cell === undefined) {
      this.#interaction.pointerStatusChanged?.(null);
      return;
    }
    const hit = hitTestProjectObject(this.#state, point, cell, this.#zoom);
    this.#interaction.pointerStatusChanged?.({
      row: cell.row,
      column: cell.column,
      cellId: cell.cellId,
      objectKind: hit?.kind ?? "cell",
    });
  }

  readonly #onPointerUp = (event: PointerEvent): void => {
    if (this.#contextLost) return;
    if (this.#pan.end(event.pointerId)) {
      this.render(this.#state);
      return;
    }
    const screen = this.#screenPoint(event);
    const point = this.#mapPoint(screen);
    const toolState = this.#interaction.getToolState();
    const start = toolState.startPoint;
    if (this.#painting) this.#interaction.endStroke();
    this.#painting = false;
    this.#interaction.pointerUp(point);
    if (toolState.tool === "box-select" && start !== null) {
      const rect = this.#ranges.commitSelection(start, point);
      this.#interaction.select(
        rect === null ? [] : this.#boxSelection(rect),
        event.shiftKey,
      );
    }
    this.render(this.#state);
  };

  readonly #onPointerCancel = (event: PointerEvent): void => {
    if (this.#pan.end(event.pointerId)) {
      this.render(this.#state);
      return;
    }
    this.#cancelTransientInteraction();
  };

  readonly #onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    if (this.#contextLost) return;
    if (this.#painting) this.#interaction.cancelStroke();
    this.#painting = false;
    this.#connectionStart = null;
    this.#connectionEdges = [];
    this.#interaction.cancelTool();
    this.render(this.#state);
  };

  readonly #onWheel = (event: WheelEvent): void => {
    if (this.#contextLost) return;
    event.preventDefault();
    const bounds = this.#application.canvas.getBoundingClientRect();
    const anchor = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
    const factor = Math.exp(-event.deltaY * 0.0015);
    this.setZoom(clampZoom(this.#zoom * factor), anchor);
  };

  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (this.#contextLost) return;
    if (isEditableShortcutTarget(event.target)) return;
    if (event.code === "Space") {
      event.preventDefault();
      this.#spacePressed = true;
      return;
    }
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      this.zoomByStep(1);
      return;
    }
    if (event.key === "-") {
      event.preventDefault();
      this.zoomByStep(-1);
      return;
    }
    if (event.key === "0") {
      event.preventDefault();
      this.setZoom(1);
      return;
    }
    if (event.key !== "Escape") return;
    if (this.#painting) this.#interaction.cancelStroke();
    this.#painting = false;
    this.#connectionStart = null;
    this.#connectionEdges = [];
    this.#interaction.cancelConnectionRebind();
    this.#interaction.cancelTool();
    this.render(this.#state);
  };

  readonly #onKeyUp = (event: KeyboardEvent): void => {
    if (event.code !== "Space" || !this.#spacePressed) return;
    event.preventDefault();
    this.#spacePressed = false;
    if (this.#pan.releaseSpace()) this.render(this.#state);
  };

  readonly #onWindowBlur = (): void => {
    this.#spacePressed = false;
    this.#pan.cancel();
    this.#cancelTransientInteraction();
  };

  #cancelTransientInteraction(): void {
    if (this.#painting) this.#interaction.cancelStroke();
    this.#painting = false;
    this.#connectionStart = null;
    this.#connectionEdges = [];
    this.#interaction.cancelConnectionRebind();
    this.#interaction.cancelTool();
    this.render(this.#state);
  }

  #colorValue(color: string): { color: number; alpha: number } {
    const normalized = color.replace("#", "");
    return {
      color: Number.parseInt(normalized.slice(0, 6), 16),
      alpha:
        normalized.length === 8
          ? Number.parseInt(normalized.slice(6), 16) / 255
          : 1,
    };
  }

  readonly #handleContextLost = (): void => {
    this.#contextLost = true;
    this.#application.stop();
    if (this.#painting) this.#interaction.cancelStroke();
    this.#painting = false;
    this.#connectionStart = null;
    this.#connectionEdges = [];
    this.#spacePressed = false;
    this.#pan.cancel();
    this.#interaction.cancelConnectionRebind();
    this.#interaction.cancelTool();
    this.#application.canvas.dataset.rendererStatus = "context-lost";
    this.#application.canvas.setAttribute("aria-disabled", "true");
    this.#interaction.contextStatusChanged?.("lost");
  };

  readonly #handleContextRestored = (): void => {
    this.#contextLost = false;
    this.#application.canvas.dataset.rendererStatus = "available";
    this.#application.canvas.removeAttribute("aria-disabled");
    // Pixi 的 contextChange 已重建底层 GPU 系统；重新生成全部场景指令和可见缓存。
    this.#gridRenderer.invalidateAll();
    this.render(this.#state);
    this.#application.start();
    this.#interaction.contextStatusChanged?.("available");
  };
}
