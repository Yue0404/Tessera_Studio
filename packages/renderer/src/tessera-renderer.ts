import "pixi.js/unsafe-eval";
import { Application, Container, Graphics } from "pixi.js";
import {
  clipSegmentToRect,
  edgeIdentity,
  edgeSegment,
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
import { GridRenderer } from "./grid-renderer.js";
import { OverlayRenderer } from "./overlay-renderer.js";
import { endpointPoint, overlayAnchorPoint } from "./render-utils.js";
import { hitTestProjectObject } from "./project-hit-test.js";

export type BrushMode = "paint" | "erase" | "fill";
export interface OverlayPlacement {
  type: "marker" | "text";
  anchor: "cell" | "edge" | "map-point";
}
export interface ConnectionPlacement {
  kind: "line" | "arrow";
  endpoint: "cell-center" | "edge-midpoint" | "map-point";
  arrowMode: "end" | "both";
  label: string;
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
  ): void;
  select(objects: readonly SelectedObject[], additive: boolean): void;
  cancelTool(): void;
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
  #state: Readonly<ProjectState>;
  #visible: VisibleCell[] = [];
  #painting = false;
  #connectionStart: ConnectionEndpoint | null = null;
  #connectionEdges: EdgePlacementTarget[] = [];
  #camera = { x: 0, y: 0 };
  #lastScreenPoint: MapPoint | null = null;
  #resizeObserver: ResizeObserver | undefined;

  constructor(
    host: HTMLElement,
    state: Readonly<ProjectState>,
    interaction: RendererInteraction,
    canvasLabel: string,
  ) {
    this.#host = host;
    this.#state = state;
    this.#interaction = interaction;
    this.#canvasLabel = canvasLabel;
    this.#gridRenderer = new GridRenderer(this.#content);
    this.#connectionRenderer = new ConnectionRenderer(this.#content);
    this.#overlayRenderer = new OverlayRenderer(this.#content);
  }

  async initialize(): Promise<void> {
    await this.#application.init({
      preference: "webgl",
      resizeTo: this.#host,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(devicePixelRatio, 2),
      backgroundAlpha: 1,
    });
    this.#application.canvas.dataset.testid = "map-canvas";
    this.#application.canvas.setAttribute("aria-label", this.#canvasLabel);
    this.#application.canvas.tabIndex = 0;
    this.#host.append(this.#application.canvas);
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
      "contextmenu",
      this.#onContextMenu,
    );
    window.addEventListener("pointerup", this.#onPointerUp);
    window.addEventListener("keydown", this.#onKeyDown);
    this.#resizeObserver = new ResizeObserver(() => this.render(this.#state));
    this.#resizeObserver.observe(this.#host);
    this.render(this.#state);
  }

  render(state: Readonly<ProjectState>): void {
    this.#state = state;
    const width = Math.max(1, this.#host.clientWidth);
    const height = Math.max(1, this.#host.clientHeight);
    const viewport = this.#viewport(width, height);
    this.#visible = visibleCellsInRect(
      state.grid,
      viewport.minX,
      viewport.minY,
      viewport.maxX,
      viewport.maxY,
    );
    for (const cell of this.#visible) {
      state.cells.touchRuntimeChunk(
        Math.floor(cell.row / 64),
        Math.floor(cell.column / 64),
      );
    }
    const background = this.#colorValue(state.style.canvasBackground);
    this.#application.renderer.background.color = background.color;
    this.#application.renderer.background.alpha = background.alpha;
    this.#content.position.set(this.#camera.x, this.#camera.y);
    this.#gridRenderer.render(state, this.#visible);
    this.#connectionRenderer.render(state, viewport);
    this.#overlayRenderer.render(state, viewport);
    this.#renderPreview();
  }

  destroy(): void {
    this.#resizeObserver?.disconnect();
    this.#application.canvas.removeEventListener(
      "pointerdown",
      this.#onPointerDown,
    );
    this.#application.canvas.removeEventListener(
      "pointermove",
      this.#onPointerMove,
    );
    this.#application.canvas.removeEventListener(
      "contextmenu",
      this.#onContextMenu,
    );
    window.removeEventListener("pointerup", this.#onPointerUp);
    window.removeEventListener("keydown", this.#onKeyDown);
    this.#application.destroy({ removeView: true }, { children: true });
  }

  #viewport(width: number, height: number): MapRect {
    return {
      minX: -this.#camera.x,
      minY: -this.#camera.y,
      maxX: width - this.#camera.x,
      maxY: height - this.#camera.y,
    };
  }

  #screenPoint(event: PointerEvent): MapPoint {
    const bounds = this.#application.canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  #mapPoint(screen: MapPoint): MapPoint {
    return { x: screen.x - this.#camera.x, y: screen.y - this.#camera.y };
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
    const selected: SelectedObject[] = this.#visible
      .filter(
        (cell) =>
          cell.center.x >= rect.minX &&
          cell.center.x <= rect.maxX &&
          cell.center.y >= rect.minY &&
          cell.center.y <= rect.maxY,
      )
      .map((cell) => ({ kind: "cell", id: cell.cellId }));
    for (const edge of this.#state.edges.values()) {
      const segment = edgeSegment(
        this.#state.grid,
        edge.edgeId,
        edge.adjacentCellIds,
      );
      if (
        segment !== undefined &&
        clipSegmentToRect(segment[0], segment[1], rect) !== null
      ) {
        selected.push({ kind: "edge", id: edge.edgeId });
      }
    }
    for (const connection of this.#state.connections.values()) {
      const points = this.#connectionPoints(connection.start, connection.end);
      if (
        points !== undefined &&
        clipSegmentToRect(points[0], points[1], rect) !== null
      ) {
        selected.push({ kind: "connection", id: connection.connectionId });
      }
    }
    for (const overlay of this.#state.overlays.values()) {
      const point = overlayAnchorPoint(this.#state, overlay);
      if (
        point !== undefined &&
        point.x >= rect.minX &&
        point.x <= rect.maxX &&
        point.y >= rect.minY &&
        point.y <= rect.maxY
      ) {
        selected.push({ kind: "overlay", id: overlay.overlayId });
      }
    }
    return selected;
  }

  #connectionPoints(
    start: ConnectionEndpoint,
    end: ConnectionEndpoint,
  ): readonly [MapPoint, MapPoint] | undefined {
    const resolve = (endpoint: ConnectionEndpoint) => {
      if (endpoint.kind === "map-point") return endpoint.point;
      if (endpoint.kind === "cell-center") {
        return endpointPoint(this.#state, endpoint);
      }
      const edge = this.#state.edges.get(endpoint.edgeId);
      const segment =
        edge &&
        edgeSegment(this.#state.grid, edge.edgeId, edge.adjacentCellIds);
      return segment
        ? {
            x: (segment[0].x + segment[1].x) / 2,
            y: (segment[0].y + segment[1].y) / 2,
          }
        : undefined;
    };
    const startPoint = resolve(start);
    const endPoint = resolve(end);
    return startPoint && endPoint ? [startPoint, endPoint] : undefined;
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
        this.#preview
          .rect(
            left + this.#camera.x,
            top + this.#camera.y,
            Math.abs(state.previewPoint.x - state.startPoint.x),
            Math.abs(state.previewPoint.y - state.startPoint.y),
          )
          .stroke({ color: 0x73b7c8, alpha: 0.9, width: 1 });
      }
      return;
    }
    this.#preview
      .moveTo(
        state.startPoint.x + this.#camera.x,
        state.startPoint.y + this.#camera.y,
      )
      .lineTo(
        state.previewPoint.x + this.#camera.x,
        state.previewPoint.y + this.#camera.y,
      )
      .stroke({ color: 0x73b7c8, alpha: 0.9, width: 2 });
  }

  readonly #onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const screen = this.#screenPoint(event);
    const point = this.#mapPoint(screen);
    const cell = this.#target(point);
    const toolBefore = this.#interaction.getToolState();
    this.#lastScreenPoint = screen;
    if (toolBefore.tool === "brush" || toolBefore.tool === "edge") {
      this.#painting = true;
      this.#interaction.beginStroke();
    }
    const connectionTarget =
      toolBefore.tool === "connection"
        ? this.#connectionEndpoint(point, cell)
        : null;
    const targetToken =
      connectionTarget?.endpoint.kind === "map-point"
        ? `point:${connectionTarget.endpoint.point.x}:${connectionTarget.endpoint.point.y}`
        : connectionTarget?.endpoint.kind === "edge-midpoint"
          ? connectionTarget.endpoint.edgeId
          : connectionTarget?.endpoint.kind === "cell-center"
            ? connectionTarget.endpoint.cellId
            : (cell?.cellId ?? null);
    this.#interaction.pointerDown(point, targetToken);
    if (toolBefore.tool === "brush" || toolBefore.tool === "edge")
      this.#paintAt(point);
    else if (toolBefore.tool === "marker") {
      const placement = this.#interaction.getOverlayPlacement();
      const edge = cell === undefined ? null : this.#edgeTarget(cell, point);
      if (placement.anchor === "map-point" || cell !== undefined) {
        this.#interaction.placeOverlay(point, cell?.cellId ?? null, edge);
      }
    } else if (toolBefore.tool === "select") {
      const hit = hitTestProjectObject(this.#state, point, cell);
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
      this.#interaction.commitConnection(
        this.#connectionStart,
        connectionTarget.endpoint,
        [
          ...this.#connectionEdges,
          ...(connectionTarget.edge ? [connectionTarget.edge] : []),
        ],
      );
      this.#connectionStart = null;
      this.#connectionEdges = [];
    }
    this.#application.canvas.setPointerCapture(event.pointerId);
    this.render(this.#state);
  };

  readonly #onPointerMove = (event: PointerEvent): void => {
    const screen = this.#screenPoint(event);
    const point = this.#mapPoint(screen);
    const tool = this.#interaction.getToolState().tool;
    if (
      tool === "pan" &&
      this.#lastScreenPoint !== null &&
      (event.buttons & 1) === 1
    ) {
      this.#camera.x += screen.x - this.#lastScreenPoint.x;
      this.#camera.y += screen.y - this.#lastScreenPoint.y;
      this.#lastScreenPoint = screen;
    } else {
      this.#interaction.pointerMove(point);
      if (this.#painting) this.#paintAt(point);
    }
    this.render(this.#state);
  };

  readonly #onPointerUp = (event: PointerEvent): void => {
    const screen = this.#screenPoint(event);
    const point = this.#mapPoint(screen);
    const toolState = this.#interaction.getToolState();
    const start = toolState.startPoint;
    if (this.#painting) this.#interaction.endStroke();
    this.#painting = false;
    this.#interaction.pointerUp(point);
    if (toolState.tool === "box-select" && start !== null) {
      const rect = {
        minX: Math.min(start.x, point.x),
        minY: Math.min(start.y, point.y),
        maxX: Math.max(start.x, point.x),
        maxY: Math.max(start.y, point.y),
      };
      this.#interaction.select(this.#boxSelection(rect), event.shiftKey);
    }
    this.#lastScreenPoint = null;
    this.render(this.#state);
  };

  readonly #onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    if (this.#painting) this.#interaction.cancelStroke();
    this.#painting = false;
    this.#connectionStart = null;
    this.#connectionEdges = [];
    this.#interaction.cancelTool();
    this.render(this.#state);
  };

  readonly #onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return;
    }
    if (event.key !== "Escape") return;
    if (this.#painting) this.#interaction.cancelStroke();
    this.#painting = false;
    this.#connectionStart = null;
    this.#connectionEdges = [];
    this.#interaction.cancelTool();
    this.render(this.#state);
  };

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
}
