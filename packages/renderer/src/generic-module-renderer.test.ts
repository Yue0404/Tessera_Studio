import { Container, Graphics, Texture } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import {
  createProject,
  configureProjectSpatialIndexes,
  domainGroupGeometry,
  edgeIdentity,
  edgeSegment,
  visibleCellsInRect,
  type FixedLayerState,
  type ModuleConnectionInstance,
  type ModuleEdgeInstance,
  type ModuleOverlayInstance,
  type ModuleRuntimeInstance,
  type ProjectState,
} from "@tessera/core";
import {
  boxSelectGenericModules,
  GenericModuleRenderer,
  genericOverlayPoint,
  hitTestGenericModule,
  visibleGenericOverlays,
} from "./generic-module-renderer.js";
import {
  markerMapSize,
  textMapSize,
  textWrapMapSize,
} from "./overlay-visibility.js";

const grid = {
  type: "square" as const,
  width: 40_000,
  height: 40_000,
  cellSize: 32,
};

function overlay(
  instanceId: string,
  orderInLayer: number,
  point = { x: 32, y: 32 },
): ModuleOverlayInstance {
  return {
    kind: "overlay",
    objectKind: "free-overlay",
    overlayType: "marker",
    instanceId,
    elementId: "example.weather:marker.station",
    layerId: "example.weather.surface",
    point,
    orderInLayer,
    attributes: {},
    styleOverrides: {},
    extensions: {},
    runtimeStatus: "available",
  };
}

function stateWith(
  instances: readonly ModuleRuntimeInstance[],
  projectGrid: ProjectState["grid"] = grid,
): ProjectState {
  const state = createProject({
    name: "通用渲染",
    grid: projectGrid,
    style: {
      canvasBackground: "#09141DFF",
      defaultCellColor: "#14232DFF",
      gridColor: "#59656AFF",
      gridOpacity: 0.7,
      gridWidth: 1,
      defaultEdgeColor: "#59656AFF",
    },
  });
  (state.layers as Map<string, FixedLayerState>).set(
    "example.weather.surface",
    {
      layerId: "example.weather.surface",
      moduleVersion: "1.0.0",
      zIndex: 2500,
      visible: true,
      locked: false,
      opacity: 1,
      allowedKinds: ["cell", "edge", "overlay", "connection", "domain-group"],
      runtimeStatus: "available",
    },
  );
  for (const instance of instances) state.moduleInstances.add(instance);
  configureProjectSpatialIndexes(state);
  return state;
}

describe("GenericModuleRenderer 查询", () => {
  it("按缩放把 marker 与 text 钳制到 CSS 可读范围", () => {
    expect(markerMapSize(1, 0.1) * 0.1).toBeCloseTo(8);
    expect(markerMapSize(100, 10) * 10).toBeCloseTo(256);
    expect(markerMapSize(20, 2) * 2).toBeCloseTo(40);
    expect(textMapSize(1, 0.1) * 0.1).toBeCloseTo(8);
    expect(textMapSize(20, 10) * 10).toBeCloseTo(96);
    expect(textMapSize(16, 2) * 2).toBeCloseTo(32);
    expect(textWrapMapSize(1_000, 2) * 2).toBeCloseTo(512);
    expect(textWrapMapSize(100, 2) * 2).toBeCloseTo(200);
  });
  it("领域组按全成员、外边界与中心各一次绘制，并可命中选择", () => {
    const memberCellIds = ["cell:square:2:2", "cell:square:2:3"];
    const representations = [
      ["domain-cell", "cell-style"],
      ["domain-edge", "edge-style"],
      ["domain-marker", "marker"],
      ["domain-text", "text"],
    ] as const;
    const instances: ModuleRuntimeInstance[] = representations.map(
      ([instanceId]) => ({
        kind: "domain-group",
        instanceId,
        elementId: `example.weather:${instanceId}`,
        layerId: "example.weather.surface",
        memberCellIds,
        attributes: { text: "领域" },
        styleOverrides: {},
        extensions: {},
        runtimeStatus: "available",
      }),
    );
    const state = stateWith(instances);
    const domainCenter = domainGroupGeometry(state.grid, memberCellIds).center;
    expect(domainCenter).toEqual({ x: 96, y: 80 });
    const edgeManagerSize = state.edges.size;
    const resolver = {
      resolve(instance: Readonly<ModuleRuntimeInstance>) {
        if (instance.instanceId === "domain-cell")
          return {
            kind: "cell-style" as const,
            fillColor: "#112233FF",
            fillOpacity: 1,
          };
        if (instance.instanceId === "domain-edge")
          return {
            kind: "edge-style" as const,
            strokeColor: "#FFFFFFFF",
            strokeOpacity: 1,
            strokeWidth: 2,
            lineStyle: "solid" as const,
          };
        if (instance.instanceId === "domain-marker")
          return {
            kind: "marker" as const,
            shape: "diamond" as const,
            color: "#FFFFFFFF",
            opacity: 1,
            displaySize: 20,
            rotation: 0,
          };
        return {
          kind: "text" as const,
          text: "领域",
          color: "#FFFFFFFF",
          opacity: 1,
          fontSize: 16,
          fontWeight: "normal" as const,
          align: "center" as const,
          rotation: 0,
          backgroundColor: null,
          wrapWidth: null,
        };
      },
    };
    const parent = new Container();
    const renderer = new GenericModuleRenderer(parent, resolver);
    const viewport = { minX: 64, minY: 64, maxX: 128, maxY: 128 };
    const visible = visibleCellsInRect(
      state.grid,
      viewport.minX,
      viewport.minY,
      viewport.maxX,
      viewport.maxY,
    );

    renderer.render(state, viewport, visible, 1);
    expect(state.edges.size).toBe(edgeManagerSize);

    const layer = parent.children[0] as Container | undefined;
    expect(layer?.children).toHaveLength(10);
    const member = visible.find((cell) => cell.cellId === "cell:square:2:2");
    expect(
      hitTestGenericModule(
        state,
        {
          resolve: (instance) =>
            instance.instanceId === "domain-cell"
              ? resolver.resolve(instance)
              : null,
        },
        { x: 80, y: 80 },
        member,
      ),
    ).toBe("domain-cell");
    const only = (instanceId: string) => ({
      resolve: (instance: Readonly<ModuleRuntimeInstance>) =>
        instance.instanceId === instanceId ? resolver.resolve(instance) : null,
    });
    const boundary = edgeIdentity(state.grid, { row: 2, column: 2 }, 0);
    const internal = edgeIdentity(state.grid, { row: 2, column: 2 }, 1);
    const boundarySegment = edgeSegment(
      state.grid,
      boundary.edgeId,
      boundary.adjacentCellIds,
    );
    const internalSegment = edgeSegment(
      state.grid,
      internal.edgeId,
      internal.adjacentCellIds,
    );
    if (boundarySegment === undefined || internalSegment === undefined)
      throw new Error("domain-edge-segment-missing");
    const midpoint = (segment: typeof boundarySegment) => ({
      x: (segment[0].x + segment[1].x) / 2,
      y: (segment[0].y + segment[1].y) / 2,
    });
    expect(
      hitTestGenericModule(
        state,
        only("domain-edge"),
        midpoint(boundarySegment),
        member,
      ),
    ).toBe("domain-edge");
    expect(
      hitTestGenericModule(
        state,
        only("domain-edge"),
        midpoint(internalSegment),
        member,
      ),
    ).toBeNull();
    expect(
      hitTestGenericModule(state, only("domain-marker"), domainCenter, member),
    ).toBe("domain-marker");
    expect(
      hitTestGenericModule(state, only("domain-text"), domainCenter, member),
    ).toBe("domain-text");

    expect(
      boxSelectGenericModules(
        state,
        only("domain-cell"),
        { minX: 70, minY: 70, maxX: 90, maxY: 90 },
        visible,
      ),
    ).toEqual(["domain-cell"]);
    expect(
      boxSelectGenericModules(
        state,
        only("domain-edge"),
        {
          minX: midpoint(boundarySegment).x - 2,
          minY: midpoint(boundarySegment).y - 2,
          maxX: midpoint(boundarySegment).x + 2,
          maxY: midpoint(boundarySegment).y + 2,
        },
        visible,
      ),
    ).toEqual(["domain-edge"]);
    for (const instanceId of ["domain-marker", "domain-text"]) {
      expect(
        boxSelectGenericModules(
          state,
          only(instanceId),
          {
            minX: domainCenter.x - 2,
            minY: domainCenter.y - 2,
            maxX: domainCenter.x + 2,
            maxY: domainCenter.y + 2,
          },
          visible,
        ),
      ).toEqual([instanceId]);
    }
    expect(state.edges.size).toBe(edgeManagerSize);
    renderer.destroy();
  });

  it("连续重绘销毁旧 GraphicsContext，缓存 Texture 仅在 renderer destroy 时释放一次", () => {
    const instance: ModuleRuntimeInstance = {
      kind: "overlay",
      objectKind: "free-overlay",
      overlayType: "marker",
      instanceId: "resource-marker",
      elementId: "example.weather:marker.station",
      layerId: "example.weather.surface",
      point: { x: 32, y: 32 },
      orderInLayer: 0,
      attributes: {},
      styleOverrides: {},
      extensions: {},
      runtimeStatus: "available",
    };
    const cell: ModuleRuntimeInstance = {
      kind: "cell",
      instanceId: "resource-cell",
      elementId: "example.weather:cell.pattern",
      layerId: "example.weather.surface",
      cellId: "cell:square:1:1",
      attributes: {},
      styleOverrides: {},
      extensions: {},
      runtimeStatus: "available",
    };
    const state = stateWith([instance, cell]);
    const identity = {
      moduleId: "example.weather",
      version: "1.0.0",
      resourceId: "example.weather:image.marker",
    } as const;
    const texture = new Texture();
    const textureDestroy = vi.spyOn(texture, "destroy");
    const textureFrom = vi.spyOn(Texture, "from").mockReturnValue(texture);
    const parent = new Container();
    const imageHandle = {} as ImageBitmap;
    const renderer = new GenericModuleRenderer(parent, {
      resolve: (candidate) =>
        candidate.kind === "cell"
          ? {
              kind: "cell-style",
              fillColor: "#FFFFFFFF",
              fillOpacity: 1,
            }
          : {
              kind: "marker",
              shape: "diamond",
              color: "#FFFFFFFF",
              opacity: 1,
              displaySize: 24,
              rotation: 0,
              image: identity,
            },
      resources: {
        resolve: () => ({
          key: "example.weather@1.0.0/example.weather:image.marker",
          identity,
          status: "ready",
          resource: {
            kind: "image",
            mimeType: "image/png",
            bytes: new Uint8Array([1]),
            width: 2,
            height: 1,
            handle: imageHandle,
          },
        }),
        request: vi.fn(),
      },
    });
    const visible = visibleCellsInRect(grid, 0, 0, 64, 64);
    const viewport = { minX: 0, minY: 0, maxX: 64, maxY: 64 };

    const contextBatches: ReturnType<typeof vi.spyOn>[][] = [];
    for (let redraw = 0; redraw < 5; redraw += 1) {
      renderer.render(state, viewport, visible, 1);
      contextBatches.push(
        parent.children
          .flatMap((layer) => layer.children)
          .filter((child): child is Graphics => child instanceof Graphics)
          .map((graphics) => vi.spyOn(graphics.context, "destroy")),
      );
    }
    expect(contextBatches[0]?.length).toBeGreaterThan(0);
    expect(
      contextBatches
        .slice(0, -1)
        .flat()
        .every((destroy) => destroy.mock.calls.length === 1),
    ).toBe(true);
    expect(textureFrom).toHaveBeenCalledTimes(1);
    expect(textureDestroy).not.toHaveBeenCalled();

    renderer.destroy();
    expect(
      contextBatches.flat().every((destroy) => destroy.mock.calls.length === 1),
    ).toBe(true);
    expect(textureDestroy).toHaveBeenCalledTimes(1);
    textureFrom.mockRestore();
  });

  it("仅可见实例请求资源且同一精确 key 在连续 render 中去重", () => {
    const near: ModuleRuntimeInstance = {
      kind: "cell",
      instanceId: "near-pattern",
      elementId: "example.weather:cell.pattern",
      layerId: "example.weather.surface",
      cellId: "cell:square:1:1",
      attributes: {},
      styleOverrides: {},
      extensions: {},
      runtimeStatus: "available",
    };
    const far: ModuleRuntimeInstance = {
      ...near,
      instanceId: "far-pattern",
      cellId: "cell:square:100:100",
    };
    const state = stateWith([near, far]);
    const request = vi.fn();
    const identity = {
      moduleId: "example.weather",
      version: "1.0.0",
      resourceId: "example.weather:image.pattern",
    } as const;
    const renderer = new GenericModuleRenderer(new Container(), {
      resolve: () => ({
        kind: "cell-style",
        fillColor: "#112233FF",
        fillOpacity: 1,
        pattern: { identity, scale: 1 },
      }),
      resources: { resolve: () => undefined, request },
    });
    const visible = visibleCellsInRect(grid, 0, 0, 64, 64);
    const viewport = { minX: 0, minY: 0, maxX: 64, maxY: 64 };

    renderer.render(state, viewport, visible, 1);
    renderer.render(state, viewport, visible, 1);

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(identity);
    expect(renderer.resourceStats).toEqual({
      requested: 1,
      ready: 0,
      placeholder: 1,
    });
    renderer.destroy();
  });

  it.each(["marker", "text"] as const)(
    "隐藏图层中的 generic %s 不可单击，visible 的缺包占位仍可单击",
    (overlayType) => {
      const instance: ModuleOverlayInstance = {
        ...overlay(`${overlayType}-instance`, 0),
        overlayType,
        elementId: `example.weather:${overlayType}.station`,
        ...(overlayType === "marker"
          ? { runtimeStatus: "missing" as const }
          : { attributes: { text: "注记" } }),
      } as ModuleOverlayInstance;
      const state = stateWith([instance]);
      const resolver = {
        resolve(candidate: ModuleRuntimeInstance) {
          if (candidate.kind !== "overlay") return null;
          return candidate.overlayType === "marker"
            ? {
                kind: "marker" as const,
                shape: "circle" as const,
                color: "#FFFFFFFF",
                opacity: 1,
                displaySize: 20,
                rotation: 0,
              }
            : {
                kind: "text" as const,
                text: "注记",
                color: "#FFFFFFFF",
                opacity: 1,
                fontSize: 16,
                fontWeight: "normal" as const,
                align: "center" as const,
                rotation: 0,
                backgroundColor: null,
                wrapWidth: null,
              };
        },
      };
      const point = { x: 32, y: 32 };
      const cell = visibleCellsInRect(grid, 0, 0, 64, 64).find(
        (candidate) => candidate.row === 1 && candidate.column === 1,
      );
      expect(hitTestGenericModule(state, resolver, point, cell)).toBe(
        instance.instanceId,
      );

      const layer = state.layers.get(instance.layerId);
      if (layer === undefined) throw new Error("visible-layer-missing");
      (state.layers as Map<string, FixedLayerState>).set(instance.layerId, {
        ...layer,
        visible: false,
      });
      expect(hitTestGenericModule(state, resolver, point, cell)).toBeNull();
      expect(
        boxSelectGenericModules(
          state,
          resolver,
          { minX: 16, minY: 16, maxX: 48, maxY: 48 },
          cell === undefined ? [] : [cell],
        ),
      ).toEqual([]);
    },
  );

  it("宽且旋转的 generic text 在可见边缘按实际文字矩形命中", () => {
    const instance: ModuleOverlayInstance = {
      ...overlay("rotated-wide-text", 0),
      overlayType: "text",
      attributes: { text: "旋转后的宽文字边缘命中" },
    };
    const state = stateWith([instance]);
    const resolver = {
      resolve: () => ({
        kind: "text" as const,
        text: "旋转后的宽文字边缘命中",
        color: "#FFFFFFFF",
        opacity: 1,
        fontSize: 20,
        fontWeight: "normal" as const,
        align: "center" as const,
        rotation: 45,
        backgroundColor: "#112233CC",
        wrapWidth: 240,
      }),
    };
    // 文字局部坐标 x=90、y=0，旋转 45° 后落在圆形 1em 命中半径之外。
    const edgePoint = {
      x: 32 + 90 / Math.sqrt(2),
      y: 32 + 90 / Math.sqrt(2),
    };
    expect(hitTestGenericModule(state, resolver, edgePoint, undefined, 1)).toBe(
      instance.instanceId,
    );
    expect(
      hitTestGenericModule(
        state,
        resolver,
        { x: edgePoint.x - 20, y: edgePoint.y + 20 },
        undefined,
        1,
      ),
    ).toBeNull();
  });

  it("本轮已渲染的锚定长文字可跨相邻格命中，并保持矩形拒绝、隐藏与 topmost", () => {
    const anchored = (instanceId: string, orderInLayer: number) =>
      ({
        ...overlay(instanceId, orderInLayer),
        objectKind: "anchored-overlay",
        overlayType: "text",
        anchor: {
          kind: "cell",
          cellId: "cell:square:2:2",
          extensions: {},
        },
        attributes: { text: "锚定长文字".repeat(16) },
      }) satisfies ModuleOverlayInstance;
    const lower = anchored("anchored-long-lower", 0);
    const upper = anchored("anchored-long-upper", 1);
    const state = stateWith([lower, upper]);
    const resolver = {
      resolve: () => ({
        kind: "text" as const,
        text: "锚定长文字".repeat(16),
        color: "#FFFFFFFF",
        opacity: 1,
        fontSize: 20,
        fontWeight: "normal" as const,
        align: "center" as const,
        rotation: 0,
        backgroundColor: null,
        wrapWidth: null,
      }),
    };
    const renderer = new GenericModuleRenderer(new Container(), resolver);
    const viewport = { minX: 0, minY: 0, maxX: 640, maxY: 320 };
    const visible = visibleCellsInRect(
      grid,
      viewport.minX,
      viewport.minY,
      viewport.maxX,
      viewport.maxY,
    );
    renderer.render(state, viewport, visible, 1);
    const anchor = genericOverlayPoint(state, upper);
    if (anchor === undefined) throw new Error("anchored-text-point-missing");
    const edgePoint = { x: anchor.x + 300, y: anchor.y };
    const edgeCell = visible.find(
      (cell) =>
        edgePoint.x >= Math.min(...cell.polygon.map((point) => point.x)) &&
        edgePoint.x <= Math.max(...cell.polygon.map((point) => point.x)) &&
        edgePoint.y >= Math.min(...cell.polygon.map((point) => point.y)) &&
        edgePoint.y <= Math.max(...cell.polygon.map((point) => point.y)),
    );

    expect(renderer.hitTest(state, edgePoint, edgeCell, 1)).toBe(
      upper.instanceId,
    );
    expect(
      renderer.hitTest(
        state,
        { x: edgePoint.x, y: edgePoint.y + 30 },
        edgeCell,
        1,
      ),
    ).toBeNull();

    const layer = state.layers.get(upper.layerId);
    if (layer === undefined) throw new Error("anchored-text-layer-missing");
    (state.layers as Map<string, FixedLayerState>).set(upper.layerId, {
      ...layer,
      visible: false,
    });
    expect(renderer.hitTest(state, edgePoint, edgeCell, 1)).toBeNull();
    renderer.destroy();
  });

  it("本轮已渲染的 free 长文字在距锚点超过 256 地图单位的末端可命中", () => {
    const instance: ModuleOverlayInstance = {
      ...overlay("free-long-text", 0, { x: 64, y: 128 }),
      overlayType: "text",
      attributes: { text: "自由长文字".repeat(20) },
    };
    const state = stateWith([instance]);
    const resolver = {
      resolve: () => ({
        kind: "text" as const,
        text: "自由长文字".repeat(20),
        color: "#FFFFFFFF",
        opacity: 1,
        fontSize: 20,
        fontWeight: "normal" as const,
        align: "center" as const,
        rotation: 0,
        backgroundColor: "#112233CC",
        wrapWidth: null,
      }),
    };
    const renderer = new GenericModuleRenderer(new Container(), resolver);
    const viewport = { minX: 0, minY: 0, maxX: 800, maxY: 320 };
    renderer.render(
      state,
      viewport,
      visibleCellsInRect(
        grid,
        viewport.minX,
        viewport.minY,
        viewport.maxX,
        viewport.maxY,
      ),
      1,
    );
    const edgePoint = { x: 64 + 500, y: 128 };

    expect(renderer.hitTest(state, edgePoint, undefined, 1)).toBe(
      instance.instanceId,
    );
    expect(
      renderer.hitTest(
        state,
        { x: edgePoint.x, y: edgePoint.y + 30 },
        undefined,
        1,
      ),
    ).toBeNull();
    renderer.destroy();
  });

  it("远处大量 marker 不进入视口结果且稳定键与插入顺序无关", () => {
    const near = [overlay("b", 1), overlay("a", 1), overlay("first", 0)];
    const far = Array.from({ length: 2_000 }, (_, index) =>
      overlay(`far-${index}`, 0, {
        x: 100_000 + index * 64,
        y: 100_000,
      }),
    );
    const viewport = { minX: 0, minY: 0, maxX: 96, maxY: 96 };
    const forward = stateWith([...near, ...far]);
    const reverse = stateWith([...far].reverse().concat([...near].reverse()));
    const visibleForward = visibleGenericOverlays(
      forward,
      viewport,
      visibleCellsInRect(grid, 0, 0, 96, 96),
    ).map((instance) => instance.instanceId);
    const visibleReverse = visibleGenericOverlays(
      reverse,
      viewport,
      visibleCellsInRect(grid, 0, 0, 96, 96),
    ).map((instance) => instance.instanceId);

    expect(visibleForward).toEqual(["first", "a", "b"]);
    expect(visibleReverse).toEqual(visibleForward);
  });

  it("远处大量 DomainGroup 不进入视口候选且结果与插入顺序无关", () => {
    const group = (instanceId: string, row: number): ModuleRuntimeInstance => ({
      kind: "domain-group",
      instanceId,
      elementId: "example.weather:domain.zone",
      layerId: "example.weather.surface",
      memberCellIds: [`cell:square:${row}:2`, `cell:square:${row}:3`],
      attributes: {},
      styleOverrides: {},
      extensions: {},
      runtimeStatus: "available",
    });
    const near = group("domain-near", 2);
    const far = Array.from({ length: 2_000 }, (_, index) =>
      group(`domain-far-${index.toString().padStart(4, "0")}`, 1_000 + index),
    );
    const resolver = {
      resolve: () => ({
        kind: "cell-style" as const,
        fillColor: "#112233FF",
        fillOpacity: 1,
      }),
    };
    const run = (instances: readonly ModuleRuntimeInstance[]) => {
      const state = stateWith(instances);
      const values = vi
        .spyOn(state.moduleInstances, "values")
        .mockImplementation(() => {
          throw new Error("unexpected-domain-full-scan");
        });
      const rect = { minX: 64, minY: 64, maxX: 128, maxY: 128 };
      const visible = visibleCellsInRect(
        state.grid,
        rect.minX,
        rect.minY,
        rect.maxX,
        rect.maxY,
      );
      const parent = new Container();
      const renderer = new GenericModuleRenderer(parent, resolver);
      renderer.render(state, rect, visible, 1);
      const selected = boxSelectGenericModules(state, resolver, rect, visible);
      expect(values).not.toHaveBeenCalled();
      expect(
        state.moduleInstances.domainGroupSpatialIndexStats.candidateCount,
      ).toBe(1);
      renderer.destroy();
      values.mockRestore();
      return selected;
    };

    expect(run([near, ...far])).toEqual(["domain-near"]);
    expect(run([...far].reverse().concat(near))).toEqual(["domain-near"]);
  });

  it("仅供 generic overlay 引用的结构 edge 仍可解析锚点", () => {
    const state = stateWith([]);
    const identity = edgeIdentity(grid, { row: 2, column: 2 }, 1);
    state.edges.ensure({
      instanceId: `structure:${identity.edgeId}`,
      edgeId: identity.edgeId,
      adjacentCellIds: identity.adjacentCellIds,
      strokeColor: state.style.defaultEdgeColor,
      strokeWidth: state.style.gridWidth,
      strokeOpacity: 1,
      lineStyle: "solid",
      persistence: "reference-only",
    });
    const anchored: ModuleOverlayInstance = {
      ...overlay("edge-marker", 0),
      objectKind: "anchored-overlay",
      anchor: { kind: "edge", edgeId: identity.edgeId, extensions: {} },
    };
    const segment = edgeSegment(
      grid,
      identity.edgeId,
      identity.adjacentCellIds,
    );
    if (segment === undefined) throw new Error("edge-segment-missing");
    expect(genericOverlayPoint(state, anchored)).toEqual({
      x: (segment[0].x + segment[1].x) / 2,
      y: (segment[0].y + segment[1].y) / 2,
    });
  });

  it("框选只返回可见的 generic edge/connection 实例而不返回结构边", () => {
    const state = stateWith([]);
    const identity = edgeIdentity(grid, { row: 2, column: 2 }, 1);
    state.edges.ensure({
      instanceId: `tessera.structure-edge:${identity.edgeId}`,
      edgeId: identity.edgeId,
      adjacentCellIds: identity.adjacentCellIds,
      strokeColor: state.style.defaultEdgeColor,
      strokeWidth: 2,
      strokeOpacity: 1,
      lineStyle: "solid",
      persistence: "reference-only",
    });
    const genericEdge: ModuleEdgeInstance = {
      kind: "edge",
      instanceId: "generic-edge",
      elementId: "example.weather:edge.front",
      layerId: "example.weather.surface",
      edgeId: identity.edgeId,
      adjacentCellIds: identity.adjacentCellIds,
      attributes: {},
      styleOverrides: {},
      extensions: {},
      runtimeStatus: "available",
    };
    const genericConnection: ModuleConnectionInstance = {
      kind: "connection",
      objectKind: "line",
      instanceId: "generic-connection",
      elementId: "example.weather:connection.front",
      layerId: "example.weather.surface",
      start: { kind: "map-point", point: { x: 0, y: 80 }, extensions: {} },
      end: { kind: "map-point", point: { x: 160, y: 80 }, extensions: {} },
      label: null,
      attributes: {},
      styleOverrides: {},
      extensions: {},
      runtimeStatus: "available",
    };
    state.moduleInstances.add(genericEdge);
    state.moduleInstances.add(genericConnection);
    configureProjectSpatialIndexes(state);
    const rect = { minX: 64, minY: 64, maxX: 96, maxY: 96 };
    const resolver = {
      resolve(instance: ModuleRuntimeInstance) {
        if (instance.kind === "edge")
          return {
            kind: "edge-style" as const,
            strokeColor: "#FFFFFFFF",
            strokeOpacity: 1,
            strokeWidth: 2,
            lineStyle: "solid" as const,
          };
        if (instance.kind === "connection")
          return {
            kind: "connection" as const,
            strokeColor: "#FFFFFFFF",
            strokeOpacity: 1,
            strokeWidth: 2,
            arrowStart: false,
            arrowEnd: false,
            arrowSize: 8,
            lineStyle: "solid" as const,
          };
        return null;
      },
    };

    expect(
      boxSelectGenericModules(
        state,
        resolver,
        rect,
        visibleCellsInRect(grid, rect.minX, rect.minY, rect.maxX, rect.maxY),
      ),
    ).toEqual(["generic-connection", "generic-edge"]);
    const visibleLayer = state.layers.get("example.weather.surface");
    if (visibleLayer === undefined) throw new Error("visible-layer-missing");
    (state.layers as Map<string, FixedLayerState>).set(
      "example.weather.surface",
      { ...visibleLayer, visible: false },
    );
    expect(
      boxSelectGenericModules(
        state,
        resolver,
        rect,
        visibleCellsInRect(grid, rect.minX, rect.minY, rect.maxX, rect.maxY),
      ),
    ).toEqual([]);
  });

  it.each(["square", "hex-pointy"] as const)(
    "%s 窄框只穿过模块边且不含地格中心时仍可选择",
    (type) => {
      const projectGrid = { ...grid, type };
      const state = stateWith([], projectGrid);
      const identity = edgeIdentity(projectGrid, { row: 2, column: 2 }, 1);
      const genericEdge: ModuleEdgeInstance = {
        kind: "edge",
        instanceId: `generic-edge-${type}`,
        elementId: "example.weather:edge.front",
        layerId: "example.weather.surface",
        edgeId: identity.edgeId,
        adjacentCellIds: identity.adjacentCellIds,
        attributes: {},
        styleOverrides: {},
        extensions: {},
        runtimeStatus: "available",
      };
      state.moduleInstances.add(genericEdge);
      const segment = edgeSegment(
        projectGrid,
        identity.edgeId,
        identity.adjacentCellIds,
      );
      if (segment === undefined) throw new Error("edge-segment-missing");
      const midpoint = {
        x: (segment[0].x + segment[1].x) / 2,
        y: (segment[0].y + segment[1].y) / 2,
      };
      const rect = {
        minX: midpoint.x - 1,
        minY: midpoint.y - 1,
        maxX: midpoint.x + 1,
        maxY: midpoint.y + 1,
      };
      const visible = visibleCellsInRect(
        projectGrid,
        rect.minX,
        rect.minY,
        rect.maxX,
        rect.maxY,
      );
      expect(
        visible.some(
          (cell) =>
            cell.center.x >= rect.minX &&
            cell.center.x <= rect.maxX &&
            cell.center.y >= rect.minY &&
            cell.center.y <= rect.maxY,
        ),
      ).toBe(false);

      expect(
        boxSelectGenericModules(
          state,
          {
            resolve: () => ({
              kind: "edge-style",
              strokeColor: "#FFFFFFFF",
              strokeOpacity: 1,
              strokeWidth: 2,
              lineStyle: "solid",
            }),
          },
          rect,
          visible,
        ),
      ).toEqual([genericEdge.instanceId]);
    },
  );
});
