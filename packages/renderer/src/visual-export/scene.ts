import {
  cellCenter,
  cellId,
  cellPolygon,
  clipSegmentToRect,
  edgeSegment,
  markerLabelFontSize,
  markerLabelPoint,
  parseCellId,
  pointInRect,
  type MapRect,
  type Point,
  type ProjectGrid,
} from "@tessera/core";
import {
  arrowPolygon,
  arrowShaftSegment,
  arrowSize,
  cellLabelStyle,
  conservativeTextBoundsSize,
  connectionLabelStyle,
  rotatedRectBounds,
  textBackgroundColor,
} from "../visual-style.js";
import type {
  SnapshotConnection,
  SnapshotEdge,
  SnapshotOverlay,
  TextPrimitive,
  VisualExportPlan,
  VisualExportRequest,
  VisualExportSnapshot,
  VisualPrimitive,
} from "./types.js";
import {
  SVG_STRUCTURAL_NODE_COUNT,
  svgPrimitiveNodeCount,
  svgTextNodeCount,
} from "./svg-node-count.js";
import {
  canvasPrimitiveWorkUnits,
  canvasTextWorkUnits,
} from "./canvas-renderer.js";

export interface SceneEstimate {
  readonly derivedCells: number;
  readonly primitives: number;
}

interface CellWindow {
  readonly rowStart: number;
  readonly rowEnd: number;
  readonly columnStart: number;
  readonly columnEnd: number;
  readonly count: number;
}

function compareCodePoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compareVisualPrimitive(
  left: VisualPrimitive,
  right: VisualPrimitive,
): number {
  return (
    left.zIndex - right.zIndex ||
    compareCodePoint(left.layerId, right.layerId) ||
    left.orderInLayer - right.orderInLayer ||
    compareCodePoint(left.stableId, right.stableId) ||
    left.partRank - right.partRank
  );
}

function intersects(left: MapRect, right: MapRect): boolean {
  return !(
    left.maxX < right.minX ||
    left.minX > right.maxX ||
    left.maxY < right.minY ||
    left.minY > right.maxY
  );
}

function paintVisible(color: string, opacity: number): boolean {
  const normalized = color.replace(/^#/u, "");
  const colorOpacity =
    normalized.length === 8
      ? Number.parseInt(normalized.slice(6), 16) / 255
      : 1;
  return Number.isFinite(opacity) && opacity * colorOpacity > 0;
}

function primitiveVisible(primitive: VisualPrimitive): boolean {
  switch (primitive.kind) {
    case "polygon":
      return paintVisible(primitive.fillColor, primitive.opacity);
    case "outline":
    case "stroke":
      return paintVisible(primitive.strokeColor, primitive.opacity);
    case "marker":
      return paintVisible(primitive.color, primitive.opacity);
    case "text":
      return (
        paintVisible(primitive.color, primitive.opacity) ||
        (primitive.backgroundColor !== null &&
          paintVisible(primitive.backgroundColor, primitive.opacity))
      );
  }
}

function includeBounds(current: MapRect | null, addition: MapRect): MapRect {
  if (current === null) return { ...addition };
  return {
    minX: Math.min(current.minX, addition.minX),
    minY: Math.min(current.minY, addition.minY),
    maxX: Math.max(current.maxX, addition.maxX),
    maxY: Math.max(current.maxY, addition.maxY),
  };
}

function pointsBounds(points: readonly Point[]): MapRect {
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

function expandedSegmentBounds(
  start: Point,
  end: Point,
  expansion: number,
): MapRect {
  return {
    minX: Math.min(start.x, end.x) - expansion,
    minY: Math.min(start.y, end.y) - expansion,
    maxX: Math.max(start.x, end.x) + expansion,
    maxY: Math.max(start.y, end.y) + expansion,
  };
}

export function mapVisualBounds(grid: Readonly<ProjectGrid>): MapRect {
  if (grid.type === "square") {
    return {
      minX: 0,
      minY: 0,
      maxX: grid.width * grid.cellSize,
      maxY: grid.height * grid.cellSize,
    };
  }
  return {
    minX: 0,
    minY: 0,
    maxX:
      grid.cellSize * Math.sqrt(3) * (grid.width + (grid.height > 1 ? 0.5 : 0)),
    maxY: grid.cellSize * (1.5 * grid.height + 0.5),
  };
}

function candidateCellWindow(
  grid: Readonly<ProjectGrid>,
  bounds: Readonly<MapRect>,
): CellWindow {
  const rowStep = grid.type === "square" ? grid.cellSize : 1.5 * grid.cellSize;
  const columnStep =
    grid.type === "square" ? grid.cellSize : Math.sqrt(3) * grid.cellSize;
  const rowStart = Math.max(0, Math.floor(bounds.minY / rowStep) - 2);
  const rowEnd = Math.min(
    grid.height - 1,
    Math.ceil(bounds.maxY / rowStep) + 2,
  );
  const columnStart = Math.max(0, Math.floor(bounds.minX / columnStep) - 2);
  const columnEnd = Math.min(
    grid.width - 1,
    Math.ceil(bounds.maxX / columnStep) + 2,
  );
  const rows = Math.max(0, rowEnd - rowStart + 1);
  const columns = Math.max(0, columnEnd - columnStart + 1);
  return {
    rowStart,
    rowEnd,
    columnStart,
    columnEnd,
    count: rows === 0 || columns === 0 ? 0 : rows * columns,
  };
}

function* cellsInBounds(
  grid: Readonly<ProjectGrid>,
  bounds: Readonly<MapRect>,
) {
  const window = candidateCellWindow(grid, bounds);
  for (let row = window.rowStart; row <= window.rowEnd; row += 1) {
    for (
      let column = window.columnStart;
      column <= window.columnEnd;
      column += 1
    ) {
      const polygon = cellPolygon(grid, row, column);
      if (!intersects(pointsBounds(polygon), bounds)) continue;
      yield {
        row,
        column,
        cellId: cellId(grid.type, row, column),
        polygon,
        center: cellCenter(grid, row, column),
      };
    }
  }
}

function layer(snapshot: VisualExportSnapshot, layerId: string) {
  return snapshot.layers.find((candidate) => candidate.layerId === layerId);
}

function edgeById(
  snapshot: VisualExportSnapshot,
): ReadonlyMap<string, SnapshotEdge> {
  return new Map(snapshot.edges.map((edge) => [edge.edgeId, edge]));
}

function endpointPoint(
  snapshot: VisualExportSnapshot,
  edges: ReadonlyMap<string, SnapshotEdge>,
  endpoint: SnapshotConnection["start"],
): Point | undefined {
  if (endpoint.kind === "map-point") return endpoint.point;
  if (endpoint.kind === "cell-center") {
    const coordinate = parseCellId(endpoint.cellId);
    return cellCenter(snapshot.grid, coordinate.row, coordinate.column);
  }
  const edge = edges.get(endpoint.edgeId);
  if (edge === undefined) return undefined;
  const segment = edgeSegment(snapshot.grid, edge.edgeId, edge.adjacentCellIds);
  return segment === undefined
    ? undefined
    : {
        x: (segment[0].x + segment[1].x) / 2,
        y: (segment[0].y + segment[1].y) / 2,
      };
}

function overlayPoint(
  snapshot: VisualExportSnapshot,
  edges: ReadonlyMap<string, SnapshotEdge>,
  overlay: SnapshotOverlay,
): Point | undefined {
  if (overlay.kind === "free-overlay") return overlay.point;
  if (overlay.anchor.kind === "cell") {
    const coordinate = parseCellId(overlay.anchor.cellId);
    return cellCenter(snapshot.grid, coordinate.row, coordinate.column);
  }
  const edge = edges.get(overlay.anchor.edgeId);
  if (edge === undefined) return undefined;
  const segment = edgeSegment(snapshot.grid, edge.edgeId, edge.adjacentCellIds);
  return segment === undefined
    ? undefined
    : {
        x: (segment[0].x + segment[1].x) / 2,
        y: (segment[0].y + segment[1].y) / 2,
      };
}

function textBounds(primitive: TextPrimitive): MapRect {
  const size = conservativeTextBoundsSize(
    primitive.text,
    primitive.fontSize,
    primitive.backgroundColor !== null,
    primitive.wrapWidth,
  );
  return rotatedRectBounds(
    primitive.point,
    size.width,
    size.height,
    primitive.rotation,
  );
}

export function primitiveBounds(primitive: VisualPrimitive): MapRect {
  switch (primitive.kind) {
    case "polygon":
      return pointsBounds(primitive.points);
    case "outline": {
      const bounds = pointsBounds(primitive.points);
      const margin = primitive.strokeWidth / 2;
      return {
        minX: bounds.minX - margin,
        minY: bounds.minY - margin,
        maxX: bounds.maxX + margin,
        maxY: bounds.maxY + margin,
      };
    }
    case "stroke":
      return expandedSegmentBounds(
        primitive.start,
        primitive.end,
        primitive.strokeWidth / 2,
      );
    case "marker": {
      const radius = primitive.size / 2;
      return {
        minX: primitive.point.x - radius,
        minY: primitive.point.y - radius,
        maxX: primitive.point.x + radius,
        maxY: primitive.point.y + radius,
      };
    }
    case "text":
      return textBounds(primitive);
  }
}

function connectionPrimitives(
  snapshot: VisualExportSnapshot,
  edges: ReadonlyMap<string, SnapshotEdge>,
  connection: SnapshotConnection,
  bounds: Readonly<MapRect> | null,
): VisualPrimitive[] {
  const connectionLayer = layer(snapshot, connection.layerId);
  if (connectionLayer?.visible === false) return [];
  const start = endpointPoint(snapshot, edges, connection.start);
  const end = endpointPoint(snapshot, edges, connection.end);
  if (start === undefined || end === undefined) return [];
  const size =
    connection.kind === "arrow"
      ? arrowSize(connection.style.strokeWidth, snapshot.grid.cellSize)
      : 0;
  const shaft =
    connection.kind === "arrow"
      ? arrowShaftSegment(
          start,
          end,
          connection.arrowStart,
          connection.arrowEnd,
          size,
        )
      : ([start, end] as const);
  const clipped =
    shaft === null
      ? null
      : bounds === null
        ? shaft
        : clipSegmentToRect(shaft[0], shaft[1], bounds);
  const arrowVisible =
    connection.kind === "arrow" &&
    ((connection.arrowStart &&
      (bounds === null || pointInRect(start, bounds))) ||
      (connection.arrowEnd && (bounds === null || pointInRect(end, bounds))));
  if (clipped === null && !arrowVisible) return [];
  const opacity =
    connection.style.strokeOpacity * (connectionLayer?.opacity ?? 1);
  if (!paintVisible(connection.style.strokeColor, opacity)) return [];
  const zIndex = connectionLayer?.zIndex ?? 0;
  const result: VisualPrimitive[] = [];
  if (shaft !== null && clipped !== null)
    result.push({
      kind: "stroke",
      layerId: connection.layerId,
      zIndex,
      orderInLayer: 0,
      stableId: connection.connectionId,
      partRank: 0,
      originalStart: { ...shaft[0] },
      originalEnd: { ...shaft[1] },
      start: { ...clipped[0] },
      end: { ...clipped[1] },
      strokeColor: connection.style.strokeColor,
      strokeWidth: connection.style.strokeWidth,
      opacity,
      lineStyle: connection.style.lineStyle,
      ...(connection.kind === "arrow" ? { lineCap: "butt" as const } : {}),
    });
  if (connection.kind === "arrow") {
    if (
      connection.arrowStart &&
      (bounds === null || pointInRect(start, bounds))
    ) {
      result.push({
        kind: "polygon",
        layerId: connection.layerId,
        zIndex,
        orderInLayer: 0,
        stableId: connection.connectionId,
        partRank: 1,
        points: arrowPolygon(end, start, size),
        fillColor: connection.style.strokeColor,
        opacity,
      });
    }
    if (connection.arrowEnd && (bounds === null || pointInRect(end, bounds))) {
      result.push({
        kind: "polygon",
        layerId: connection.layerId,
        zIndex,
        orderInLayer: 0,
        stableId: connection.connectionId,
        partRank: 2,
        points: arrowPolygon(start, end, size),
        fillColor: connection.style.strokeColor,
        opacity,
      });
    }
  }
  if (connection.label !== null) {
    const labelStyle = connectionLabelStyle(
      snapshot.grid.cellSize,
      connection.style.strokeColor,
      opacity,
    );
    const label: TextPrimitive = {
      kind: "text",
      layerId: connection.layerId,
      zIndex,
      orderInLayer: 0,
      stableId: connection.connectionId,
      partRank: 3,
      point: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
      text: connection.label,
      ...labelStyle,
      backgroundColor: null,
    };
    if (bounds === null || intersects(textBounds(label), bounds)) {
      result.push(label);
    }
  }
  return result;
}

function overlayPrimitives(
  snapshot: VisualExportSnapshot,
  edges: ReadonlyMap<string, SnapshotEdge>,
  overlay: SnapshotOverlay,
): readonly VisualPrimitive[] {
  const overlayLayer = layer(snapshot, overlay.layerId);
  if (overlayLayer?.visible === false) return [];
  const point = overlayPoint(snapshot, edges, overlay);
  if (point === undefined) return [];
  const opacity = overlay.style.opacity * (overlayLayer?.opacity ?? 1);
  const base = {
    layerId: overlay.layerId,
    zIndex: overlayLayer?.zIndex ?? 0,
    orderInLayer: overlay.orderInLayer,
    stableId: overlay.overlayId,
    partRank: 0,
    point: { ...point },
  };
  if (overlay.overlayType === "marker") {
    const marker: VisualPrimitive = {
      ...base,
      kind: "marker",
      shape: overlay.style.markerShape,
      size: overlay.style.size,
      rotation: overlay.style.rotation,
      color: overlay.style.color,
      opacity,
    };
    const result: VisualPrimitive[] = primitiveVisible(marker) ? [marker] : [];
    if (overlay.label !== null) {
      const fontSize = markerLabelFontSize(overlay.style.size);
      const label: VisualPrimitive = {
        ...base,
        kind: "text",
        point: markerLabelPoint(point, overlay.style.size, fontSize),
        text: overlay.label,
        fontSize,
        fontWeight: "normal",
        align: "center",
        rotation: 0,
        color: overlay.style.color,
        opacity,
        backgroundColor: null,
        stableId: `${overlay.overlayId}:label`,
        partRank: 1,
      };
      if (primitiveVisible(label)) result.push(label);
    }
    return result;
  }
  const primitive: VisualPrimitive = {
    ...base,
    kind: "text",
    text: overlay.text,
    fontSize: overlay.style.fontSize,
    fontWeight: overlay.style.fontWeight,
    align: overlay.style.align,
    rotation: overlay.style.rotation,
    color: overlay.style.color,
    opacity,
    backgroundColor: overlay.style.backgroundVisible
      ? textBackgroundColor(snapshot.style.canvasBackground)
      : null,
  };
  return primitiveVisible(primitive) ? [primitive] : [];
}

function* cellPrimitives(
  snapshot: VisualExportSnapshot,
  bounds: Readonly<MapRect>,
  target: "cell" | "grid",
): Generator<VisualPrimitive> {
  const cellLayer = layer(snapshot, "tessera.basic.cell-style");
  const gridLayer = layer(snapshot, "tessera.system.grid");
  const drawCells = target === "cell" && cellLayer?.visible !== false;
  const drawGrid = target === "grid" && gridLayer?.visible !== false;
  if (!drawCells && !drawGrid) return;
  const overrides = new Map(snapshot.cells.map((cell) => [cell.cellId, cell]));
  for (const cell of cellsInBounds(snapshot.grid, bounds)) {
    const override = overrides.get(cell.cellId);
    if (drawCells) {
      const fillPrimitive: VisualPrimitive = {
        kind: "polygon",
        layerId: "tessera.basic.cell-style",
        zIndex: cellLayer?.zIndex ?? 500,
        orderInLayer: 0,
        stableId: cell.cellId,
        partRank: 0,
        points: cell.polygon.map((point) => ({ ...point })),
        fillColor: override?.fillColor ?? snapshot.style.defaultCellColor,
        opacity: (override?.fillOpacity ?? 1) * (cellLayer?.opacity ?? 1),
      };
      if (primitiveVisible(fillPrimitive)) yield fillPrimitive;
      if (override?.label !== null && override?.label !== undefined) {
        const labelPrimitive: VisualPrimitive = {
          kind: "text",
          layerId: "tessera.basic.cell-style",
          zIndex: cellLayer?.zIndex ?? 500,
          orderInLayer: 0,
          stableId: cell.cellId,
          partRank: 1,
          point: { ...cell.center },
          text: override.label,
          ...cellLabelStyle(snapshot.grid.cellSize),
          opacity: cellLayer?.opacity ?? 1,
          backgroundColor: null,
        };
        if (primitiveVisible(labelPrimitive)) yield labelPrimitive;
      }
    }
    if (drawGrid) {
      const gridPrimitive: VisualPrimitive = {
        kind: "outline",
        layerId: "tessera.system.grid",
        zIndex: gridLayer?.zIndex ?? 900,
        orderInLayer: 0,
        stableId: cell.cellId,
        partRank: 0,
        points: cell.polygon.map((point) => ({ ...point })),
        closed: true,
        strokeColor: snapshot.style.gridColor,
        strokeWidth: snapshot.style.gridWidth,
        opacity: snapshot.style.gridOpacity * (gridLayer?.opacity ?? 1),
        lineStyle: "solid",
      };
      if (primitiveVisible(gridPrimitive)) yield gridPrimitive;
    }
  }
}

function* edgePrimitives(
  snapshot: VisualExportSnapshot,
  bounds: Readonly<MapRect>,
): Generator<VisualPrimitive> {
  const edgeLayer = layer(snapshot, "tessera.basic.edge-style");
  if (edgeLayer?.visible === false) return;
  for (const edge of snapshot.edges) {
    if (edge.persistence !== "explicit-style") continue;
    const segment = edgeSegment(
      snapshot.grid,
      edge.edgeId,
      edge.adjacentCellIds,
    );
    if (segment === undefined) continue;
    const clipped = clipSegmentToRect(segment[0], segment[1], bounds);
    if (clipped === null) continue;
    const primitive: VisualPrimitive = {
      kind: "stroke",
      layerId: "tessera.basic.edge-style",
      zIndex: edgeLayer?.zIndex ?? 1500,
      orderInLayer: 0,
      stableId: edge.edgeId,
      partRank: 0,
      originalStart: { ...segment[0] },
      originalEnd: { ...segment[1] },
      start: { ...clipped[0] },
      end: { ...clipped[1] },
      strokeColor: edge.strokeColor,
      strokeWidth: edge.strokeWidth,
      opacity: edge.strokeOpacity * (edgeLayer?.opacity ?? 1),
      lineStyle: edge.lineStyle,
    };
    if (primitiveVisible(primitive)) yield primitive;
  }
}

export function* iterateVisualPrimitives(
  plan: VisualExportPlan,
): Generator<VisualPrimitive> {
  const { snapshot, bounds } = plan;
  const edges = edgeById(snapshot);
  for (const currentLayer of snapshot.layers) {
    if (currentLayer.visible === false) continue;
    switch (currentLayer.layerId) {
      case "tessera.basic.cell-style":
        yield* cellPrimitives(snapshot, bounds, "cell");
        break;
      case "tessera.system.grid":
        if (plan.request.showGrid) {
          yield* cellPrimitives(snapshot, bounds, "grid");
        }
        break;
      case "tessera.basic.edge-style":
        yield* edgePrimitives(snapshot, bounds);
        break;
      case "tessera.basic.connection":
        for (const connection of snapshot.connections) {
          yield* connectionPrimitives(snapshot, edges, connection, bounds);
        }
        break;
      case "tessera.basic.placed-object":
      case "tessera.basic.annotation":
        for (const overlay of snapshot.overlays) {
          if (overlay.layerId !== currentLayer.layerId) continue;
          for (const primitive of overlayPrimitives(snapshot, edges, overlay))
            if (intersects(primitiveBounds(primitive), bounds)) yield primitive;
        }
        break;
    }
    const extensionPrimitives = snapshot.extensions
      .flatMap((extension) => extension.descriptors)
      .filter(
        (primitive) =>
          primitive.layerId === currentLayer.layerId &&
          primitiveVisible(primitive) &&
          intersects(primitiveBounds(primitive), bounds),
      )
      .sort(compareVisualPrimitive);
    yield* extensionPrimitives;
  }
}

export function visibleContentBounds(
  snapshot: VisualExportSnapshot,
): MapRect | null {
  const edges = edgeById(snapshot);
  let bounds: MapRect | null = null;
  const cellLayer = layer(snapshot, "tessera.basic.cell-style");
  if (cellLayer?.visible !== false) {
    for (const cell of snapshot.cells) {
      const layerOpacity = cellLayer?.opacity ?? 1;
      if (paintVisible(cell.fillColor, cell.fillOpacity * layerOpacity)) {
        bounds = includeBounds(
          bounds,
          pointsBounds(cellPolygon(snapshot.grid, cell.row, cell.column)),
        );
      }
      if (cell.label !== null) {
        const style = cellLabelStyle(snapshot.grid.cellSize);
        if (paintVisible(style.color, layerOpacity)) {
          const size = conservativeTextBoundsSize(
            cell.label,
            style.fontSize,
            false,
          );
          bounds = includeBounds(
            bounds,
            rotatedRectBounds(
              cellCenter(snapshot.grid, cell.row, cell.column),
              size.width,
              size.height,
              style.rotation,
            ),
          );
        }
      }
    }
  }
  const edgeLayer = layer(snapshot, "tessera.basic.edge-style");
  if (edgeLayer?.visible !== false) {
    for (const edge of snapshot.edges) {
      if (edge.persistence !== "explicit-style") continue;
      const segment = edgeSegment(
        snapshot.grid,
        edge.edgeId,
        edge.adjacentCellIds,
      );
      if (
        segment !== undefined &&
        paintVisible(
          edge.strokeColor,
          edge.strokeOpacity * (edgeLayer?.opacity ?? 1),
        )
      ) {
        bounds = includeBounds(
          bounds,
          expandedSegmentBounds(segment[0], segment[1], edge.strokeWidth / 2),
        );
      }
    }
  }
  for (const connection of snapshot.connections) {
    for (const primitive of connectionPrimitives(
      snapshot,
      edges,
      connection,
      null,
    )) {
      bounds = includeBounds(bounds, primitiveBounds(primitive));
    }
  }
  for (const overlay of snapshot.overlays) {
    for (const primitive of overlayPrimitives(snapshot, edges, overlay)) {
      bounds = includeBounds(bounds, primitiveBounds(primitive));
    }
  }
  for (const extension of snapshot.extensions) {
    for (const primitive of extension.descriptors) {
      if (
        layer(snapshot, primitive.layerId)?.visible !== false &&
        primitiveVisible(primitive)
      ) {
        bounds = includeBounds(bounds, primitiveBounds(primitive));
      }
    }
  }
  return bounds;
}

export function estimateVisualScene(
  snapshot: VisualExportSnapshot,
  bounds: Readonly<MapRect>,
  request: VisualExportRequest,
): SceneEstimate {
  const cellLayerVisible =
    layer(snapshot, "tessera.basic.cell-style")?.visible !== false;
  const gridVisible =
    request.showGrid &&
    layer(snapshot, "tessera.system.grid")?.visible !== false;
  const window = candidateCellWindow(snapshot.grid, bounds);
  const derivedCells = cellLayerVisible || gridVisible ? window.count : 0;
  const primitiveCost = (primitive: VisualPrimitive) =>
    request.format === "svg"
      ? svgPrimitiveNodeCount(primitive)
      : canvasPrimitiveWorkUnits(primitive);
  let primitives = request.format === "svg" ? SVG_STRUCTURAL_NODE_COUNT : 0;
  if (request.background.kind === "color") primitives += 1;
  if (cellLayerVisible) primitives += window.count;
  if (gridVisible) primitives += window.count;
  if (cellLayerVisible) {
    for (const cell of snapshot.cells) {
      if (
        cell.label !== null &&
        intersects(
          pointsBounds(cellPolygon(snapshot.grid, cell.row, cell.column)),
          bounds,
        )
      ) {
        primitives +=
          request.format === "svg"
            ? svgTextNodeCount(cell.label, snapshot.grid.cellSize * 0.3, false)
            : canvasTextWorkUnits(
                cell.label,
                snapshot.grid.cellSize * 0.3,
                false,
              );
      }
    }
  }
  if (layer(snapshot, "tessera.basic.edge-style")?.visible !== false) {
    for (const edge of snapshot.edges) {
      if (edge.persistence !== "explicit-style") continue;
      const segment = edgeSegment(
        snapshot.grid,
        edge.edgeId,
        edge.adjacentCellIds,
      );
      if (
        segment !== undefined &&
        clipSegmentToRect(segment[0], segment[1], bounds) !== null
      ) {
        primitives += 1;
      }
    }
  }
  const edges = edgeById(snapshot);
  for (const connection of snapshot.connections) {
    for (const primitive of connectionPrimitives(
      snapshot,
      edges,
      connection,
      bounds,
    )) {
      primitives += primitiveCost(primitive);
    }
  }
  for (const overlay of snapshot.overlays) {
    for (const primitive of overlayPrimitives(snapshot, edges, overlay))
      if (intersects(primitiveBounds(primitive), bounds))
        primitives += primitiveCost(primitive);
  }
  for (const extension of snapshot.extensions) {
    for (const primitive of extension.descriptors) {
      if (
        layer(snapshot, primitive.layerId)?.visible !== false &&
        intersects(primitiveBounds(primitive), bounds)
      ) {
        primitives += primitiveCost(primitive);
      }
    }
  }
  return { derivedCells, primitives };
}
