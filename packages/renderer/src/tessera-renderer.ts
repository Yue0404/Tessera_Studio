import "pixi.js/unsafe-eval";
import { Application, Container, Graphics } from "pixi.js";
import {
  edgeIdentity,
  hitTestCell,
  nearestEdge,
  visibleCells,
  type EditorTool,
  type ProjectState,
  type VisibleCell,
} from "@tessera/core";

export interface RendererInteraction {
  getTool(): EditorTool;
  beginStroke(): void;
  endStroke(): void;
  paintCell(row: number, column: number): void;
  paintEdge(edgeId: string, adjacentCellIds: readonly string[]): void;
}

function colorValue(color: string): { color: number; alpha: number } {
  const normalized = color.replace("#", "");
  const rgb = Number.parseInt(normalized.slice(0, 6), 16);
  const alpha =
    normalized.length === 8
      ? Number.parseInt(normalized.slice(6), 16) / 255
      : 1;
  return { color: rgb, alpha };
}

export class TesseraRenderer {
  readonly #application = new Application();
  readonly #root = new Container();
  readonly #gridGraphics = new Graphics();
  readonly #edgeGraphics = new Graphics();
  readonly #host: HTMLElement;
  readonly #interaction: RendererInteraction;
  #state: Readonly<ProjectState>;
  #visible: VisibleCell[] = [];
  #painting = false;
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
  }

  readonly #canvasLabel: string;

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
    this.#root.addChild(this.#gridGraphics, this.#edgeGraphics);
    this.#application.stage.addChild(this.#root);
    this.#application.canvas.addEventListener(
      "pointerdown",
      this.#onPointerDown,
    );
    this.#application.canvas.addEventListener(
      "pointermove",
      this.#onPointerMove,
    );
    window.addEventListener("pointerup", this.#onPointerUp);
    this.#resizeObserver = new ResizeObserver(() => this.render(this.#state));
    this.#resizeObserver.observe(this.#host);
    this.render(this.#state);
  }

  render(state: Readonly<ProjectState>): void {
    this.#state = state;
    const width = Math.max(1, this.#host.clientWidth);
    const height = Math.max(1, this.#host.clientHeight);
    this.#visible = visibleCells(state.grid, width, height);
    const background = colorValue(state.style.canvasBackground);
    this.#application.renderer.background.color = background.color;
    this.#application.renderer.background.alpha = background.alpha;
    this.#gridGraphics.clear();
    const gridColor = colorValue(state.style.gridColor);
    for (const cell of this.#visible) {
      const override = state.cells.get(cell.cellId);
      const fill = colorValue(
        override?.fillColor ?? state.style.defaultCellColor,
      );
      this.#gridGraphics
        .poly(cell.polygon.flatMap((point) => [point.x, point.y]))
        .fill({ color: fill.color, alpha: fill.alpha })
        .stroke({
          color: gridColor.color,
          alpha: state.style.gridOpacity,
          width: state.style.gridWidth,
        });
    }
    this.#edgeGraphics.clear();
    for (const edge of state.edges.values()) {
      const segment = this.#findEdgeSegment(edge.edgeId);
      if (segment === undefined) continue;
      const stroke = colorValue(edge.strokeColor);
      this.#edgeGraphics
        .moveTo(segment[0].x, segment[0].y)
        .lineTo(segment[1].x, segment[1].y)
        .stroke({
          color: stroke.color,
          alpha: stroke.alpha,
          width: edge.strokeWidth,
        });
    }
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
    window.removeEventListener("pointerup", this.#onPointerUp);
    this.#application.destroy({ removeView: true }, { children: true });
  }

  #pointerPosition(event: PointerEvent): { x: number; y: number } {
    const bounds = this.#application.canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  #interact(event: PointerEvent): void {
    const point = this.#pointerPosition(event);
    const cell = hitTestCell(this.#visible, point);
    if (cell === undefined) return;
    if (this.#interaction.getTool() === "brush") {
      this.#interaction.paintCell(cell.row, cell.column);
      return;
    }
    const side = nearestEdge(cell, point);
    const edge = edgeIdentity(this.#state.grid, cell, side);
    this.#interaction.paintEdge(edge.edgeId, edge.adjacentCellIds);
  }

  readonly #onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    this.#painting = true;
    this.#interaction.beginStroke();
    this.#application.canvas.setPointerCapture(event.pointerId);
    this.#interact(event);
  };

  readonly #onPointerMove = (event: PointerEvent): void => {
    if (this.#painting && this.#interaction.getTool() === "brush")
      this.#interact(event);
  };

  readonly #onPointerUp = (): void => {
    if (this.#painting) this.#interaction.endStroke();
    this.#painting = false;
  };

  #findEdgeSegment(
    edgeId: string,
  ): readonly [{ x: number; y: number }, { x: number; y: number }] | undefined {
    for (const cell of this.#visible) {
      for (let side = 0; side < cell.polygon.length; side += 1) {
        if (edgeIdentity(this.#state.grid, cell, side).edgeId !== edgeId)
          continue;
        const start = cell.polygon[side];
        const end = cell.polygon[(side + 1) % cell.polygon.length];
        if (start !== undefined && end !== undefined) return [start, end];
      }
    }
    return undefined;
  }
}
