import { Container, Graphics, Texture } from "pixi.js";
import {
  cellCenter,
  clipSegmentToRect,
  distanceToSegment,
  domainGroupGeometry,
  edgeIdentity,
  edgeSegment,
  markerLabelBounds,
  markerLabelFontSize,
  markerLabelPoint,
  parseCellId,
  pointInRotatedBounds,
  pointInRect,
  projectConnectionEndpointPoint,
  rotatedRectBounds,
  SparseSpatialIndex,
  unionMapRects,
  visibleCellsInRect,
  type MapRect,
  type ModuleRuntimeInstance,
  type ProjectState,
  type VisibleCell,
} from "@tessera/core";
import {
  createPixiMarker,
  createPixiCellPattern,
  createPixiImageMarker,
  createPixiResourcePlaceholderCell,
  createPixiResourcePlaceholderMarker,
  createPixiText,
  drawPixiArrow,
  drawPixiStroke,
} from "./pixi-visual.js";
import { configureRenderLayer } from "./render-layer-order.js";
import {
  MARKER_MAX_CSS_PX,
  markerMapSize,
  overlayBufferedViewport,
  textMapSize,
  textWrapMapSize,
} from "./overlay-visibility.js";
import { colorValue } from "./render-utils.js";
import {
  arrowShaftSegment,
  conservativeTextBoundsSize,
} from "./visual-style.js";
import type {
  GenericModuleResourceIdentity,
  GenericModuleResourceState,
} from "./generic-module-assets.js";
import { genericModuleResourceKey } from "./generic-module-assets.js";
import { GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER } from "./generic-module-assets.js";
import {
  domainMapShapeContainsPoint,
  domainMapShapeGeometry,
  domainMapShapeIntersectsRect,
  type DomainMapShape,
} from "./domain-map-shape.js";

export type GenericModuleVisualDescriptor =
  | {
      readonly kind: "cell-style";
      readonly fillColor: string;
      readonly fillOpacity: number;
      readonly pattern?: {
        readonly identity: GenericModuleResourceIdentity;
        readonly scale: number;
      };
    }
  | {
      readonly kind: "edge-style";
      readonly strokeColor: string;
      readonly strokeOpacity: number;
      readonly strokeWidth: number;
      readonly lineStyle: "solid" | "dashed";
      readonly dashPattern?: readonly number[];
      readonly lineCap?: "butt" | "round" | "square";
    }
  | {
      readonly kind: "marker";
      readonly shape: "circle" | "diamond" | "pin";
      readonly color: string;
      readonly opacity: number;
      readonly displaySize: number;
      readonly rotation: number;
      readonly label?: string | null;
      readonly image?: GenericModuleResourceIdentity;
    }
  | {
      readonly kind: "text";
      readonly text: string;
      readonly color: string;
      readonly opacity: number;
      readonly fontSize: number;
      readonly fontWeight: "normal" | "bold";
      readonly align: "left" | "center" | "right";
      readonly rotation: number;
      readonly backgroundColor: string | null;
      readonly wrapWidth: number | null;
      readonly font?: GenericModuleResourceIdentity;
    }
  | {
      readonly kind: "connection";
      readonly strokeColor: string;
      readonly strokeOpacity: number;
      readonly strokeWidth: number;
      readonly arrowStart: boolean;
      readonly arrowEnd: boolean;
      readonly arrowSize: number;
      readonly lineStyle: "solid" | "dashed";
      readonly dashPattern?: readonly number[];
      readonly lineCap?: "butt" | "round" | "square";
    }
  | {
      readonly kind: "map-shape";
      readonly shape: DomainMapShape;
      readonly fillColor: string;
      readonly fillOpacity: number;
      readonly strokeColor: string;
      readonly strokeOpacity: number;
      readonly strokeWidth: number;
      readonly sizeScale: number;
      readonly rotation: number;
    };

export interface GenericModuleVisualResolver {
  resolve(
    instance: Readonly<ModuleRuntimeInstance>,
  ): GenericModuleVisualDescriptor | null;
  readonly resources?: {
    resolve(
      identity: GenericModuleResourceIdentity,
    ): GenericModuleResourceState<ImageBitmap, FontFace> | undefined;
    request(identity: GenericModuleResourceIdentity): void;
  };
}

export interface RenderedGenericOverlayHitCandidate {
  readonly instance: ModuleRuntimeInstance;
  readonly descriptor: Extract<
    GenericModuleVisualDescriptor,
    { kind: "marker" | "text" }
  >;
  readonly anchor: { readonly x: number; readonly y: number };
  readonly bounds: MapRect;
}

export function genericOverlayPoint(
  state: Readonly<ProjectState>,
  instance: Extract<ModuleRuntimeInstance, { kind: "overlay" }>,
) {
  if (instance.objectKind === "free-overlay") return instance.point;
  const anchor = instance.anchor;
  if (anchor === undefined) return undefined;
  if (anchor.kind === "cell") {
    const coordinate = parseCellId(anchor.cellId);
    return cellCenter(state.grid, coordinate.row, coordinate.column);
  }
  const edge =
    state.edges.get(anchor.edgeId) ??
    state.moduleInstances
      .valuesForCarrier("edge", anchor.edgeId)
      .find((candidate) => candidate.kind === "edge");
  if (edge === undefined) return undefined;
  const segment = edgeSegment(state.grid, edge.edgeId, edge.adjacentCellIds);
  return segment === undefined
    ? undefined
    : {
        x: (segment[0].x + segment[1].x) / 2,
        y: (segment[0].y + segment[1].y) / 2,
      };
}

function compareCodePoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareInstanceOrder(
  state: Readonly<ProjectState>,
  left: ModuleRuntimeInstance,
  right: ModuleRuntimeInstance,
): number {
  const leftLayer = state.layers.get(left.layerId);
  const rightLayer = state.layers.get(right.layerId);
  const leftOrder = left.kind === "overlay" ? left.orderInLayer : 0;
  const rightOrder = right.kind === "overlay" ? right.orderInLayer : 0;
  return (
    (leftLayer?.zIndex ?? 0) - (rightLayer?.zIndex ?? 0) ||
    compareCodePoint(left.layerId, right.layerId) ||
    leftOrder - rightOrder ||
    compareCodePoint(left.elementId, right.elementId) ||
    compareCodePoint(left.instanceId, right.instanceId)
  );
}

export function genericConnectionPoints(
  state: Readonly<ProjectState>,
  instance: Extract<ModuleRuntimeInstance, { kind: "connection" }>,
) {
  const start = projectConnectionEndpointPoint(state, instance.start);
  const end = projectConnectionEndpointPoint(state, instance.end);
  return start === undefined || end === undefined
    ? undefined
    : ([start, end] as const);
}

function genericTextContainsPoint(
  descriptor: Extract<GenericModuleVisualDescriptor, { kind: "text" }>,
  anchor: { readonly x: number; readonly y: number },
  point: { readonly x: number; readonly y: number },
  zoom: number,
): boolean {
  const fontSize = textMapSize(descriptor.fontSize, zoom);
  const wrapWidth =
    descriptor.wrapWidth === null
      ? undefined
      : textWrapMapSize(descriptor.wrapWidth, zoom);
  const size = conservativeTextBoundsSize(
    descriptor.text,
    fontSize,
    descriptor.backgroundColor !== null,
    wrapWidth,
  );
  return pointInRotatedBounds(
    point,
    anchor,
    size.width,
    size.height,
    descriptor.rotation,
  );
}

function genericMarkerContainsPoint(
  descriptor: Extract<GenericModuleVisualDescriptor, { kind: "marker" }>,
  anchor: { readonly x: number; readonly y: number },
  point: { readonly x: number; readonly y: number },
  zoom: number,
): boolean {
  const markerSize = markerMapSize(descriptor.displaySize, zoom);
  if (Math.hypot(point.x - anchor.x, point.y - anchor.y) <= markerSize / 2)
    return true;
  if (descriptor.label == null) return false;
  const fontSize = textMapSize(
    markerLabelFontSize(descriptor.displaySize),
    zoom,
  );
  const bounds = markerLabelBounds(
    anchor,
    descriptor.label,
    markerSize,
    fontSize,
  );
  const center = markerLabelPoint(anchor, markerSize, fontSize);
  return pointInRotatedBounds(
    point,
    center,
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY,
    0,
  );
}

function genericOverlayHitCandidate(
  instance: ModuleRuntimeInstance,
  descriptor: Extract<
    GenericModuleVisualDescriptor,
    { kind: "marker" | "text" }
  >,
  anchor: { readonly x: number; readonly y: number },
  zoom: number,
): RenderedGenericOverlayHitCandidate {
  if (descriptor.kind === "marker") {
    const radius = markerMapSize(descriptor.displaySize, zoom) / 2;
    const markerBounds = {
      minX: anchor.x - radius,
      minY: anchor.y - radius,
      maxX: anchor.x + radius,
      maxY: anchor.y + radius,
    };
    const fontSize = textMapSize(
      markerLabelFontSize(descriptor.displaySize),
      zoom,
    );
    return {
      instance,
      descriptor,
      anchor,
      bounds:
        descriptor.label == null
          ? markerBounds
          : unionMapRects(
              markerBounds,
              markerLabelBounds(anchor, descriptor.label, radius * 2, fontSize),
            ),
    };
  }
  const fontSize = textMapSize(descriptor.fontSize, zoom);
  const wrapWidth =
    descriptor.wrapWidth === null
      ? undefined
      : textWrapMapSize(descriptor.wrapWidth, zoom);
  const size = conservativeTextBoundsSize(
    descriptor.text,
    fontSize,
    descriptor.backgroundColor !== null,
    wrapWidth,
  );
  return {
    instance,
    descriptor,
    anchor,
    bounds: rotatedRectBounds(
      anchor,
      size.width,
      size.height,
      descriptor.rotation,
    ),
  };
}

function renderedOverlayCandidateContainsPoint(
  candidate: RenderedGenericOverlayHitCandidate,
  point: { readonly x: number; readonly y: number },
  zoom: number,
): boolean {
  return candidate.descriptor.kind === "marker"
    ? genericMarkerContainsPoint(
        candidate.descriptor,
        candidate.anchor,
        point,
        zoom,
      )
    : genericTextContainsPoint(
        candidate.descriptor,
        candidate.anchor,
        point,
        zoom,
      );
}

export function visibleGenericOverlays(
  state: Readonly<ProjectState>,
  viewport: MapRect,
  visibleCells: readonly VisibleCell[],
): readonly Extract<ModuleRuntimeInstance, { kind: "overlay" }>[] {
  const byId = new Map<
    string,
    Extract<ModuleRuntimeInstance, { kind: "overlay" }>
  >();
  for (const instance of state.moduleInstances.queryFreeOverlays(viewport))
    byId.set(instance.instanceId, instance);
  for (const cell of visibleCells) {
    for (const instance of state.moduleInstances.valuesForOverlayAnchor(
      "cell",
      cell.cellId,
    ))
      byId.set(instance.instanceId, instance);
    const sideCount = state.grid.type === "square" ? 4 : 6;
    for (let side = 0; side < sideCount; side += 1) {
      const edgeId = edgeIdentity(
        state.grid,
        { row: cell.row, column: cell.column },
        side,
      ).edgeId;
      for (const instance of state.moduleInstances.valuesForOverlayAnchor(
        "edge",
        edgeId,
      ))
        byId.set(instance.instanceId, instance);
    }
  }
  return [...byId.values()].sort((left, right) => {
    const leftLayer = state.layers.get(left.layerId);
    const rightLayer = state.layers.get(right.layerId);
    return (
      (leftLayer?.zIndex ?? 0) - (rightLayer?.zIndex ?? 0) ||
      compareCodePoint(left.layerId, right.layerId) ||
      left.orderInLayer - right.orderInLayer ||
      compareCodePoint(left.elementId, right.elementId) ||
      compareCodePoint(left.instanceId, right.instanceId)
    );
  });
}

export function hitTestGenericModules(
  state: Readonly<ProjectState>,
  resolver: GenericModuleVisualResolver,
  point: { readonly x: number; readonly y: number },
  cell: VisibleCell | undefined,
  zoom = 1,
  renderedOverlayCandidates?: readonly RenderedGenericOverlayHitCandidate[],
): readonly string[] {
  // 最大 CSS 尺寸换算回地图单位，避免低缩放下漏掉仍可见的超大事实尺寸实例。
  const queryRadius = Math.max(
    MARKER_MAX_CSS_PX / Math.max(zoom, 0.01),
    state.grid.cellSize * 2,
  );
  const queryRect = {
    minX: point.x - queryRadius,
    minY: point.y - queryRadius,
    maxX: point.x + queryRadius,
    maxY: point.y + queryRadius,
  };
  const candidates = new Map<string, ModuleRuntimeInstance>();
  if (renderedOverlayCandidates === undefined) {
    const overlays = visibleGenericOverlays(
      state,
      queryRect,
      cell === undefined ? [] : [cell],
    );
    for (const instance of overlays) {
      if (state.layers.get(instance.layerId)?.visible === false) continue;
      const descriptor = resolver.resolve(instance);
      const anchor = genericOverlayPoint(state, instance);
      if (anchor === undefined) continue;
      if (
        descriptor?.kind === "marker" &&
        genericMarkerContainsPoint(descriptor, anchor, point, zoom)
      )
        candidates.set(instance.instanceId, instance);
      else if (
        descriptor?.kind === "text" &&
        genericTextContainsPoint(descriptor, anchor, point, zoom)
      )
        candidates.set(instance.instanceId, instance);
    }
  } else {
    for (const candidate of renderedOverlayCandidates) {
      if (
        state.layers.get(candidate.instance.layerId)?.visible !== false &&
        renderedOverlayCandidateContainsPoint(candidate, point, zoom)
      )
        candidates.set(candidate.instance.instanceId, candidate.instance);
    }
  }
  for (const connection of state.moduleInstances.queryConnections({
    minX: point.x - queryRadius,
    minY: point.y - queryRadius,
    maxX: point.x + queryRadius,
    maxY: point.y + queryRadius,
  })) {
    if (state.layers.get(connection.layerId)?.visible === false) continue;
    const descriptor = resolver.resolve(connection);
    const points = genericConnectionPoints(state, connection);
    if (
      descriptor?.kind === "connection" &&
      points !== undefined &&
      distanceToSegment(point, points[0], points[1]) <=
        Math.max(8, descriptor.strokeWidth / 2 + 3)
    )
      candidates.set(connection.instanceId, connection);
  }
  if (cell !== undefined) {
    const side = state.grid.type === "square" ? 4 : 6;
    for (let index = 0; index < side; index += 1) {
      const identity = edgeIdentity(state.grid, cell, index);
      const segment = edgeSegment(
        state.grid,
        identity.edgeId,
        identity.adjacentCellIds,
      );
      if (
        segment === undefined ||
        distanceToSegment(point, segment[0], segment[1]) > 8
      )
        continue;
      for (const edge of state.moduleInstances.valuesForCarrier(
        "edge",
        identity.edgeId,
      )) {
        if (
          edge.kind === "edge" &&
          state.layers.get(edge.layerId)?.visible !== false &&
          resolver.resolve(edge)?.kind === "edge-style"
        )
          candidates.set(edge.instanceId, edge);
      }
    }
    for (const cellInstance of state.moduleInstances.valuesForCarrier(
      "cell",
      cell.cellId,
    )) {
      if (
        cellInstance.kind === "cell" &&
        state.layers.get(cellInstance.layerId)?.visible !== false &&
        resolver.resolve(cellInstance)?.kind === "cell-style"
      )
        candidates.set(cellInstance.instanceId, cellInstance);
    }
  }
  for (const instance of state.moduleInstances.queryDomainGroups(queryRect)) {
    if (state.layers.get(instance.layerId)?.visible === false) continue;
    const descriptor = resolver.resolve(instance);
    if (descriptor === null) continue;
    const geometry = domainGroupGeometry(state.grid, instance.memberCellIds);
    if (
      (descriptor.kind === "cell-style" &&
        cell !== undefined &&
        geometry.memberCellIds.includes(cell.cellId)) ||
      (descriptor.kind === "edge-style" &&
        geometry.boundaryEdges.some((edge) => {
          const segment = edgeSegment(
            state.grid,
            edge.edgeId,
            edge.adjacentCellIds,
          );
          return (
            segment !== undefined &&
            distanceToSegment(point, segment[0], segment[1]) <=
              Math.max(8, descriptor.strokeWidth / 2 + 3)
          );
        })) ||
      (descriptor.kind === "marker" &&
        genericMarkerContainsPoint(descriptor, geometry.center, point, zoom)) ||
      (descriptor.kind === "text" &&
        genericTextContainsPoint(descriptor, geometry.center, point, zoom)) ||
      (descriptor.kind === "map-shape" &&
        domainMapShapeContainsPoint(
          domainMapShapeGeometry(
            state,
            instance,
            descriptor.shape,
            descriptor.sizeScale,
            descriptor.rotation,
          ),
          point,
        ))
    )
      candidates.set(instance.instanceId, instance);
  }
  return [...candidates.values()]
    .sort((left, right) => compareInstanceOrder(state, right, left))
    .map((instance) => instance.instanceId);
}

/** 兼容单选调用方，返回有序候选中的最上层实例。 */
export function hitTestGenericModule(
  state: Readonly<ProjectState>,
  resolver: GenericModuleVisualResolver,
  point: { readonly x: number; readonly y: number },
  cell: VisibleCell | undefined,
  zoom = 1,
  renderedOverlayCandidates?: readonly RenderedGenericOverlayHitCandidate[],
): string | null {
  return (
    hitTestGenericModules(
      state,
      resolver,
      point,
      cell,
      zoom,
      renderedOverlayCandidates,
    )[0] ?? null
  );
}

export function boxSelectGenericModules(
  state: Readonly<ProjectState>,
  resolver: GenericModuleVisualResolver,
  rect: MapRect,
  visibleCells: readonly VisibleCell[],
): readonly string[] {
  const ids = new Set<string>();
  for (const cell of visibleCells) {
    if (!pointInRect(cell.center, rect)) continue;
    for (const instance of state.moduleInstances.valuesForCarrier(
      "cell",
      cell.cellId,
    ))
      if (
        instance.kind === "cell" &&
        state.layers.get(instance.layerId)?.visible !== false &&
        resolver.resolve(instance)?.kind === "cell-style"
      )
        ids.add(instance.instanceId);
  }
  const edgeIds = new Set<string>();
  const sideCount = state.grid.type === "square" ? 4 : 6;
  for (const cell of visibleCells)
    for (let side = 0; side < sideCount; side += 1)
      edgeIds.add(edgeIdentity(state.grid, cell, side).edgeId);
  for (const edgeId of edgeIds) {
    for (const instance of state.moduleInstances.valuesForCarrier(
      "edge",
      edgeId,
    )) {
      if (instance.kind !== "edge") continue;
      const segment = edgeSegment(
        state.grid,
        instance.edgeId,
        instance.adjacentCellIds,
      );
      if (
        segment !== undefined &&
        clipSegmentToRect(segment[0], segment[1], rect) !== null &&
        state.layers.get(instance.layerId)?.visible !== false &&
        resolver.resolve(instance)?.kind === "edge-style"
      )
        ids.add(instance.instanceId);
    }
  }
  for (const overlay of visibleGenericOverlays(state, rect, visibleCells)) {
    if (
      state.layers.get(overlay.layerId)?.visible === false ||
      resolver.resolve(overlay) === null
    )
      continue;
    const point = genericOverlayPoint(state, overlay);
    if (point !== undefined && pointInRect(point, rect))
      ids.add(overlay.instanceId);
  }
  for (const connection of state.moduleInstances.queryConnections(rect)) {
    if (
      state.layers.get(connection.layerId)?.visible === false ||
      resolver.resolve(connection)?.kind !== "connection"
    )
      continue;
    const points = genericConnectionPoints(state, connection);
    if (
      points !== undefined &&
      clipSegmentToRect(points[0], points[1], rect) !== null
    )
      ids.add(connection.instanceId);
  }
  for (const instance of state.moduleInstances.queryDomainGroups(rect)) {
    if (state.layers.get(instance.layerId)?.visible === false) continue;
    const descriptor = resolver.resolve(instance);
    if (descriptor === null) continue;
    const geometry = domainGroupGeometry(state.grid, instance.memberCellIds);
    if (
      (descriptor.kind === "cell-style" &&
        geometry.memberCellIds.some((cellId) => {
          const coordinate = parseCellId(cellId);
          return pointInRect(
            cellCenter(state.grid, coordinate.row, coordinate.column),
            rect,
          );
        })) ||
      (descriptor.kind === "edge-style" &&
        geometry.boundaryEdges.some((edge) => {
          const segment = edgeSegment(
            state.grid,
            edge.edgeId,
            edge.adjacentCellIds,
          );
          return (
            segment !== undefined &&
            clipSegmentToRect(segment[0], segment[1], rect) !== null
          );
        })) ||
      ((descriptor.kind === "marker" || descriptor.kind === "text") &&
        pointInRect(geometry.center, rect)) ||
      (descriptor.kind === "map-shape" &&
        domainMapShapeIntersectsRect(
          domainMapShapeGeometry(
            state,
            instance,
            descriptor.shape,
            descriptor.sizeScale,
            descriptor.rotation,
          ),
          rect,
        ))
    )
      ids.add(instance.instanceId);
  }
  return [...ids].sort(compareCodePoint);
}

/** 通用模块只绘制视口内稀疏实例，不遍历或重建无关基础地图对象。 */
export class GenericModuleRenderer {
  readonly #containers: Container[] = [];
  readonly #parent: Container;
  readonly #resolver: GenericModuleVisualResolver;
  readonly #requestedResources = new Set<string>();
  readonly #textures = new Map<
    string,
    { readonly handle: ImageBitmap; readonly texture: Texture }
  >();
  readonly #overlayHitCandidates = new Map<
    string,
    RenderedGenericOverlayHitCandidate
  >();
  readonly #overlayHitIndex = new SparseSpatialIndex(128);
  #resourceStats = { requested: 0, ready: 0, placeholder: 0 };

  #cacheOverlayHitCandidate(
    instance: ModuleRuntimeInstance,
    descriptor: Extract<
      GenericModuleVisualDescriptor,
      { kind: "marker" | "text" }
    >,
    anchor: { readonly x: number; readonly y: number },
    zoom: number,
  ): void {
    const candidate = genericOverlayHitCandidate(
      instance,
      descriptor,
      anchor,
      zoom,
    );
    this.#overlayHitCandidates.set(instance.instanceId, candidate);
    this.#overlayHitIndex.upsert(instance.instanceId, candidate.bounds);
  }

  #destroyContainers(): void {
    for (const container of this.#containers.splice(0)) {
      this.#parent.removeChild(container);
      // GraphicsContext/TextStyle 属于本轮 display tree；图片 Texture 属于 renderer 缓存，逐帧重绘不得销毁。
      container.destroy({
        children: true,
        context: true,
        style: true,
        texture: false,
        textureSource: false,
      });
    }
  }

  constructor(parent: Container, resolver: GenericModuleVisualResolver) {
    this.#parent = parent;
    this.#resolver = resolver;
  }

  get resourceStats() {
    return this.#resourceStats;
  }

  #resourceState(identity: GenericModuleResourceIdentity) {
    const resources = this.#resolver.resources;
    if (resources === undefined) return undefined;
    const key = genericModuleResourceKey(identity);
    let state = resources.resolve(identity);
    if (state === undefined && !this.#requestedResources.has(key)) {
      this.#requestedResources.add(key);
      resources.request(identity);
      state = resources.resolve(identity);
    }
    return state;
  }

  #imageTexture(
    state: GenericModuleResourceState<ImageBitmap, FontFace> | undefined,
  ) {
    if (state?.status !== "ready" || state.resource.kind !== "image")
      return undefined;
    const current = this.#textures.get(state.key);
    if (current?.handle === state.resource.handle)
      return { resource: state.resource, texture: current.texture };
    current?.texture.destroy(true);
    const texture = Texture.from(state.resource.handle, true);
    this.#textures.set(state.key, {
      handle: state.resource.handle,
      texture,
    });
    return { resource: state.resource, texture };
  }

  render(
    state: Readonly<ProjectState>,
    viewport: MapRect,
    visibleCells: readonly VisibleCell[],
    zoom: number,
  ): void {
    const requested = new Set<string>();
    const ready = new Set<string>();
    const placeholder = new Set<string>();
    const observeResource = (
      identity: GenericModuleResourceIdentity,
      state: GenericModuleResourceState<ImageBitmap, FontFace> | undefined,
    ) => {
      const key = genericModuleResourceKey(identity);
      requested.add(key);
      if (state?.status === "ready") ready.add(key);
      else placeholder.add(key);
    };
    this.#destroyContainers();
    this.#overlayHitCandidates.clear();
    this.#overlayHitIndex.clear();
    const layerContainers = new Map<string, Container>();
    const layerContainer = (layerId: string) => {
      const existing = layerContainers.get(layerId);
      if (existing !== undefined) return existing;
      const container = new Container();
      configureRenderLayer(container, state, layerId);
      layerContainers.set(layerId, container);
      this.#containers.push(container);
      this.#parent.addChild(container);
      return container;
    };

    for (const cell of visibleCells) {
      const instances = state.moduleInstances
        .valuesForCarrier("cell", cell.cellId)
        .filter((instance) => instance.kind === "cell")
        .sort(
          (left, right) =>
            compareCodePoint(left.elementId, right.elementId) ||
            compareCodePoint(left.instanceId, right.instanceId),
        );
      for (const instance of instances) {
        if (instance.kind !== "cell") continue;
        const layer = state.layers.get(instance.layerId);
        if (layer?.visible === false) continue;
        const descriptor = this.#resolver.resolve(instance);
        if (descriptor?.kind !== "cell-style") continue;
        const fill = colorValue(descriptor.fillColor);
        const container = layerContainer(instance.layerId);
        container.addChild(
          new Graphics()
            .poly(cell.polygon.flatMap((point) => [point.x, point.y]))
            .fill({
              color: fill.color,
              alpha:
                fill.alpha * descriptor.fillOpacity * (layer?.opacity ?? 1),
            }),
        );
        if (descriptor.pattern !== undefined) {
          const state = this.#resourceState(descriptor.pattern.identity);
          observeResource(descriptor.pattern.identity, state);
          const image = this.#imageTexture(state);
          container.addChild(
            image === undefined
              ? createPixiResourcePlaceholderCell(
                  cell.polygon,
                  descriptor.fillOpacity * (layer?.opacity ?? 1),
                )
              : createPixiCellPattern(
                  cell.polygon,
                  image.texture,
                  descriptor.pattern.scale,
                  descriptor.fillOpacity * (layer?.opacity ?? 1),
                ),
          );
        }
      }
    }

    const visibleEdgeIds = new Set<string>();
    for (const cell of visibleCells) {
      const sideCount = state.grid.type === "square" ? 4 : 6;
      for (let side = 0; side < sideCount; side += 1)
        visibleEdgeIds.add(edgeIdentity(state.grid, cell, side).edgeId);
    }
    for (const edgeId of visibleEdgeIds) {
      const edge = state.edges.get(edgeId);
      if (edge === undefined) continue;
      const segment = edgeSegment(
        state.grid,
        edge.edgeId,
        edge.adjacentCellIds,
      );
      if (segment === undefined) continue;
      const clipped = clipSegmentToRect(segment[0], segment[1], viewport);
      if (clipped === null) continue;
      const instances = state.moduleInstances
        .valuesForCarrier("edge", edgeId)
        .filter((instance) => instance.kind === "edge")
        .sort((left, right) => compareInstanceOrder(state, left, right));
      for (const instance of instances) {
        if (instance.kind !== "edge") continue;
        const layer = state.layers.get(instance.layerId);
        if (layer?.visible === false) continue;
        const descriptor = this.#resolver.resolve(instance);
        if (descriptor?.kind !== "edge-style") continue;
        const graphics = new Graphics();
        drawPixiStroke(
          graphics,
          segment[0],
          segment[1],
          clipped[0],
          clipped[1],
          {
            color: descriptor.strokeColor,
            width: descriptor.strokeWidth,
            opacity: descriptor.strokeOpacity * (layer?.opacity ?? 1),
            lineStyle: descriptor.lineStyle,
            ...(descriptor.dashPattern === undefined
              ? {}
              : { dashPattern: descriptor.dashPattern }),
            ...(descriptor.lineCap === undefined
              ? {}
              : { lineCap: descriptor.lineCap }),
          },
        );
        layerContainer(instance.layerId).addChild(graphics);
      }
    }

    const overlayViewport = overlayBufferedViewport(viewport, zoom);
    const overlayVisibleCells = visibleCellsInRect(
      state.grid,
      overlayViewport.minX,
      overlayViewport.minY,
      overlayViewport.maxX,
      overlayViewport.maxY,
    );
    for (const instance of visibleGenericOverlays(
      state,
      overlayViewport,
      overlayVisibleCells,
    )) {
      const layer = state.layers.get(instance.layerId);
      if (layer?.visible === false) continue;
      const descriptor = this.#resolver.resolve(instance);
      const point = genericOverlayPoint(state, instance);
      if (point === undefined || !pointInRect(point, overlayViewport)) continue;
      if (descriptor?.kind === "marker") {
        const displaySize = markerMapSize(descriptor.displaySize, zoom);
        this.#cacheOverlayHitCandidate(instance, descriptor, point, zoom);
        const state =
          descriptor.image === undefined
            ? undefined
            : this.#resourceState(descriptor.image);
        if (descriptor.image !== undefined)
          observeResource(descriptor.image, state);
        const image = this.#imageTexture(state);
        const item = new Container();
        item.addChild(
          descriptor.image === undefined
            ? createPixiMarker(
                point,
                descriptor.shape,
                displaySize,
                descriptor.rotation,
                descriptor.color,
                descriptor.opacity * (layer?.opacity ?? 1),
              )
            : image === undefined
              ? createPixiResourcePlaceholderMarker(
                  point,
                  displaySize,
                  descriptor.rotation,
                  descriptor.opacity * (layer?.opacity ?? 1),
                )
              : createPixiImageMarker(
                  point,
                  image.texture,
                  image.resource.width,
                  image.resource.height,
                  displaySize,
                  descriptor.rotation,
                  descriptor.opacity * (layer?.opacity ?? 1),
                ),
        );
        if (descriptor.label != null) {
          const fontSize = textMapSize(
            markerLabelFontSize(descriptor.displaySize),
            zoom,
          );
          item.addChild(
            createPixiText(
              markerLabelPoint(point, displaySize, fontSize),
              descriptor.label,
              {
                fontSize,
                rotation: 0,
                opacity: descriptor.opacity * (layer?.opacity ?? 1),
                color: descriptor.color,
                fontWeight: "normal",
                align: "center",
                backgroundVisible: false,
              },
              null,
            ),
          );
        }
        layerContainer(instance.layerId).addChild(item);
      } else if (descriptor?.kind === "text") {
        const fontSize = textMapSize(descriptor.fontSize, zoom);
        this.#cacheOverlayHitCandidate(instance, descriptor, point, zoom);
        const state =
          descriptor.font === undefined
            ? undefined
            : this.#resourceState(descriptor.font);
        if (descriptor.font !== undefined)
          observeResource(descriptor.font, state);
        const fontFamily =
          state?.status === "ready" && state.resource.kind === "font"
            ? state.resource.family
            : undefined;
        layerContainer(instance.layerId).addChild(
          createPixiText(
            point,
            descriptor.text,
            {
              color:
                descriptor.font !== undefined && fontFamily === undefined
                  ? GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER.secondaryColor
                  : descriptor.color,
              opacity: descriptor.opacity * (layer?.opacity ?? 1),
              fontSize,
              fontWeight: descriptor.fontWeight,
              align: descriptor.align,
              rotation: descriptor.rotation,
              backgroundVisible: descriptor.backgroundColor !== null,
              ...(fontFamily === undefined ? {} : { fontFamily }),
              ...(descriptor.wrapWidth === null
                ? {}
                : { wrapWidth: textWrapMapSize(descriptor.wrapWidth, zoom) }),
            },
            descriptor.font !== undefined && fontFamily === undefined
              ? GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER.textBackgroundColor
              : descriptor.backgroundColor,
          ),
        );
      }
    }

    const visibleCellById = new Map(
      visibleCells.map((cell) => [cell.cellId, cell] as const),
    );
    const domainGroups = [
      ...state.moduleInstances.queryDomainGroups(overlayViewport),
    ].sort((left, right) => compareInstanceOrder(state, left, right));
    for (const instance of domainGroups) {
      if (instance.kind !== "domain-group") continue;
      const layer = state.layers.get(instance.layerId);
      if (layer?.visible === false) continue;
      const descriptor = this.#resolver.resolve(instance);
      if (descriptor === null) continue;
      const geometry = domainGroupGeometry(state.grid, instance.memberCellIds);
      const opacity = layer?.opacity ?? 1;
      const container = layerContainer(instance.layerId);
      if (descriptor.kind === "cell-style") {
        for (const cellId of geometry.memberCellIds) {
          const visible = visibleCellById.get(cellId);
          if (visible === undefined) continue;
          const fill = colorValue(descriptor.fillColor);
          container.addChild(
            new Graphics()
              .poly(visible.polygon.flatMap((point) => [point.x, point.y]))
              .fill({
                color: fill.color,
                alpha: fill.alpha * descriptor.fillOpacity * opacity,
              }),
          );
          if (descriptor.pattern !== undefined) {
            const resource = this.#resourceState(descriptor.pattern.identity);
            observeResource(descriptor.pattern.identity, resource);
            const image = this.#imageTexture(resource);
            container.addChild(
              image === undefined
                ? createPixiResourcePlaceholderCell(
                    visible.polygon,
                    descriptor.fillOpacity * opacity,
                  )
                : createPixiCellPattern(
                    visible.polygon,
                    image.texture,
                    descriptor.pattern.scale,
                    descriptor.fillOpacity * opacity,
                  ),
            );
          }
        }
      } else if (descriptor.kind === "edge-style") {
        for (const edge of geometry.boundaryEdges) {
          const segment = edgeSegment(
            state.grid,
            edge.edgeId,
            edge.adjacentCellIds,
          );
          if (segment === undefined) continue;
          const clipped = clipSegmentToRect(segment[0], segment[1], viewport);
          if (clipped === null) continue;
          const graphics = new Graphics();
          drawPixiStroke(
            graphics,
            segment[0],
            segment[1],
            clipped[0],
            clipped[1],
            {
              color: descriptor.strokeColor,
              width: descriptor.strokeWidth,
              opacity: descriptor.strokeOpacity * opacity,
              lineStyle: descriptor.lineStyle,
              ...(descriptor.dashPattern === undefined
                ? {}
                : { dashPattern: descriptor.dashPattern }),
              ...(descriptor.lineCap === undefined
                ? {}
                : { lineCap: descriptor.lineCap }),
            },
          );
          container.addChild(graphics);
        }
      } else if (descriptor.kind === "map-shape") {
        const shape = domainMapShapeGeometry(
          state,
          instance,
          descriptor.shape,
          descriptor.sizeScale,
          descriptor.rotation,
        );
        if (!domainMapShapeIntersectsRect(shape, overlayViewport)) continue;
        const fill = colorValue(descriptor.fillColor);
        const stroke = colorValue(descriptor.strokeColor);
        container.addChild(
          new Graphics()
            .poly(shape.points.flatMap((point) => [point.x, point.y]))
            .fill({
              color: fill.color,
              alpha: fill.alpha * descriptor.fillOpacity * opacity,
            })
            .stroke({
              color: stroke.color,
              alpha: stroke.alpha * descriptor.strokeOpacity * opacity,
              width: descriptor.strokeWidth,
            }),
        );
      } else if (
        descriptor.kind === "marker" &&
        pointInRect(geometry.center, overlayViewport)
      ) {
        const displaySize = markerMapSize(descriptor.displaySize, zoom);
        this.#cacheOverlayHitCandidate(
          instance,
          descriptor,
          geometry.center,
          zoom,
        );
        const resource =
          descriptor.image === undefined
            ? undefined
            : this.#resourceState(descriptor.image);
        if (descriptor.image !== undefined)
          observeResource(descriptor.image, resource);
        const image = this.#imageTexture(resource);
        const item = new Container();
        item.addChild(
          descriptor.image === undefined
            ? createPixiMarker(
                geometry.center,
                descriptor.shape,
                displaySize,
                descriptor.rotation,
                descriptor.color,
                descriptor.opacity * opacity,
              )
            : image === undefined
              ? createPixiResourcePlaceholderMarker(
                  geometry.center,
                  displaySize,
                  descriptor.rotation,
                  descriptor.opacity * opacity,
                )
              : createPixiImageMarker(
                  geometry.center,
                  image.texture,
                  image.resource.width,
                  image.resource.height,
                  displaySize,
                  descriptor.rotation,
                  descriptor.opacity * opacity,
                ),
        );
        if (descriptor.label != null) {
          const fontSize = textMapSize(
            markerLabelFontSize(descriptor.displaySize),
            zoom,
          );
          item.addChild(
            createPixiText(
              markerLabelPoint(geometry.center, displaySize, fontSize),
              descriptor.label,
              {
                fontSize,
                rotation: 0,
                opacity: descriptor.opacity * opacity,
                color: descriptor.color,
                fontWeight: "normal",
                align: "center",
                backgroundVisible: false,
              },
              null,
            ),
          );
        }
        container.addChild(item);
      } else if (
        descriptor.kind === "text" &&
        pointInRect(geometry.center, overlayViewport)
      ) {
        const fontSize = textMapSize(descriptor.fontSize, zoom);
        this.#cacheOverlayHitCandidate(
          instance,
          descriptor,
          geometry.center,
          zoom,
        );
        const resource =
          descriptor.font === undefined
            ? undefined
            : this.#resourceState(descriptor.font);
        if (descriptor.font !== undefined)
          observeResource(descriptor.font, resource);
        const fontFamily =
          resource?.status === "ready" && resource.resource.kind === "font"
            ? resource.resource.family
            : undefined;
        container.addChild(
          createPixiText(
            geometry.center,
            descriptor.text,
            {
              color:
                descriptor.font !== undefined && fontFamily === undefined
                  ? GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER.secondaryColor
                  : descriptor.color,
              opacity: descriptor.opacity * opacity,
              fontSize,
              fontWeight: descriptor.fontWeight,
              align: descriptor.align,
              rotation: descriptor.rotation,
              backgroundVisible: descriptor.backgroundColor !== null,
              ...(fontFamily === undefined ? {} : { fontFamily }),
              ...(descriptor.wrapWidth === null
                ? {}
                : { wrapWidth: textWrapMapSize(descriptor.wrapWidth, zoom) }),
            },
            descriptor.font !== undefined && fontFamily === undefined
              ? GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER.textBackgroundColor
              : descriptor.backgroundColor,
          ),
        );
      }
    }

    for (const instance of [
      ...state.moduleInstances.queryConnections(viewport),
    ].sort((left, right) => compareInstanceOrder(state, left, right))) {
      const layer = state.layers.get(instance.layerId);
      if (layer?.visible === false) continue;
      const descriptor = this.#resolver.resolve(instance);
      const points = genericConnectionPoints(state, instance);
      if (descriptor?.kind !== "connection" || points === undefined) continue;
      const shaft = arrowShaftSegment(
        points[0],
        points[1],
        descriptor.arrowStart,
        descriptor.arrowEnd,
        descriptor.arrowSize,
      );
      const clipped =
        shaft === null ? null : clipSegmentToRect(shaft[0], shaft[1], viewport);
      const arrowVisible =
        (descriptor.arrowStart && pointInRect(points[0], viewport)) ||
        (descriptor.arrowEnd && pointInRect(points[1], viewport));
      if (clipped === null && !arrowVisible) continue;
      const opacity = descriptor.strokeOpacity * (layer?.opacity ?? 1);
      const graphics = new Graphics();
      if (shaft !== null && clipped !== null)
        drawPixiStroke(graphics, shaft[0], shaft[1], clipped[0], clipped[1], {
          color: descriptor.strokeColor,
          width: descriptor.strokeWidth,
          opacity,
          lineStyle: descriptor.lineStyle,
          ...(descriptor.dashPattern === undefined
            ? {}
            : { dashPattern: descriptor.dashPattern }),
          ...(descriptor.arrowStart || descriptor.arrowEnd
            ? { lineCap: "butt" as const }
            : descriptor.lineCap === undefined
              ? {}
              : { lineCap: descriptor.lineCap }),
        });
      if (descriptor.arrowStart)
        drawPixiArrow(
          graphics,
          points[1],
          points[0],
          descriptor.arrowSize,
          descriptor.strokeColor,
          opacity,
        );
      if (descriptor.arrowEnd)
        drawPixiArrow(
          graphics,
          points[0],
          points[1],
          descriptor.arrowSize,
          descriptor.strokeColor,
          opacity,
        );
      layerContainer(instance.layerId).addChild(graphics);
      if (instance.label !== null)
        layerContainer(instance.layerId).addChild(
          createPixiText(
            {
              x: (points[0].x + points[1].x) / 2,
              y: (points[0].y + points[1].y) / 2,
            },
            instance.label,
            {
              color: descriptor.strokeColor,
              opacity,
              fontSize: textMapSize(
                Math.max(10, state.grid.cellSize * 0.35),
                zoom,
              ),
              fontWeight: "normal",
              align: "center",
              rotation: 0,
              backgroundVisible: false,
            },
            null,
          ),
        );
    }
    this.#resourceStats = {
      requested: requested.size,
      ready: ready.size,
      placeholder: placeholder.size,
    };
  }

  destroy(): void {
    this.#destroyContainers();
    for (const { texture } of this.#textures.values()) texture.destroy(true);
    this.#textures.clear();
    this.#requestedResources.clear();
    this.#overlayHitCandidates.clear();
    this.#overlayHitIndex.clear();
  }

  hitTest(
    state: Readonly<ProjectState>,
    point: { readonly x: number; readonly y: number },
    cell: VisibleCell | undefined,
    zoom = 1,
  ): string | null {
    return this.hitTests(state, point, cell, zoom)[0] ?? null;
  }

  hitTests(
    state: Readonly<ProjectState>,
    point: { readonly x: number; readonly y: number },
    cell: VisibleCell | undefined,
    zoom = 1,
  ): readonly string[] {
    const pointRect = {
      minX: point.x,
      minY: point.y,
      maxX: point.x,
      maxY: point.y,
    };
    const renderedCandidates = this.#overlayHitIndex
      .query(pointRect)
      .flatMap((instanceId) => {
        const candidate = this.#overlayHitCandidates.get(instanceId);
        return candidate === undefined ? [] : [candidate];
      });
    return hitTestGenericModules(
      state,
      this.#resolver,
      point,
      cell,
      zoom,
      renderedCandidates,
    );
  }

  boxSelection(
    state: Readonly<ProjectState>,
    rect: MapRect,
    visibleCells: readonly VisibleCell[],
  ): readonly string[] {
    return boxSelectGenericModules(state, this.#resolver, rect, visibleCells);
  }

  /** 返回与实际对象视觉一致的高亮轮廓；其他表示继续使用既有载体高亮。 */
  highlightPolygon(
    state: Readonly<ProjectState>,
    instance: Readonly<ModuleRuntimeInstance>,
  ): readonly { readonly x: number; readonly y: number }[] | null {
    if (instance.kind !== "domain-group") return null;
    const descriptor = this.#resolver.resolve(instance);
    return descriptor?.kind === "map-shape"
      ? domainMapShapeGeometry(
          state,
          instance,
          descriptor.shape,
          descriptor.sizeScale,
          descriptor.rotation,
        ).points
      : null;
  }
}
