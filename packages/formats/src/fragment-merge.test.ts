import {
  DOMAIN_GROUP_LAYOUT_EXTENSION_KEY,
  axialToOddR,
  cellCenter,
  cellId,
  cellPolygon,
  createProject,
  edgeIdentity,
  EditorStore,
  oddRToAxial,
  parseCellId,
  resolveDomainGroupLayout,
  type GridType,
} from "@tessera/core";
import { describe, expect, it } from "vitest";
import { computeProjectContentBounds } from "./content-bounds.js";
import {
  applyFragmentMerge,
  cancelFragmentMerge,
  createFragmentV1,
  createPartialProjectV1,
  planFragmentMerge,
  preflightFragmentMerge,
  validateProjectDocumentV1,
  type FragmentMergePlan,
  type FragmentModuleResolver,
  type FragmentV1Document,
  type ProjectV1Document,
} from "./index.js";
import { toProjectV1 } from "./project-format.js";

const APP_VERSION = "9.9.9";

function createStore(type: GridType, width = 12, height = 12): EditorStore {
  return new EditorStore(
    createProject({
      name: "fragment merge",
      grid: { type, width, height, cellSize: 32 },
      style: {
        canvasBackground: "#09141DFF",
        defaultCellColor: "#14232DFF",
        gridColor: "#59656AFF",
        gridOpacity: 0.7,
        gridWidth: 1,
        defaultEdgeColor: "#59656AFF",
      },
    }),
  );
}

function createTarget(
  type: GridType,
  width = 12,
  height = 12,
): ProjectV1Document {
  return toProjectV1(
    createStore(type, width, height).state,
  ) as ProjectV1Document;
}

function createBasicFragment(
  type: GridType,
  row: number,
  column: number,
  edgePersistence: "reference-only" | "explicit-style" = "explicit-style",
): FragmentV1Document {
  const store = createStore(type);
  store.paintCell(row, column, "#E3614DFF");
  const edge = edgeIdentity(store.state.grid, { row, column }, 1);
  if (edgePersistence === "explicit-style") {
    store.paintEdge(edge.edgeId, edge.adjacentCellIds, "#31B8C6FF");
  }
  store.placeEdgeMarker({
    instanceId: crypto.randomUUID(),
    ...edge,
    strokeColor: "#59656AFF",
    strokeWidth: 1,
    strokeOpacity: 1,
    lineStyle: "solid",
  });
  const point = cellCenter(store.state.grid, row, column);
  store.placeMarker(point);
  store.createConnection(
    { kind: "edge-midpoint", edgeId: edge.edgeId },
    { kind: "map-point", point },
    { kind: "arrow", arrowMode: "end", label: "route" },
  );
  const source = toProjectV1(store.state) as ProjectV1Document;
  return createFragmentV1(source, {
    fragmentId: crypto.randomUUID(),
    bounds: { minX: 0, minY: 0, maxX: 20_000, maxY: 20_000 },
    includedLayerIds: [
      "tessera.basic.cell-style",
      "tessera.basic.edge-style",
      "tessera.basic.placed-object",
      "tessera.basic.connection",
    ],
  });
}

function readyPlan(
  plan: FragmentMergePlan,
): asserts plan is Extract<FragmentMergePlan, { status: "ready" }> {
  expect(plan.status).toBe("ready");
  if (plan.status !== "ready") throw new Error("expected-ready-plan");
}

function uuidSequence(): () => string {
  let value = 1;
  return () => {
    const suffix = String(value).padStart(12, "0");
    value += 1;
    return `10000000-0000-4000-8000-${suffix}`;
  };
}

function createEdgeProject(
  persistence: "reference-only" | "explicit-style",
): ProjectV1Document {
  const store = createStore("square");
  const edge = edgeIdentity(store.state.grid, { row: 2, column: 3 }, 1);
  if (persistence === "explicit-style") {
    store.paintEdge(edge.edgeId, edge.adjacentCellIds, "#31B8C6FF");
  }
  store.placeEdgeMarker({
    instanceId: crypto.randomUUID(),
    ...edge,
    strokeColor: "#59656AFF",
    strokeWidth: 1,
    strokeOpacity: 1,
    lineStyle: "solid",
  });
  return toProjectV1(store.state) as ProjectV1Document;
}

function addExternalModule(
  document: ProjectV1Document,
  includeObjects: boolean,
): {
  document: ProjectV1Document;
  assetId?: string;
  instanceId?: string;
  groupId?: string;
} {
  const mutable = structuredClone(document) as any;
  mutable.modules.push({
    moduleId: "zz.asset",
    version: "1.0.0",
    packageSourceKind: "user-file",
    extensions: { vendor: { module: [2, 1] } },
  });
  mutable.modules.sort((left: any, right: any) =>
    left.moduleId.localeCompare(right.moduleId),
  );
  mutable.layerStates.push({
    layerId: "zz.asset.items",
    moduleVersion: "1.0.0",
    zIndex: 5_000,
    visible: true,
    locked: false,
    opacity: 1,
    extensions: { vendor: { layer: true } },
  });
  if (!includeObjects) {
    validateProjectDocumentV1(mutable);
    return { document: mutable };
  }

  const assetId = crypto.randomUUID();
  const instanceId = crypto.randomUUID();
  const groupId = crypto.randomUUID();
  const cell = mutable.chunks[0].cellOverrides[0];
  const groupOwner = parseCellId(cell.cellId);
  const adjacentGroupCellId = cellId(
    groupOwner.gridType,
    groupOwner.row,
    groupOwner.column + 1,
  );
  cell.layerInstances.push({
    instanceId,
    elementId: "zz.asset:item",
    layerId: "zz.asset.items",
    styleOverrides: { icon: { assetRef: { assetId } } },
    attributes: { source: { assetRef: assetId } },
    extensions: {
      vendor: { ordered: [3, { beta: 2, alpha: 1 }, 1] },
    },
  });
  cell.layerInstances.sort(
    (left: any, right: any) =>
      left.layerId.localeCompare(right.layerId) ||
      left.instanceId.localeCompare(right.instanceId),
  );
  mutable.domainGroups.push({
    kind: "domain-group",
    groupId,
    elementId: "zz.asset:group",
    layerId: "zz.asset.items",
    memberCellIds: [cell.cellId, adjacentGroupCellId],
    attributes: {},
    styleOverrides: {},
    extensions: { vendor: { nested: { z: 1, a: [true, null] } } },
  });
  mutable.chunks[0].ownedDomainGroupIds.push(groupId);
  mutable.chunks[0].ownedDomainGroupIds.sort();
  mutable.embeddedAssets.push({
    assetId,
    mimeType: "application/json",
    bytes: 2,
    encoding: "base64",
    data: "e30=",
    extensions: { vendor: { asset: ["a", "b"] } },
  });
  mutable.contentBounds = computeProjectContentBounds(mutable);
  validateProjectDocumentV1(mutable);
  return { document: mutable, assetId, instanceId, groupId };
}

function createExternalFragment(): {
  fragment: FragmentV1Document;
  assetId: string;
  instanceId: string;
  groupId: string;
} {
  const store = createStore("square");
  store.paintCell(2, 2, "#E3614DFF");
  const external = addExternalModule(
    toProjectV1(store.state) as ProjectV1Document,
    true,
  );
  const fragment = createFragmentV1(external.document, {
    fragmentId: crypto.randomUUID(),
    bounds: { minX: 0, minY: 0, maxX: 500, maxY: 500 },
    includedLayerIds: ["zz.asset.items"],
  });
  return {
    fragment,
    assetId: external.assetId ?? "",
    instanceId: external.instanceId ?? "",
    groupId: external.groupId ?? "",
  };
}

function externalResolver(
  onResolve?: (appVersion: string) => void,
): FragmentModuleResolver {
  return {
    resolve(request) {
      onResolve?.(request.appVersion);
      if (request.moduleId !== "zz.asset" || request.version !== "1.0.0") {
        return undefined;
      }
      return {
        moduleId: request.moduleId,
        version: request.version,
        appVersionSupported: request.appVersion === APP_VERSION,
        supportedGrids: [request.gridType],
        layers: [
          {
            layerId: "zz.asset.items",
            zIndex: 5_000,
            allowedPrimitives: ["cell", "domain-group"],
            allowedAnchors: ["cell"],
          },
        ],
        elements: [
          {
            elementId: "zz.asset:item",
            layerId: "zz.asset.items",
            primitive: "cell",
            supportedGrids: [request.gridType],
            anchors: ["cell"],
          },
          {
            elementId: "zz.asset:group",
            layerId: "zz.asset.items",
            primitive: "domain-group",
            supportedGrids: [request.gridType],
            anchors: ["cell"],
          },
        ],
      };
    },
  };
}

describe("Fragment merge transaction", () => {
  it.each([2, 3])(
    "仅选择领域成员 2:%i 时仍闭包导出并完整合并领域组",
    (selectedColumn) => {
      const sourceStore = createStore("square");
      sourceStore.paintCell(2, 2, "#E3614DFF");
      const source = addExternalModule(
        toProjectV1(sourceStore.state) as ProjectV1Document,
        true,
      );
      const selectedCenter = cellCenter(
        source.document.grid,
        2,
        selectedColumn,
      );
      const fragment = createFragmentV1(source.document, {
        fragmentId: crypto.randomUUID(),
        bounds: {
          minX: selectedCenter.x - 1,
          minY: selectedCenter.y - 1,
          maxX: selectedCenter.x + 1,
          maxY: selectedCenter.y + 1,
        },
        includedLayerIds: ["zz.asset.items"],
      });
      expect(fragment.objects.domainGroups).toHaveLength(1);
      expect(fragment.objects.domainGroups[0]?.memberCellIds).toEqual([
        cellId("square", 2, 2),
        cellId("square", 2, 3),
      ]);

      const target = addExternalModule(createTarget("square"), false).document;
      const plan = planFragmentMerge(target, fragment, {
        currentAppVersion: APP_VERSION,
        resolver: externalResolver(),
        translation: { kind: "square", deltaRow: 1, deltaColumn: 2 },
      });
      readyPlan(plan);
      const result = applyFragmentMerge(target, fragment, plan, {
        currentAppVersion: APP_VERSION,
        resolver: externalResolver(),
        uuidGenerator: uuidSequence(),
      });
      const importedGroupId = result.idRemap.instances[source.groupId ?? ""];
      const importedGroup = result.project.domainGroups.find(
        (group) => group.groupId === importedGroupId,
      );
      expect(importedGroup?.memberCellIds).toEqual([
        cellId("square", 3, 4),
        cellId("square", 3, 5),
      ]);
      if (importedGroup === undefined) throw new Error("group-missing");
      const layout = resolveDomainGroupLayout(
        result.project.grid,
        importedGroup.memberCellIds,
        importedGroup.extensions,
      );
      expect(layout).toMatchObject({
        anchorCellId: cellId("square", 3, 4),
        coordinateSystem: "row-column",
        relativeOffsets: [
          { rowDelta: 0, columnDelta: 0 },
          { rowDelta: 0, columnDelta: 1 },
        ],
      });
      expect(importedGroup.extensions).toMatchObject({
        vendor: { nested: { z: 1, a: [true, null] } },
        [DOMAIN_GROUP_LAYOUT_EXTENSION_KEY]: layout,
      });
      validateProjectDocumentV1(result.project);
    },
  );

  it("square 零平移返回可预览计划并原子生成新工程", () => {
    const target = createTarget("square");
    const fragment = createBasicFragment("square", 2, 3);
    const targetBefore = JSON.stringify(target);
    const fragmentBefore = JSON.stringify(fragment);
    const plan = planFragmentMerge(target, fragment, {
      currentAppVersion: APP_VERSION,
    });
    readyPlan(plan);
    expect(plan.preview).toMatchObject({
      zeroTranslation: true,
      objectCounts: { cells: 1, edges: 1, connections: 1 },
    });

    const result = applyFragmentMerge(target, fragment, plan, {
      currentAppVersion: APP_VERSION,
      uuidGenerator: uuidSequence(),
      now: () => "2026-08-22T00:00:00.000Z",
    });

    expect(JSON.stringify(target)).toBe(targetBefore);
    expect(JSON.stringify(fragment)).toBe(fragmentBefore);
    expect(result.project).not.toBe(target);
    expect(result.historyIntent).toMatchObject({
      kind: "fragment-merge",
      fragmentId: fragment.fragmentId,
      sourceProjectId: fragment.sourceProjectId,
      affectedCollections: [
        "project-metadata",
        "chunks",
        "edges",
        "connections",
        "overlays",
        "domainGroups",
        "embeddedAssets",
      ],
    });
    expect(Object.keys(result.idRemap.instances).length).toBeGreaterThanOrEqual(
      5,
    );
    expect(
      result.project.managers.edgeManager.edges[0]?.adjacentCellIds,
    ).toEqual(fragment.objects.edges[0]?.adjacentCellIds);
    validateProjectDocumentV1(result.project);
  });

  it("square 越界先预览，可取消或由用户确认统一整数平移", () => {
    const target = createTarget("square", 4, 4);
    const fragment = createBasicFragment("square", 6, 6);
    const targetBefore = JSON.stringify(target);
    const fragmentBefore = JSON.stringify(fragment);
    const preview = planFragmentMerge(target, fragment, {
      currentAppVersion: APP_VERSION,
    });
    expect(preview.status).toBe("requires-translation");
    expect("preview" in preview && preview.preview.zeroTranslation).toBe(true);
    const cancelled = cancelFragmentMerge(preview);
    expect(cancelled).toMatchObject({ status: "cancelled" });
    expect(JSON.stringify(target)).toBe(targetBefore);
    expect(JSON.stringify(fragment)).toBe(fragmentBefore);

    const plan = planFragmentMerge(target, fragment, {
      currentAppVersion: APP_VERSION,
      translation: { kind: "square", deltaRow: -4, deltaColumn: -4 },
    });
    readyPlan(plan);
    const result = applyFragmentMerge(target, fragment, plan, {
      currentAppVersion: APP_VERSION,
      uuidGenerator: uuidSequence(),
    });
    expect(
      result.project.chunks.flatMap((chunk) => chunk.cellOverrides)[0]?.cellId,
    ).toBe("cell:square:2:2");
    const freeOverlay = result.project.managers.overlayManager.overlays.find(
      (overlay) => overlay.kind === "free-overlay",
    );
    expect(freeOverlay).toMatchObject({
      point: cellCenter(target.grid, 2, 2),
    });
    validateProjectDocumentV1(result.project);
  });

  it("平移量只接受安全整数并区分合法但越界", () => {
    const target = createTarget("square");
    const fragment = createBasicFragment("square", 2, 2);
    expect(
      planFragmentMerge(target, fragment, {
        currentAppVersion: APP_VERSION,
        translation: {
          kind: "square",
          deltaRow: Number.MAX_SAFE_INTEGER,
          deltaColumn: 0,
        },
      }),
    ).toMatchObject({
      status: "blocked",
      code: "fragment-translation-out-of-bounds",
    });
    expect(
      planFragmentMerge(target, fragment, {
        currentAppVersion: APP_VERSION,
        translation: {
          kind: "square",
          deltaRow: Number.MAX_SAFE_INTEGER + 1,
          deltaColumn: 0,
        },
      }),
    ).toMatchObject({
      status: "blocked",
      code: "fragment-translation-invalid",
    });
  });

  it("square 非零平移重写 cell 锚点、cell-center、map-point 与 DomainGroup 成员", () => {
    const store = createStore("square");
    const sourceCellId = cellId("square", 2, 2);
    store.paintCell(2, 2, "#E3614DFF");
    store.placeMarker({ kind: "cell", cellId: sourceCellId });
    store.createConnection(
      { kind: "cell-center", cellId: sourceCellId },
      { kind: "map-point", point: cellCenter(store.state.grid, 2, 3) },
      "line",
    );
    const fragment = createFragmentV1(
      toProjectV1(store.state) as ProjectV1Document,
      {
        fragmentId: crypto.randomUUID(),
        bounds: { minX: 0, minY: 0, maxX: 500, maxY: 500 },
        includedLayerIds: [
          "tessera.basic.cell-style",
          "tessera.basic.placed-object",
          "tessera.basic.connection",
        ],
      },
    );
    const target = createTarget("square");
    const plan = planFragmentMerge(target, fragment, {
      currentAppVersion: APP_VERSION,
      translation: { kind: "square", deltaRow: 1, deltaColumn: 2 },
    });
    readyPlan(plan);
    const result = applyFragmentMerge(target, fragment, plan, {
      currentAppVersion: APP_VERSION,
      uuidGenerator: uuidSequence(),
    });
    const expectedCellId = cellId("square", 3, 4);
    expect(result.project.managers.overlayManager.overlays[0]).toMatchObject({
      kind: "anchored-overlay",
      anchor: { kind: "cell", cellId: expectedCellId },
    });
    expect(
      result.project.managers.connectionManager.connections[0],
    ).toMatchObject({
      start: { kind: "cell-center", cellId: expectedCellId },
      end: {
        kind: "map-point",
        point: cellCenter(target.grid, 3, 5),
      },
    });
    validateProjectDocumentV1(result.project);

    const external = createExternalFragment();
    const externalTarget = addExternalModule(
      createTarget("square"),
      false,
    ).document;
    const externalPlan = planFragmentMerge(externalTarget, external.fragment, {
      currentAppVersion: APP_VERSION,
      resolver: externalResolver(),
      translation: { kind: "square", deltaRow: 1, deltaColumn: 2 },
    });
    readyPlan(externalPlan);
    const externalResult = applyFragmentMerge(
      externalTarget,
      external.fragment,
      externalPlan,
      {
        currentAppVersion: APP_VERSION,
        resolver: externalResolver(),
        uuidGenerator: uuidSequence(),
      },
    );
    const remappedGroupId = externalResult.idRemap.instances[external.groupId];
    expect(
      externalResult.project.domainGroups.find(
        (group) => group.groupId === remappedGroupId,
      )?.memberCellIds,
    ).toEqual([expectedCellId, cellId("square", 3, 5)]);
    validateProjectDocumentV1(externalResult.project);
  });

  it("source boundary Edge 平移到内部后重算双邻格并重写全部 Edge 引用", () => {
    const store = createStore("square");
    const sourceCoordinate = { row: 2, column: 0 };
    const sourceEdge = edgeIdentity(store.state.grid, sourceCoordinate, 3);
    expect(sourceEdge.adjacentCellIds).toHaveLength(1);
    store.placeEdgeMarker({
      instanceId: crypto.randomUUID(),
      ...sourceEdge,
      strokeColor: "#59656AFF",
      strokeWidth: 1,
      strokeOpacity: 1,
      lineStyle: "solid",
    });
    store.createConnection(
      { kind: "edge-midpoint", edgeId: sourceEdge.edgeId },
      {
        kind: "cell-center",
        cellId: cellId("square", sourceCoordinate.row, sourceCoordinate.column),
      },
      "line",
    );
    const fragment = createFragmentV1(
      toProjectV1(store.state) as ProjectV1Document,
      {
        fragmentId: crypto.randomUUID(),
        bounds: { minX: 0, minY: 0, maxX: 500, maxY: 500 },
        includedLayerIds: [
          "tessera.basic.edge-style",
          "tessera.basic.placed-object",
          "tessera.basic.connection",
        ],
      },
    );
    const target = createTarget("square");
    const plan = planFragmentMerge(target, fragment, {
      currentAppVersion: APP_VERSION,
      translation: { kind: "square", deltaRow: 0, deltaColumn: 2 },
    });
    readyPlan(plan);
    const result = applyFragmentMerge(target, fragment, plan, {
      currentAppVersion: APP_VERSION,
      uuidGenerator: uuidSequence(),
    });
    const expectedEdge = edgeIdentity(
      target.grid,
      { row: sourceCoordinate.row, column: 2 },
      3,
    );
    expect(expectedEdge.adjacentCellIds).toHaveLength(2);
    expect(result.project.managers.edgeManager.edges[0]).toMatchObject(
      expectedEdge,
    );
    expect(
      result.project.managers.edgeManager.edges[0]?.layerInstances,
    ).toEqual([]);
    expect(result.project.managers.overlayManager.overlays[0]).toMatchObject({
      kind: "anchored-overlay",
      anchor: { kind: "edge", edgeId: expectedEdge.edgeId },
    });
    expect(
      result.project.managers.connectionManager.connections[0],
    ).toMatchObject({
      start: { kind: "edge-midpoint", edgeId: expectedEdge.edgeId },
      end: {
        kind: "cell-center",
        cellId: cellId("square", sourceCoordinate.row, 2),
      },
    });
    validateProjectDocumentV1(result.project);
  });

  it.each([2, 3])("hex-pointy 轴向平移跨 row %s 奇偶性并重算 Edge", (row) => {
    const column = 3;
    const target = createTarget("hex-pointy", 20, 20);
    const fragment = createBasicFragment("hex-pointy", row, column);
    const translation = { kind: "hex-pointy" as const, deltaQ: 2, deltaR: 1 };
    const plan = planFragmentMerge(target, fragment, {
      currentAppVersion: APP_VERSION,
      translation,
    });
    readyPlan(plan);
    const result = applyFragmentMerge(target, fragment, plan, {
      currentAppVersion: APP_VERSION,
      uuidGenerator: uuidSequence(),
    });
    const sourceCoordinate = { row, column };
    const sourceAxial = oddRToAxial(sourceCoordinate);
    const expectedCoordinate = axialToOddR({
      q: sourceAxial.q + translation.deltaQ,
      r: sourceAxial.r + translation.deltaR,
    });
    const importedCell = result.project.chunks
      .flatMap((chunk) => chunk.cellOverrides)
      .find((cell) => cell.cellId !== undefined);
    expect(parseCellId(importedCell?.cellId ?? "")).toMatchObject(
      expectedCoordinate,
    );
    const expectedEdge = edgeIdentity(target.grid, expectedCoordinate, 1);
    expect(result.project.managers.edgeManager.edges[0]).toMatchObject(
      expectedEdge,
    );
    const freeOverlay = result.project.managers.overlayManager.overlays.find(
      (overlay) => overlay.kind === "free-overlay",
    );
    expect(freeOverlay).toMatchObject({
      point: cellCenter(
        target.grid,
        expectedCoordinate.row,
        expectedCoordinate.column,
      ),
    });
    validateProjectDocumentV1(result.project);
  });

  it("hex-pointy 领域组平移重写轴向锚点且 offsets 与未知扩展不变", () => {
    const sourceStore = createStore("hex-pointy");
    sourceStore.paintCell(2, 2, "#E3614DFF");
    const source = addExternalModule(
      toProjectV1(sourceStore.state) as ProjectV1Document,
      true,
    );
    const fragment = createFragmentV1(source.document, {
      fragmentId: crypto.randomUUID(),
      bounds: { minX: 0, minY: 0, maxX: 500, maxY: 500 },
      includedLayerIds: ["zz.asset.items"],
    });
    const target = addExternalModule(
      createTarget("hex-pointy"),
      false,
    ).document;
    const translation = {
      kind: "hex-pointy" as const,
      deltaQ: 2,
      deltaR: 1,
    };
    const plan = planFragmentMerge(target, fragment, {
      currentAppVersion: APP_VERSION,
      resolver: externalResolver(),
      translation,
    });
    readyPlan(plan);
    const result = applyFragmentMerge(target, fragment, plan, {
      currentAppVersion: APP_VERSION,
      resolver: externalResolver(),
      uuidGenerator: uuidSequence(),
    });
    const importedGroupId = result.idRemap.instances[source.groupId ?? ""];
    const group = result.project.domainGroups.find(
      (candidate) => candidate.groupId === importedGroupId,
    );
    if (group === undefined) throw new Error("group-missing");
    const layout = resolveDomainGroupLayout(
      result.project.grid,
      group.memberCellIds,
      group.extensions,
    );
    const sourceAnchor = oddRToAxial({ row: 2, column: 2 });
    const expectedAnchor = axialToOddR({
      q: sourceAnchor.q + translation.deltaQ,
      r: sourceAnchor.r + translation.deltaR,
    });

    expect(parseCellId(layout.anchorCellId)).toMatchObject(expectedAnchor);
    expect(layout).toMatchObject({
      coordinateSystem: "axial-q-r",
      relativeOffsets: [
        { dq: 0, dr: 0 },
        { dq: 1, dr: 0 },
      ],
    });
    expect(group.extensions).toMatchObject({
      vendor: { nested: { z: 1, a: [true, null] } },
      [DOMAIN_GROUP_LAYOUT_EXTENSION_KEY]: layout,
    });
    validateProjectDocumentV1(result.project);
  });

  it("预检区分缺模块、版本迁移、网格与 cellSize 不兼容", () => {
    const external = createExternalFragment();
    const missingTarget = createTarget("square");
    expect(
      preflightFragmentMerge(missingTarget, external.fragment, {
        currentAppVersion: APP_VERSION,
        resolver: externalResolver(),
      }),
    ).toEqual({
      status: "install-required",
      missingModules: [{ moduleId: "zz.asset", version: "1.0.0" }],
    });

    const enabled = addExternalModule(createTarget("square"), false).document;
    let resolverAppVersion = "";
    expect(
      preflightFragmentMerge(enabled, external.fragment, {
        currentAppVersion: APP_VERSION,
        resolver: externalResolver((value) => {
          resolverAppVersion = value;
        }),
      }),
    ).toMatchObject({ status: "ready" });
    expect(resolverAppVersion).toBe(APP_VERSION);
    expect(enabled.createdWithAppVersion).not.toBe(APP_VERSION);

    const wrongVersion = structuredClone(enabled) as any;
    wrongVersion.modules.find(
      (module: any) => module.moduleId === "zz.asset",
    ).version = "2.0.0";
    wrongVersion.layerStates.find(
      (layer: any) => layer.layerId === "zz.asset.items",
    ).moduleVersion = "2.0.0";
    expect(
      preflightFragmentMerge(wrongVersion, external.fragment, {
        currentAppVersion: APP_VERSION,
        resolver: externalResolver(),
      }),
    ).toMatchObject({
      status: "blocked",
      code: "migration-execution-not-supported",
    });

    expect(
      preflightFragmentMerge(
        createTarget("hex-pointy"),
        createBasicFragment("square", 2, 2),
        {
          currentAppVersion: APP_VERSION,
        },
      ),
    ).toMatchObject({
      status: "blocked",
      code: "fragment-grid-type-incompatible",
    });
    const wrongCellSize = structuredClone(createTarget("square")) as any;
    wrongCellSize.grid.cellSize = 64;
    expect(
      preflightFragmentMerge(
        wrongCellSize,
        createBasicFragment("square", 2, 2),
        {
          currentAppVersion: APP_VERSION,
        },
      ),
    ).toMatchObject({
      status: "blocked",
      code: "fragment-cell-size-incompatible",
    });

    const incompatibleResolver: FragmentModuleResolver = {
      resolve(request) {
        const contract = externalResolver().resolve(request);
        return contract === undefined
          ? undefined
          : {
              ...contract,
              layers: contract.layers.map((layer) => ({
                ...layer,
                allowedPrimitives: [],
              })),
            };
      },
    };
    expect(
      preflightFragmentMerge(enabled, external.fragment, {
        currentAppVersion: APP_VERSION,
        resolver: incompatibleResolver,
      }),
    ).toMatchObject({
      status: "blocked",
      code: "fragment-anchor-contract-incompatible",
    });
    expect(
      preflightFragmentMerge(enabled, external.fragment, {
        currentAppVersion: APP_VERSION,
        resolver: { resolve: () => ({ layers: null }) as never },
      }),
    ).toMatchObject({ status: "blocked", code: "module-contract-invalid" });
    expect(
      preflightFragmentMerge(enabled, external.fragment, {
        currentAppVersion: "1.0.0-01",
        resolver: externalResolver(),
      }),
    ).toMatchObject({ status: "blocked", code: "current-app-version-invalid" });

    const partialTarget = createPartialProjectV1(createTarget("square"), {
      bounds: { minX: 0, minY: 0, maxX: 64, maxY: 64 },
      includedLayerIds: ["tessera.basic.cell-style"],
    });
    expect(
      preflightFragmentMerge(
        partialTarget,
        createBasicFragment("square", 2, 2),
        { currentAppVersion: APP_VERSION },
      ),
    ).toMatchObject({
      status: "blocked",
      code: "fragment-target-scope-layer-omitted",
    });
  });

  it.each([3, 4])("hex height=%s preview 覆盖奇偶行真实 maxX", (height) => {
    const target = createTarget("hex-pointy", 2, height);
    const fragment = createBasicFragment("hex-pointy", 0, 0);
    const plan = planFragmentMerge(target, fragment, {
      currentAppVersion: APP_VERSION,
    });
    readyPlan(plan);
    const expectedMaxX = Math.max(
      ...Array.from({ length: height }, (_, row) =>
        cellPolygon(target.grid, row, target.grid.width - 1),
      )
        .flat()
        .map((point) => point.x),
    );
    expect(plan.preview.targetMapBounds.maxX).toBeCloseTo(expectedMaxX, 12);
  });

  it("外部模块全部 UUID 与显式 assetRef 重映射且 extensions 深层语义保留", () => {
    const source = createExternalFragment();
    const target = addExternalModule(createTarget("square"), false).document;
    const targetBefore = JSON.stringify(target);
    const fragmentBefore = JSON.stringify(source.fragment);
    const plan = planFragmentMerge(target, source.fragment, {
      currentAppVersion: APP_VERSION,
      resolver: externalResolver(),
    });
    readyPlan(plan);
    const result = applyFragmentMerge(target, source.fragment, plan, {
      currentAppVersion: APP_VERSION,
      resolver: externalResolver(),
      uuidGenerator: uuidSequence(),
    });
    const newAssetId = result.idRemap.assets[source.assetId];
    const newInstanceId = result.idRemap.instances[source.instanceId];
    const newGroupId = result.idRemap.instances[source.groupId];
    expect(newAssetId).toBeDefined();
    expect(newInstanceId).toBeDefined();
    expect(newGroupId).toBeDefined();
    const importedInstance = result.project.chunks
      .flatMap((chunk) => chunk.cellOverrides)
      .flatMap((cell) => cell.layerInstances)
      .find((instance) => instance.instanceId === newInstanceId);
    expect(importedInstance).toMatchObject({
      styleOverrides: { icon: { assetRef: { assetId: newAssetId } } },
      attributes: { source: { assetRef: newAssetId } },
      extensions: {
        vendor: { ordered: [3, { beta: 2, alpha: 1 }, 1] },
      },
    });
    expect(
      result.project.domainGroups.find((group) => group.groupId === newGroupId)
        ?.extensions,
    ).toMatchObject({ vendor: { nested: { z: 1, a: [true, null] } } });
    expect(JSON.stringify(target)).toBe(targetBefore);
    expect(JSON.stringify(source.fragment)).toBe(fragmentBefore);
    validateProjectDocumentV1(result.project);
  });

  it.each([
    ["reference-only", "reference-only", "reference-only", false],
    ["reference-only", "explicit-style", "explicit-style", false],
    ["explicit-style", "reference-only", "explicit-style", false],
    ["explicit-style", "explicit-style", "explicit-style", true],
  ] as const)(
    "Edge 合并 target=%s incoming=%s 得到 %s conflict=%s",
    (targetMode, incomingMode, expectedMode, conflict) => {
      const target = createEdgeProject(targetMode);
      const fragment = createBasicFragment("square", 2, 3, incomingMode);
      const sourceEdgeInstanceId =
        fragment.objects.edges[0]?.layerInstances[0]?.instanceId;
      const targetEdgeInstanceId =
        target.managers.edgeManager.edges[0]?.layerInstances[0]?.instanceId;
      const plan = planFragmentMerge(target, fragment, {
        currentAppVersion: APP_VERSION,
      });
      if (conflict) {
        expect(plan).toMatchObject({
          status: "blocked",
          code: "fragment-edge-layer-conflict",
        });
        return;
      }
      readyPlan(plan);
      const result = applyFragmentMerge(target, fragment, plan, {
        currentAppVersion: APP_VERSION,
        uuidGenerator: uuidSequence(),
      });
      const edge = result.project.managers.edgeManager.edges[0];
      if (expectedMode === "reference-only") {
        expect(edge?.layerInstances).toEqual([]);
      } else {
        expect(edge?.layerInstances).toHaveLength(1);
        expect(edge?.layerInstances[0]?.attributes).toMatchObject({
          persistence: "explicit-style",
        });
      }
      if (incomingMode === "reference-only") {
        expect(sourceEdgeInstanceId).toBeUndefined();
        expect(result.idRemap.deduplicatedStructuralInstances).toEqual({});
        expect(edge?.layerInstances[0]?.instanceId).toBe(targetEdgeInstanceId);
      } else if (targetMode === "reference-only") {
        expect(sourceEdgeInstanceId).toBeDefined();
        expect(edge?.layerInstances[0]?.instanceId).toBe(
          result.idRemap.instances[sourceEdgeInstanceId ?? ""],
        );
      }
      validateProjectDocumentV1(result.project);
    },
  );

  it("extensions 按命名空间稳定并集、对象键序无关且差异冲突前置", () => {
    const source = createExternalFragment();
    const targetStore = createStore("square");
    targetStore.paintCell(2, 2, "#638B54FF");
    const target = addExternalModule(
      toProjectV1(targetStore.state) as ProjectV1Document,
      false,
    ).document as any;
    target.chunks[0].cellOverrides[0].extensions = {
      shared: { beta: 2, alpha: 1 },
      targetOnly: { value: true },
    };
    const fragment = structuredClone(source.fragment) as any;
    fragment.objects.cellOverrides[0].extensions = {
      shared: { alpha: 1, beta: 2 },
      sourceOnly: { ordered: [2, 1] },
    };
    const plan = planFragmentMerge(target, fragment, {
      currentAppVersion: APP_VERSION,
      resolver: externalResolver(),
    });
    readyPlan(plan);
    const result = applyFragmentMerge(target, fragment, plan, {
      currentAppVersion: APP_VERSION,
      resolver: externalResolver(),
      uuidGenerator: uuidSequence(),
    });
    expect(result.project.chunks[0]?.cellOverrides[0]?.extensions).toEqual({
      shared: { beta: 2, alpha: 1 },
      targetOnly: { value: true },
      sourceOnly: { ordered: [2, 1] },
    });
    validateProjectDocumentV1(result.project);

    fragment.objects.cellOverrides[0].extensions.shared = {
      alpha: 1,
      beta: 3,
    };
    expect(
      planFragmentMerge(target, fragment, {
        currentAppVersion: APP_VERSION,
        resolver: externalResolver(),
      }),
    ).toMatchObject({
      status: "blocked",
      code: "fragment-cell-extensions-conflict",
      details: { extensionKey: "shared" },
    });
  });

  it("resolver、rule、UUID、时钟与中途故障均稳定且输入零残留", () => {
    const external = createExternalFragment();
    const externalTarget = addExternalModule(
      createTarget("square"),
      false,
    ).document;
    const externalTargetBefore = JSON.stringify(externalTarget);
    const externalFragmentBefore = JSON.stringify(external.fragment);
    expect(
      preflightFragmentMerge(externalTarget, external.fragment, {
        currentAppVersion: APP_VERSION,
        resolver: {
          resolve: () => {
            throw new Error("resolver-fault");
          },
        },
      }),
    ).toMatchObject({ status: "blocked", code: "module-resolver-failed" });
    expect(JSON.stringify(externalTarget)).toBe(externalTargetBefore);
    expect(JSON.stringify(external.fragment)).toBe(externalFragmentBefore);

    const target = createTarget("square");
    const fragment = createBasicFragment("square", 2, 2);
    const targetBefore = JSON.stringify(target);
    const fragmentBefore = JSON.stringify(fragment);
    expect(
      planFragmentMerge(target, fragment, {
        currentAppVersion: APP_VERSION,
        rules: [
          {
            evaluate: () => {
              throw new Error("rule-fault");
            },
          },
        ],
      }),
    ).toMatchObject({
      status: "blocked",
      code: "fragment-rule-evaluation-failed",
    });
    expect(
      planFragmentMerge(target, fragment, {
        currentAppVersion: APP_VERSION,
        rules: [
          {
            evaluate: () => [{ severity: "invalid", code: "x" }] as never,
          },
        ],
      }),
    ).toMatchObject({
      status: "blocked",
      code: "fragment-rule-result-invalid",
    });
    const mutationPlan = planFragmentMerge(target, fragment, {
      currentAppVersion: APP_VERSION,
      rules: [
        {
          evaluate(context) {
            expect(Object.isFrozen(context.target)).toBe(true);
            expect(Object.isFrozen(context.fragment.objects)).toBe(true);
            expect(Object.isFrozen(context.translatedObjects.overlays)).toBe(
              true,
            );
            try {
              (context.target as any).name = "mutated";
            } catch {
              // 冻结快照在严格模式下拒绝写入。
            }
            return [];
          },
        },
      ],
    });
    readyPlan(mutationPlan);
    expect(JSON.stringify(target)).toBe(targetBefore);
    expect(JSON.stringify(fragment)).toBe(fragmentBefore);
    const plan = planFragmentMerge(target, fragment, {
      currentAppVersion: APP_VERSION,
    });
    readyPlan(plan);
    expect(() =>
      applyFragmentMerge(target, fragment, plan, {
        currentAppVersion: APP_VERSION,
        uuidGenerator: () => {
          throw new Error("uuid-fault");
        },
      }),
    ).toThrowError(
      expect.objectContaining({ code: "fragment-uuid-generation-failed" }),
    );
    const oldInstanceId =
      fragment.objects.cellOverrides[0]?.layerInstances[0]?.instanceId;
    expect(oldInstanceId).toBeDefined();
    expect(() =>
      applyFragmentMerge(target, fragment, plan, {
        currentAppVersion: APP_VERSION,
        uuidGenerator: () => oldInstanceId ?? "",
      }),
    ).toThrowError(
      expect.objectContaining({ code: "fragment-uuid-generation-invalid" }),
    );
    let generated = 0;
    const generatedValues = uuidSequence();
    expect(() =>
      applyFragmentMerge(target, fragment, plan, {
        currentAppVersion: APP_VERSION,
        uuidGenerator: () => {
          generated += 1;
          if (generated === 3) throw new Error("uuid-mid-fault");
          return generatedValues();
        },
      }),
    ).toThrowError(
      expect.objectContaining({ code: "fragment-uuid-generation-failed" }),
    );
    expect(() =>
      applyFragmentMerge(target, fragment, plan, {
        currentAppVersion: APP_VERSION,
        uuidGenerator: uuidSequence(),
        now: () => {
          throw new Error("clock-fault");
        },
      }),
    ).toThrowError(expect.objectContaining({ code: "fragment-clock-failed" }));
    expect(() =>
      applyFragmentMerge(target, fragment, plan, {
        currentAppVersion: APP_VERSION,
        uuidGenerator: uuidSequence(),
        now: () => "invalid-date-time",
      }),
    ).toThrowError(
      expect.objectContaining({ code: "fragment-merge-result-invalid" }),
    );
    expect(JSON.stringify(target)).toBe(targetBefore);
    expect(JSON.stringify(fragment)).toBe(fragmentBefore);
  });

  it.each([
    "after-id-remap",
    "after-cell-merge",
    "after-edge-merge",
    "before-validation",
  ] as const)("failureHook %s 零残留", (failureStep) => {
    const target = createTarget("square");
    const fragment = createBasicFragment("square", 2, 2);
    const beforeTarget = JSON.stringify(target);
    const beforeFragment = JSON.stringify(fragment);
    const plan = planFragmentMerge(target, fragment, {
      currentAppVersion: APP_VERSION,
      rules: [
        {
          evaluate: () => [
            { severity: "warning", code: "capacity-near-limit" },
          ],
        },
      ],
    });
    readyPlan(plan);
    expect(plan.warnings).toEqual([
      { severity: "warning", code: "capacity-near-limit" },
    ]);
    expect(() =>
      applyFragmentMerge(target, fragment, plan, {
        currentAppVersion: APP_VERSION,
        rules: [
          {
            evaluate: () => [
              { severity: "warning", code: "capacity-near-limit" },
            ],
          },
        ],
        uuidGenerator: uuidSequence(),
        failureHook: (step) => {
          if (step === failureStep) throw new Error(`fault-${failureStep}`);
        },
      }),
    ).toThrowError(`fault-${failureStep}`);
    expect(JSON.stringify(target)).toBe(beforeTarget);
    expect(JSON.stringify(fragment)).toBe(beforeFragment);
  });
});
