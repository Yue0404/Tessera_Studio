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

export interface CellCoordinate {
  row: number;
  column: number;
}

export interface Point {
  x: number;
  y: number;
}

export type MapPoint = Point;

export interface CellOverride {
  instanceId: string;
  cellId: string;
  row: number;
  column: number;
  fillColor: string;
  fillOpacity: number;
  label?: string;
}

export type ProjectExportScope = "full" | "partial";

/**
 * Project v1 的来源信息由 formats 校验和解释，core 只负责随编辑状态携带。
 * opaqueDocument 必须是已校验文档的深拷贝，禁止业务代码直接修改。
 */
export interface ProjectFormatSource {
  readonly exportScope: ProjectExportScope;
  readonly isComplete: boolean;
  readonly lineage: unknown | null;
  readonly opaqueDocument: unknown | null;
}

export interface EdgeStyle {
  strokeColor: string;
  strokeWidth: number;
  strokeOpacity: number;
  lineStyle: "solid" | "dashed";
}

export interface EdgeOverride extends EdgeStyle {
  instanceId: string;
  edgeId: string;
  adjacentCellIds: readonly string[];
  persistence?: "explicit-style" | "reference-only";
}

export interface EdgeLike extends EdgeStyle {
  readonly instanceId: string;
  readonly edgeId: string;
  readonly adjacentCellIds: readonly string[];
  readonly persistence: "explicit-style" | "reference-only";
}

export type ConnectionEndpoint =
  | { kind: "cell-center"; cellId: string }
  | { kind: "edge-midpoint"; edgeId: string }
  | { kind: "map-point"; point: MapPoint };

export interface ConnectionStyle {
  strokeColor: string;
  strokeWidth: number;
  strokeOpacity: number;
  lineStyle: "solid" | "dashed";
}

interface ConnectionBase {
  connectionId: string;
  layerId: "tessera.basic.connection";
  start: ConnectionEndpoint;
  end: ConnectionEndpoint;
  style: ConnectionStyle;
  label: string | null;
}

export type ConnectionData =
  | (ConnectionBase & {
      kind: "line";
      elementId: "tessera.basic:connection.line";
    })
  | (ConnectionBase & {
      kind: "arrow";
      elementId: "tessera.basic:connection.arrow";
      arrowStart: boolean;
      arrowEnd: boolean;
    });

export type OverlayAnchor =
  { kind: "cell"; cellId: string } | { kind: "edge"; edgeId: string };

export interface MarkerStyle {
  size: number;
  rotation: number;
  opacity: number;
  color: string;
  markerShape: "circle" | "diamond" | "pin";
}

export interface TextStyle {
  fontSize: number;
  rotation: number;
  opacity: number;
  color: string;
  fontWeight: "normal" | "bold";
  align: "left" | "center" | "right";
  backgroundVisible: boolean;
}

interface OverlayBase {
  overlayId: string;
  layerId: "tessera.basic.placed-object" | "tessera.basic.annotation";
  orderInLayer: number;
}

export type OverlayData =
  | (OverlayBase & {
      kind: "anchored-overlay";
      anchor: OverlayAnchor;
      overlayType: "marker";
      elementId: "tessera.basic:marker";
      style: MarkerStyle;
      text: null;
    })
  | (OverlayBase & {
      kind: "free-overlay";
      point: MapPoint;
      overlayType: "marker";
      elementId: "tessera.basic:marker";
      style: MarkerStyle;
      text: null;
    })
  | (OverlayBase & {
      kind: "anchored-overlay";
      anchor: OverlayAnchor;
      overlayType: "text";
      elementId: "tessera.basic:text";
      style: TextStyle;
      text: string;
    })
  | (OverlayBase & {
      kind: "free-overlay";
      point: MapPoint;
      overlayType: "text";
      elementId: "tessera.basic:text";
      style: TextStyle;
      text: string;
    });

export interface FixedLayerState {
  layerId: string;
  moduleVersion: string;
  zIndex: number;
  visible: boolean;
  locked: boolean;
  opacity: number;
  runtimeStatus?: "available" | "missing";
  allowedKinds: readonly (
    "cell" | "edge" | "overlay" | "connection" | "domain-group"
  )[];
}

export interface SparseChunkBucket {
  readonly chunkRow: number;
  readonly chunkColumn: number;
  readonly cellIds: ReadonlySet<string>;
  readonly ownedEdgeIds: ReadonlySet<string>;
  readonly ownedOverlayIds: ReadonlySet<string>;
  readonly ownedDomainGroupIds: ReadonlySet<string>;
  readonly dirty: boolean;
}

export interface SparseCellStoreContract {
  readonly size: number;
  readonly bucketCount: number;
  get(cellId: string): CellOverride | undefined;
  set(cellId: string, value: CellOverride): this;
  delete(cellId: string): boolean;
  values(): IterableIterator<CellOverride>;
  buckets(): IterableIterator<SparseChunkBucket>;
  assignEdge(edgeId: string, ownerCellId: string): void;
  unassignEdge(edgeId: string, ownerCellId: string): void;
  assignOverlay(overlayId: string, ownerCellId: string): void;
  unassignOverlay(overlayId: string, ownerCellId: string): void;
  touchRuntimeChunk(chunkRow: number, chunkColumn: number): void;
  evictRuntimeChunks(maxLoaded: number): readonly string[];
  markAllClean(): void;
  readonly loadedChunkKeys: readonly string[];
}

export interface EdgeManagerContract {
  readonly edgesById: ReadonlyMap<string, EdgeLike>;
  readonly size: number;
  get(edgeId: string): EdgeLike | undefined;
  values(): IterableIterator<EdgeLike>;
  ensure(edge: EdgeOverride): EdgeLike;
  updateStyle(edgeId: string, style: EdgeStyle): EdgeLike;
  setPersistence(
    edgeId: string,
    persistence: "explicit-style" | "reference-only",
  ): EdgeLike;
  delete(edgeId: string): boolean;
}

export interface ConnectionManagerContract {
  readonly connectionsById: ReadonlyMap<string, ConnectionData>;
  readonly size: number;
  get(connectionId: string): ConnectionData | undefined;
  values(): IterableIterator<ConnectionData>;
  add(connection: ConnectionData): ConnectionData;
  replace(connection: ConnectionData): ConnectionData;
  delete(connectionId: string): boolean;
}

export interface OverlayManagerContract {
  readonly overlaysById: ReadonlyMap<string, OverlayData>;
  readonly size: number;
  get(overlayId: string): OverlayData | undefined;
  values(): IterableIterator<OverlayData>;
  add(overlay: OverlayData): OverlayData;
  replace(overlay: OverlayData): OverlayData;
  delete(overlayId: string): boolean;
}

export interface ProjectState {
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  grid: ProjectGrid;
  style: MapStyle;
  cells: SparseCellStoreContract;
  edges: EdgeManagerContract;
  connections: ConnectionManagerContract;
  overlays: OverlayManagerContract;
  layers: ReadonlyMap<string, FixedLayerState>;
  readonly formatSource: ProjectFormatSource;
  revision: number;
  lastTransactionId: string | null;
}

export interface NewProjectInput {
  name: string;
  grid: ProjectGrid;
  style: MapStyle;
}

export interface VisibleCell extends CellCoordinate {
  cellId: string;
  polygon: readonly Point[];
  center: Point;
}

export type EditorTool =
  "select" | "pan" | "brush" | "edge" | "marker" | "connection" | "box-select";

export type ToolPhase =
  | "idle"
  | "ready"
  | "dragging"
  | "choosing-start"
  | "previewing-end"
  | "committing"
  | "box-selecting";

export interface ToolState {
  tool: EditorTool;
  phase: ToolPhase;
  startPoint: MapPoint | null;
  previewPoint: MapPoint | null;
  startCellId: string | null;
}

export type SelectedObject =
  | { kind: "cell"; id: string }
  | { kind: "edge"; id: string }
  | { kind: "overlay"; id: string }
  | { kind: "connection"; id: string };
