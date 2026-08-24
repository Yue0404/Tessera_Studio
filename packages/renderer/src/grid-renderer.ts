import { Container, Graphics } from "pixi.js";
import {
  CHUNK_SIZE,
  cellCenter,
  cellId,
  cellPolygon,
  chunkCoordinateOf,
  chunkKeyOf,
  edgeIdentity,
  edgeSegment,
  type ProjectState,
  type VisibleCell,
} from "@tessera/core";
import { createPixiText, drawPixiStroke } from "./pixi-visual.js";
import { colorValue } from "./render-utils.js";
import { configureRenderLayer } from "./render-layer-order.js";
import { cellLabelStyle as sharedCellLabelStyle } from "./visual-style.js";
import {
  GridChunkBatchCache,
  type GridChunkBatchCacheStats,
} from "./grid-chunk-batch-cache.js";

interface PixiGridChunkBatch {
  readonly cells: Container;
  readonly fills: Graphics;
  readonly labels: Container;
  readonly grid: Graphics;
  readonly edges: Graphics;
}

export interface GridRendererStats extends GridChunkBatchCacheStats {
  readonly visibleChunkCount: number;
  readonly buildDurationMs: number;
  readonly totalRebuiltCount: number;
}

const EMPTY_STATS: GridRendererStats = {
  batchCount: 0,
  rebuiltCount: 0,
  reusedCount: 0,
  evictedCount: 0,
  visibleChunkCount: 0,
  buildDurationMs: 0,
  totalRebuiltCount: 0,
};

function parseChunkKey(key: string): {
  readonly chunkRow: number;
  readonly chunkColumn: number;
} {
  const [row, column] = key.split(":").map(Number);
  if (!Number.isInteger(row) || !Number.isInteger(column)) {
    throw new RangeError("render-chunk-key-invalid");
  }
  return { chunkRow: row ?? 0, chunkColumn: column ?? 0 };
}

function relevantLayerSignature(state: Readonly<ProjectState>): string {
  const layer = (layerId: string) => {
    const value = state.layers.get(layerId);
    return [value?.visible ?? true, value?.opacity ?? 1];
  };
  return JSON.stringify([
    state.grid.type,
    state.grid.width,
    state.grid.height,
    state.grid.cellSize,
    state.style.defaultCellColor,
    state.style.gridColor,
    state.style.gridOpacity,
    state.style.gridWidth,
    layer("tessera.basic.cell-style"),
    layer("tessera.system.grid"),
    layer("tessera.basic.edge-style"),
  ]);
}

/** 每个运行时 64×64 分块只保留固定数量的 Graphics，不为每个地格创建对象。 */
export class GridRenderer {
  readonly #cellLayer = new Container();
  readonly #gridLayer = new Container();
  readonly #edgeLayer = new Container();
  readonly #cache = new GridChunkBatchCache<PixiGridChunkBatch>();
  #cellStore: ProjectState["cells"] | null = null;
  #state: Readonly<ProjectState> | null = null;
  #stats = EMPTY_STATS;
  #totalRebuiltCount = 0;

  constructor(container: Container) {
    container.addChild(this.#cellLayer, this.#gridLayer, this.#edgeLayer);
  }

  get stats(): GridRendererStats {
    return { ...this.#stats };
  }

  render(
    state: Readonly<ProjectState>,
    visible: readonly VisibleCell[],
    gridLineOffsetMapUnits = 0,
  ): void {
    const startedAt = performance.now();
    this.#state = state;
    configureRenderLayer(this.#cellLayer, state, "tessera.basic.cell-style");
    configureRenderLayer(this.#gridLayer, state, "tessera.system.grid");
    this.#gridLayer.position.set(
      gridLineOffsetMapUnits,
      gridLineOffsetMapUnits,
    );
    configureRenderLayer(this.#edgeLayer, state, "tessera.basic.edge-style");
    if (this.#cellStore !== state.cells) {
      this.invalidateAll();
      this.#cellStore = state.cells;
    }

    const visibleChunks = new Map<
      string,
      { readonly chunkRow: number; readonly chunkColumn: number }
    >();
    for (const cell of visible) {
      const coordinate = chunkCoordinateOf(cell);
      visibleChunks.set(chunkKeyOf(coordinate), coordinate);
    }
    const descriptors = [...visibleChunks]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, coordinate]) => ({
        key,
        revision: state.cells.getRuntimeChunkRevision(
          coordinate.chunkRow,
          coordinate.chunkColumn,
        ),
      }));
    const retained = new Set(state.cells.loadedChunkKeys);
    for (const descriptor of descriptors) retained.add(descriptor.key);
    const cacheStats = this.#cache.update(
      descriptors,
      retained,
      relevantLayerSignature(state),
      {
        create: () => this.#createBatch(),
        rebuild: (batch, key) => this.#rebuildBatch(batch, key),
        destroy: (batch) => this.#destroyBatch(batch),
      },
    );
    this.#totalRebuiltCount += cacheStats.rebuiltCount;
    this.#stats = {
      ...cacheStats,
      visibleChunkCount: descriptors.length,
      buildDurationMs: performance.now() - startedAt,
      totalRebuiltCount: this.#totalRebuiltCount,
    };
  }

  invalidateAll(): void {
    this.#cache.clear((batch) => this.#destroyBatch(batch));
  }

  destroy(): void {
    this.invalidateAll();
    this.#cellLayer.destroy();
    this.#gridLayer.destroy();
    this.#edgeLayer.destroy();
  }

  #createBatch(): PixiGridChunkBatch {
    const cells = new Container();
    const fills = new Graphics();
    const labels = new Container();
    const grid = new Graphics();
    const edges = new Graphics();
    cells.addChild(fills, labels);
    this.#cellLayer.addChild(cells);
    this.#gridLayer.addChild(grid);
    this.#edgeLayer.addChild(edges);
    return { cells, fills, labels, grid, edges };
  }

  #destroyBatch(batch: PixiGridChunkBatch): void {
    batch.cells.removeFromParent();
    batch.grid.removeFromParent();
    batch.edges.removeFromParent();
    // Pixi 在传入 children 选项对象时不会默认销毁子 GraphicsContext，需显式释放。
    batch.cells.destroy({ children: true, context: true });
    batch.grid.destroy();
    batch.edges.destroy();
  }

  #rebuildBatch(batch: PixiGridChunkBatch, key: string): void {
    const state = this.#state;
    if (state === null) return;
    batch.fills.clear();
    batch.grid.clear();
    batch.edges.clear();
    for (const child of batch.labels.removeChildren()) child.destroy();
    const coordinate = parseChunkKey(key);
    const rowStart = coordinate.chunkRow * CHUNK_SIZE;
    const columnStart = coordinate.chunkColumn * CHUNK_SIZE;
    const rowEnd = Math.min(state.grid.height, rowStart + CHUNK_SIZE);
    const columnEnd = Math.min(state.grid.width, columnStart + CHUNK_SIZE);
    const cellLayer = state.layers.get("tessera.basic.cell-style");
    const gridLayer = state.layers.get("tessera.system.grid");
    const edgeLayer = state.layers.get("tessera.basic.edge-style");
    const gridColor = colorValue(state.style.gridColor);
    const edgeIds = new Set<string>();
    const gridEdgeIds = new Set<string>();
    const fillGroups = new Map<
      string,
      {
        readonly color: number;
        readonly alpha: number;
        readonly polygons: number[][];
      }
    >();
    for (let row = rowStart; row < rowEnd; row += 1) {
      for (let column = columnStart; column < columnEnd; column += 1) {
        const id = cellId(state.grid.type, row, column);
        const polygon = cellPolygon(state.grid, row, column);
        const override = state.cells.get(id);
        if (cellLayer?.visible !== false) {
          const fill = colorValue(
            override?.fillColor ?? state.style.defaultCellColor,
          );
          const alpha =
            fill.alpha *
            (override?.fillOpacity ?? 1) *
            (cellLayer?.opacity ?? 1);
          const fillKey = `${fill.color}:${alpha}`;
          let group = fillGroups.get(fillKey);
          if (group === undefined) {
            group = { color: fill.color, alpha, polygons: [] };
            fillGroups.set(fillKey, group);
          }
          group.polygons.push(polygon.flatMap((point) => [point.x, point.y]));
          if (override?.label !== undefined) {
            const style = sharedCellLabelStyle(state.grid.cellSize);
            batch.labels.addChild(
              createPixiText(
                cellCenter(state.grid, row, column),
                override.label,
                {
                  ...style,
                  opacity: style.opacity * (cellLayer?.opacity ?? 1),
                },
                null,
              ),
            );
          }
        }
        const sideCount = state.grid.type === "square" ? 4 : 6;
        for (let side = 0; side < sideCount; side += 1) {
          const identity = edgeIdentity(state.grid, { row, column }, side);
          if (identity.adjacentCellIds[0] === id) {
            edgeIds.add(identity.edgeId);
            if (
              gridLayer?.visible !== false &&
              !gridEdgeIds.has(identity.edgeId)
            ) {
              const start = polygon[side];
              const end = polygon[(side + 1) % polygon.length];
              if (start !== undefined && end !== undefined) {
                batch.grid.moveTo(start.x, start.y).lineTo(end.x, end.y);
                gridEdgeIds.add(identity.edgeId);
              }
            }
          }
        }
      }
    }
    // 一个 Graphics 内按样式批量提交几何，避免每格产生独立 GPU 绘制指令。
    for (const group of fillGroups.values()) {
      for (const polygon of group.polygons) batch.fills.poly(polygon);
      batch.fills.fill({ color: group.color, alpha: group.alpha });
    }
    if (gridLayer?.visible !== false && gridEdgeIds.size > 0) {
      batch.grid.stroke({
        color: gridColor.color,
        alpha: state.style.gridOpacity * (gridLayer?.opacity ?? 1),
        width: state.style.gridWidth,
      });
    }
    if (edgeLayer?.visible === false) return;
    for (const edgeId of [...edgeIds].sort()) {
      const edge = state.edges.get(edgeId);
      if (edge === undefined || edge.persistence !== "explicit-style") continue;
      const segment = edgeSegment(
        state.grid,
        edge.edgeId,
        edge.adjacentCellIds,
      );
      if (segment === undefined) continue;
      drawPixiStroke(
        batch.edges,
        segment[0],
        segment[1],
        segment[0],
        segment[1],
        {
          color: edge.strokeColor,
          width: edge.strokeWidth,
          opacity: edge.strokeOpacity * (edgeLayer?.opacity ?? 1),
          lineStyle: edge.lineStyle,
        },
      );
    }
  }
}
