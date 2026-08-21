export type GridType = "square" | "hex-pointy";

export interface MapStyle {
  canvasBackground: string;
  defaultCellColor: string;
  gridColor: string;
  gridOpacity: number;
  gridWidth: number;
  defaultEdgeColor: string;
}

export interface ProjectGrid {
  type: GridType;
  width: number;
  height: number;
  cellSize: number;
}

export interface CellOverride {
  instanceId: string;
  cellId: string;
  row: number;
  column: number;
  fillColor: string;
}

export interface EdgeOverride {
  instanceId: string;
  edgeId: string;
  adjacentCellIds: readonly string[];
  strokeColor: string;
  strokeWidth: number;
}

export interface EdgeLike {
  readonly instanceId: string;
  readonly edgeId: string;
  readonly adjacentCellIds: readonly string[];
  readonly strokeColor: string;
  readonly strokeWidth: number;
}

export interface ProjectState {
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  grid: ProjectGrid;
  style: MapStyle;
  cells: Map<string, CellOverride>;
  edges: EdgeManagerContract;
  revision: number;
}

export interface EdgeManagerContract {
  readonly edgesById: ReadonlyMap<string, EdgeLike>;
  readonly size: number;
  get(edgeId: string): EdgeLike | undefined;
  values(): IterableIterator<EdgeLike>;
  ensure(edge: EdgeOverride): EdgeLike;
  updateStyle(
    edgeId: string,
    strokeColor: string,
    strokeWidth: number,
  ): EdgeLike;
  delete(edgeId: string): boolean;
}

export interface NewProjectInput {
  name: string;
  grid: ProjectGrid;
  style: MapStyle;
}

export interface CellCoordinate {
  row: number;
  column: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface VisibleCell extends CellCoordinate {
  cellId: string;
  polygon: readonly Point[];
  center: Point;
}

export type EditorTool = "brush" | "edge";
