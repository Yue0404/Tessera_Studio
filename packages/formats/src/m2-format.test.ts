import {
  createProject,
  cellCenter,
  domainGroupExtensionsWithLayout,
  edgeIdentity,
  EditorStore,
  type GridType,
} from "@tessera/core";
import { describe, expect, it } from "vitest";
import { computeProjectContentBounds } from "./content-bounds.js";
import {
  createFragmentV1,
  createPartialProjectV1,
  FragmentFormatError,
  parseProjectDocumentV1,
  ProjectFormatError,
  stringifyProjectDocumentV1,
  toProjectV1,
  validateFragmentDocumentV1,
  validateProjectDocumentV1,
} from "./index.js";

function createStore(type: GridType = "square"): EditorStore {
  return new EditorStore(
    createProject({
      name: "M2 format",
      grid: { type, width: 128, height: 128, cellSize: 32 },
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

function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  const chunkSize = 32 * 1024;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    let binary = "";
    const end = Math.min(offset + chunkSize, bytes.length);
    for (let index = offset; index < end; index += 1) {
      binary += String.fromCharCode(bytes[index] ?? 0);
    }
    chunks.push(binary);
  }
  return btoa(chunks.join(""));
}

function expectProjectError(action: () => void, code: string): void {
  try {
    action();
    throw new Error("expected-project-error");
  } catch (error) {
    expect(error).toBeInstanceOf(ProjectFormatError);
    expect(error).toMatchObject({ code, message: code });
  }
}

function edgeReferenceDocument(explicitStyle = false): any {
  const store = createStore();
  const edge = edgeIdentity(store.state.grid, { row: 70, column: 70 }, 1);
  if (explicitStyle) {
    store.paintEdge(edge.edgeId, edge.adjacentCellIds, "#E3614DFF");
  }
  store.placeEdgeMarker({
    instanceId: crypto.randomUUID(),
    ...edge,
    strokeColor: "#59656AFF",
    strokeWidth: 1,
    strokeOpacity: 1,
    lineStyle: "solid",
  });
  store.createConnection(
    { kind: "edge-midpoint", edgeId: edge.edgeId },
    { kind: "map-point", point: { x: 3_000.5, y: 2_000.25 } },
    "line",
  );
  return toProjectV1(store.state) as any;
}

describe("M2 Project/Fragment v1 closure", () => {
  it("同一 cell 支持按 layerId/instanceId 排序的多模块实例", () => {
    const store = createStore();
    store.paintCell(0, 0, "#E3614DFF");
    const document = toProjectV1(store.state) as any;
    document.modules.push({
      moduleId: "zz.terrain",
      version: "1.0.0",
      packageSourceKind: "user-file",
      extensions: {},
    });
    document.layerStates.push({
      layerId: "zz.terrain.surface",
      moduleVersion: "1.0.0",
      zIndex: 4_900,
      visible: true,
      locked: false,
      opacity: 1,
      extensions: {},
    });
    document.chunks[0].cellOverrides[0].layerInstances.push({
      instanceId: crypto.randomUUID(),
      elementId: "zz.terrain:surface.grass",
      layerId: "zz.terrain.surface",
      styleOverrides: { variant: "grass" },
      attributes: { elevation: 1 },
      extensions: {},
    });
    expect(document.chunks[0].cellOverrides[0].layerInstances).toHaveLength(2);
    validateProjectDocumentV1(document);
  });

  it("cellSize 格式域接受任意有限正数而拒绝 0", () => {
    const document = toProjectV1(createStore().state) as any;
    for (const cellSize of [0.000_001, Number.MAX_VALUE]) {
      document.grid.cellSize = cellSize;
      validateProjectDocumentV1(document);
    }
    document.grid.cellSize = 0;
    expectProjectError(
      () => validateProjectDocumentV1(document),
      "project-schema-invalid",
    );
  });

  it("严格拒绝非规范坐标、超安全整数与大写 UUID", () => {
    const store = createStore();
    store.paintCell(0, 0, "#E3614DFF");
    const document = toProjectV1(store.state) as any;
    document.chunks[0].cellOverrides[0].cellId = "cell:square:00:0";
    expectProjectError(
      () => validateProjectDocumentV1(document),
      "project-schema-invalid",
    );

    document.chunks[0].cellOverrides[0].cellId =
      "cell:square:9007199254740992:0";
    expectProjectError(
      () => validateProjectDocumentV1(document),
      "project-schema-invalid",
    );

    const uppercaseUuid = toProjectV1(createStore().state) as any;
    uppercaseUuid.projectId = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
    expectProjectError(
      () => validateProjectDocumentV1(uppercaseUuid),
      "project-schema-invalid",
    );
  });

  it("严格校验 SemVer 2.0 与 RFC3339 实际日历日期", () => {
    const document = toProjectV1(createStore().state) as any;
    document.createdWithAppVersion = "1.0.0-01";
    expectProjectError(
      () => validateProjectDocumentV1(document),
      "project-schema-invalid",
    );

    document.createdWithAppVersion = "0.1.0";
    document.createdAt = "2026-99-99T25:61:61+99:99";
    expectProjectError(
      () => validateProjectDocumentV1(document),
      "project-schema-invalid",
    );

    document.createdAt = "2025-02-29T12:00:00+08:00";
    expectProjectError(
      () => validateProjectDocumentV1(document),
      "project-schema-invalid",
    );

    document.createdAt = "2024-02-29T12:00:00+08:00";
    document.updatedAt = "2024-02-29T12:00:00+08:00";
    validateProjectDocumentV1(document);
  });

  it("module/layer/element ID 必须使用冻结的小写点命名空间", () => {
    const document = toProjectV1(createStore().state) as any;
    document.modules[0].moduleId = "Tessera.Basic";
    expectProjectError(
      () => validateProjectDocumentV1(document),
      "project-schema-invalid",
    );

    const store = createStore();
    store.paintCell(0, 0, "#E3614DFF");
    const invalidElement = toProjectV1(store.state) as any;
    invalidElement.chunks[0].cellOverrides[0].layerInstances[0].elementId =
      "tessera.basic:Cell.Color";
    expectProjectError(
      () => validateProjectDocumentV1(invalidElement),
      "project-schema-invalid",
    );
  });

  it("拒绝分块逆序、错误 Edge owner 与 contentBounds 浮点偏差", () => {
    const store = createStore();
    store.paintCell(0, 0, "#E3614DFF");
    const edge = edgeIdentity(store.state.grid, { row: 70, column: 70 }, 1);
    store.placeEdgeMarker({
      instanceId: crypto.randomUUID(),
      ...edge,
      strokeColor: "#59656AFF",
      strokeWidth: 1,
      strokeOpacity: 1,
      lineStyle: "solid",
    });

    const unsorted = structuredClone(toProjectV1(store.state)) as any;
    unsorted.chunks.reverse();
    expectProjectError(
      () => validateProjectDocumentV1(unsorted),
      "chunk-order-invalid",
    );

    const wrongOwner = edgeReferenceDocument();
    wrongOwner.chunks[0].chunkRow = 0;
    wrongOwner.chunks[0].chunkColumn = 0;
    expectProjectError(
      () => validateProjectDocumentV1(wrongOwner),
      "edge-owner-chunk-invalid",
    );

    const wrongBounds = structuredClone(toProjectV1(store.state)) as any;
    wrongBounds.contentBounds.minX += 1;
    expectProjectError(
      () => validateProjectDocumentV1(wrongBounds),
      "content-bounds-mismatch",
    );
  });

  it("reference-only Edge 必须被引用，edge-midpoint 引用可闭合", () => {
    const document = edgeReferenceDocument();
    const overlayIds = new Set(
      document.managers.overlayManager.overlays.map(
        (overlay: any) => overlay.overlayId,
      ),
    );
    document.managers.overlayManager.overlays = [];
    for (const chunk of document.chunks) {
      chunk.ownedOverlayIds = chunk.ownedOverlayIds.filter(
        (overlayId: string) => !overlayIds.has(overlayId),
      );
    }
    document.contentBounds = computeProjectContentBounds(document);
    validateProjectDocumentV1(document);

    document.managers.connectionManager.connections = [];
    document.contentBounds = computeProjectContentBounds(document);
    expectProjectError(
      () => validateProjectDocumentV1(document),
      "reference-only-edge-orphan",
    );
  });

  it("DomainGroup 只能归属确定 owner chunk 且不能重复归属", () => {
    const document = toProjectV1(createStore().state) as any;
    const groupId = crypto.randomUUID();
    document.modules.push({
      moduleId: "zz.group",
      version: "1.0.0",
      packageSourceKind: "user-file",
      extensions: {},
    });
    document.layerStates.push({
      layerId: "zz.group.region",
      moduleVersion: "1.0.0",
      zIndex: 5_000,
      visible: true,
      locked: false,
      opacity: 1,
      extensions: {},
    });
    document.domainGroups = [
      {
        kind: "domain-group",
        groupId,
        elementId: "zz.group:region",
        layerId: "zz.group.region",
        memberCellIds: ["cell:square:70:70", "cell:square:70:71"],
        attributes: {},
        styleOverrides: {},
        extensions: {},
      },
    ];
    const ownedChunk = (chunkRow: number, chunkColumn: number) => ({
      chunkRow,
      chunkColumn,
      cellOverrides: [],
      ownedEdgeIds: [],
      ownedOverlayIds: [],
      ownedDomainGroupIds: [groupId],
      extensions: {},
    });
    document.chunks = [ownedChunk(0, 0), ownedChunk(1, 1)];
    document.contentBounds = computeProjectContentBounds(document);
    expectProjectError(
      () => validateProjectDocumentV1(document),
      "domain-group-owned-by-multiple-chunks",
    );
  });

  it("Project v1 接受 4096 个领域成员并在 4097 个成员时拒绝", () => {
    const largeGrid = {
      type: "square" as const,
      width: 4_098,
      height: 2,
      cellSize: 32,
    };
    const document = toProjectV1(
      createProject({
        name: "大领域",
        grid: largeGrid,
        style: {
          canvasBackground: "#09141DFF",
          defaultCellColor: "#14232DFF",
          gridColor: "#59656AFF",
          gridOpacity: 0.7,
          gridWidth: 1,
          defaultEdgeColor: "#59656AFF",
        },
      }),
    ) as any;
    const groupId = crypto.randomUUID();
    const memberCellIds = Array.from(
      { length: 4_096 },
      (_, column) => `cell:square:0:${column}`,
    );
    document.modules.push({
      moduleId: "zz.group",
      version: "1.0.0",
      packageSourceKind: "user-file",
      extensions: {},
    });
    document.layerStates.push({
      layerId: "zz.group.region",
      moduleVersion: "1.0.0",
      zIndex: 5_000,
      visible: true,
      locked: false,
      opacity: 1,
      extensions: {},
    });
    document.domainGroups = [
      {
        kind: "domain-group",
        groupId,
        elementId: "zz.group:region",
        layerId: "zz.group.region",
        memberCellIds,
        attributes: {},
        styleOverrides: {},
        extensions: domainGroupExtensionsWithLayout(
          largeGrid,
          memberCellIds,
          {},
        ),
      },
    ];
    document.chunks = [
      {
        chunkRow: 0,
        chunkColumn: 0,
        cellOverrides: [],
        ownedEdgeIds: [],
        ownedOverlayIds: [],
        ownedDomainGroupIds: [groupId],
        extensions: {},
      },
    ];
    document.contentBounds = computeProjectContentBounds(document);
    expect(() => validateProjectDocumentV1(document)).not.toThrow();

    document.domainGroups[0].memberCellIds.push("cell:square:0:4096");
    expectProjectError(
      () => validateProjectDocumentV1(document),
      "project-schema-invalid",
    );
  });

  it("部分 Project 与 Fragment 保存穿过范围的完整 Connection 端点", () => {
    const store = createStore();
    store.createConnection(
      { kind: "map-point", point: { x: 100.5, y: 16.25 } },
      { kind: "map-point", point: { x: 2000.75, y: 16.25 } },
      "line",
    );
    const source = toProjectV1(store.state) as any;
    const selection = {
      bounds: { minX: 900, minY: 0, maxX: 1100, maxY: 32 },
      includedLayerIds: ["tessera.basic.connection"],
    };
    const partial = createPartialProjectV1(source, selection) as any;
    const fragment = createFragmentV1(source, {
      ...selection,
      fragmentId: crypto.randomUUID(),
    }) as any;

    expect(partial).toMatchObject({
      exportScope: "partial",
      isComplete: false,
      grid: { width: 128, height: 128 },
    });
    expect(partial.managers.connectionManager.connections[0]).toMatchObject({
      start: { point: { x: 100.5, y: 16.25 } },
      end: { point: { x: 2000.75, y: 16.25 } },
    });
    expect(fragment.objects.connections[0]).toEqual(
      partial.managers.connectionManager.connections[0],
    );
    expect(fragment.requiredModules).toEqual([
      { moduleId: "tessera.basic", version: "1.0.0", extensions: {} },
    ]);
  });

  it.each(["square", "hex-pointy"] as const)(
    "%s Project 拒绝地图真实几何外的自由锚点与连线端点",
    (type) => {
      const store = createStore(type);
      const first = cellCenter(store.state.grid, 0, 0);
      const second = cellCenter(store.state.grid, 1, 1);
      store.placeMarker(first);
      store.createConnection(
        { kind: "map-point", point: first },
        { kind: "map-point", point: second },
        "line",
      );
      const valid = toProjectV1(store.state) as any;
      validateProjectDocumentV1(valid);
      const outside = type === "square" ? { x: -0.001, y: 16 } : { x: 0, y: 0 };

      const invalidOverlay = structuredClone(valid);
      const projectOverlay =
        invalidOverlay.managers.overlayManager.overlays.at(0);
      expect(projectOverlay).toBeDefined();
      if (projectOverlay?.kind !== "free-overlay") {
        throw new Error("expected-free-overlay");
      }
      projectOverlay.point = outside;
      try {
        validateProjectDocumentV1(invalidOverlay);
        throw new Error("expected-project-error");
      } catch (error) {
        expect(error).toBeInstanceOf(ProjectFormatError);
        expect(error).toMatchObject({
          code: "map-point-out-of-bounds",
          details: {
            pointer: expect.stringMatching(/\/overlays\/[^/]+\/point$/u),
          },
        });
      }

      const invalidConnection = structuredClone(valid);
      const projectConnection =
        invalidConnection.managers.connectionManager.connections.at(0);
      expect(projectConnection).toBeDefined();
      if (projectConnection?.end.kind !== "map-point") {
        throw new Error("expected-map-point-endpoint");
      }
      projectConnection.end.point = outside;
      try {
        validateProjectDocumentV1(invalidConnection);
        throw new Error("expected-project-error");
      } catch (error) {
        expect(error).toBeInstanceOf(ProjectFormatError);
        expect(error).toMatchObject({
          code: "map-point-out-of-bounds",
          details: {
            pointer: expect.stringMatching(
              /\/connections\/[^/]+\/end\/point$/u,
            ),
          },
        });
      }
    },
  );

  it.each(["square", "hex-pointy"] as const)(
    "%s Fragment 拒绝来源地图真实几何外的自由锚点与连线端点",
    (type) => {
      const store = createStore(type);
      const first = cellCenter(store.state.grid, 0, 0);
      const second = cellCenter(store.state.grid, 1, 1);
      store.placeMarker(first);
      store.createConnection(
        { kind: "map-point", point: first },
        { kind: "map-point", point: second },
        "line",
      );
      const source = toProjectV1(store.state) as any;
      const fragment = createFragmentV1(source, {
        bounds: { minX: 0, minY: 0, maxX: 160, maxY: 160 },
        includedLayerIds: [
          "tessera.basic.placed-object",
          "tessera.basic.connection",
        ],
        fragmentId: crypto.randomUUID(),
      }) as any;
      validateFragmentDocumentV1(fragment);
      const outside = type === "square" ? { x: -0.001, y: 16 } : { x: 0, y: 0 };

      const invalidOverlay = structuredClone(fragment);
      const fragmentOverlay = invalidOverlay.objects.overlays.at(0);
      expect(fragmentOverlay).toBeDefined();
      if (fragmentOverlay?.kind !== "free-overlay") {
        throw new Error("expected-free-overlay");
      }
      fragmentOverlay.point = outside;
      expect(() => validateFragmentDocumentV1(invalidOverlay)).toThrowError(
        expect.objectContaining({
          code: "map-point-out-of-bounds",
          details: {
            pointer: expect.stringMatching(/\/overlays\/[^/]+\/point$/u),
          },
        }),
      );

      const invalidConnection = structuredClone(fragment);
      const fragmentConnection = invalidConnection.objects.connections.at(0);
      expect(fragmentConnection).toBeDefined();
      if (fragmentConnection?.start.kind !== "map-point") {
        throw new Error("expected-map-point-endpoint");
      }
      fragmentConnection.start.point = outside;
      expect(() => validateFragmentDocumentV1(invalidConnection)).toThrowError(
        expect.objectContaining({
          code: "map-point-out-of-bounds",
          details: {
            pointer: expect.stringMatching(
              /\/connections\/[^/]+\/start\/point$/u,
            ),
          },
        }),
      );
    },
  );

  it("未选择 edge-style 时保留无 layer instance 的 reference-only 结构 Edge", () => {
    const source = edgeReferenceDocument(true);
    source.managers.connectionManager.connections = [];
    source.contentBounds = computeProjectContentBounds(source);
    const overlay = source.managers.overlayManager.overlays[0];
    const edge = source.managers.edgeManager.edges[0];
    const sourceBounds = computeProjectContentBounds(source);
    if (sourceBounds === null) throw new Error("expected-content-bounds");
    const partial = createPartialProjectV1(source, {
      bounds: sourceBounds,
      includedLayerIds: [overlay.layerId],
    }) as any;
    const projected = partial.managers.edgeManager.edges[0];

    expect(partial.lineage.includedLayerIds).not.toContain(
      "tessera.basic.edge-style",
    );
    expect(edge.layerInstances).toHaveLength(1);
    expect(edge.layerInstances[0].attributes).toEqual({
      persistence: "explicit-style",
    });
    expect(projected.edgeId).toBe(edge.edgeId);
    expect(projected.layerInstances).toEqual([]);
    expect(
      partial.chunks.some((chunk: any) =>
        chunk.ownedEdgeIds.includes(projected.edgeId),
      ),
    ).toBe(true);
    expect(partial.managers.overlayManager.overlays[0]).toMatchObject({
      kind: "anchored-overlay",
      anchor: { kind: "edge", edgeId: projected.edgeId },
    });
  });

  it("尖顶六边形 bbox 的空角区域不会误选地格", () => {
    const store = createStore("hex-pointy");
    store.paintCell(0, 0, "#E3614DFF");
    const partial = createPartialProjectV1(toProjectV1(store.state) as any, {
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      includedLayerIds: ["tessera.basic.cell-style"],
    }) as any;
    expect(partial.chunks).toEqual([]);
    expect(partial.contentBounds).toBeNull();
  });

  it("extensions 保留 JSON 语义，非 extensions 未知字段和重复键拒绝", () => {
    const document = toProjectV1(createStore().state) as any;
    document.extensions = {
      vendor: {
        ordered: [3, { nested: [true, null, "value"] }, 1],
        object: { alpha: 1, beta: "two" },
      },
    };
    const restored = parseProjectDocumentV1(
      stringifyProjectDocumentV1(document),
    ) as any;
    expect(restored.extensions).toEqual(document.extensions);

    const unknown = structuredClone(document);
    unknown.mapStyle.unknown = true;
    expectProjectError(
      () => validateProjectDocumentV1(unknown),
      "project-schema-invalid",
    );

    const text = JSON.stringify(document).replace(
      `"name":"${document.name}"`,
      `"name":"${document.name}","name":"duplicate"`,
    );
    expectProjectError(
      () => parseProjectDocumentV1(text),
      "project-json-duplicate-key",
    );

    const escaped = JSON.stringify(document).replace(
      `"name":"${document.name}"`,
      `"name":"${document.name}","na\\u006de":"duplicate"`,
    );
    try {
      parseProjectDocumentV1(escaped);
      throw new Error("expected-project-error");
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectFormatError);
      expect(error).toMatchObject({
        code: "project-json-duplicate-key",
        details: { key: "name", pointer: "/name" },
      });
    }

    try {
      parseProjectDocumentV1('{"extensions":{"vendor":{"x":1,"\\u0078":2}}}');
      throw new Error("expected-project-error");
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectFormatError);
      expect(error).toMatchObject({
        code: "project-json-duplicate-key",
        details: { key: "x", pointer: "/extensions/vendor/x" },
      });
    }
  });

  it("内嵌素材独立编号，拒绝伪图片/字体并允许 16 MiB JSON", () => {
    const store = createStore();
    store.paintCell(0, 0, "#E3614DFF");
    const document = toProjectV1(store.state) as any;
    const cellInstanceId =
      document.chunks[0].cellOverrides[0].layerInstances[0].instanceId;
    const json = new TextEncoder().encode("{}");
    document.embeddedAssets = [
      {
        assetId: cellInstanceId,
        mimeType: "application/json",
        bytes: json.byteLength,
        encoding: "base64",
        data: bytesToBase64(json),
        extensions: {},
      },
    ];
    validateProjectDocumentV1(document);

    const fakePng = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    document.embeddedAssets = [
      {
        assetId: crypto.randomUUID(),
        mimeType: "image/png",
        bytes: fakePng.byteLength,
        encoding: "base64",
        data: bytesToBase64(fakePng),
        extensions: {},
      },
    ];
    expectProjectError(
      () => validateProjectDocumentV1(document),
      "embedded-asset-decode-invalid",
    );

    const size = 16 * 1024 * 1024;
    const woff2 = new Uint8Array(64);
    woff2.set(new TextEncoder().encode("wOF2OTTO"));
    const header = new DataView(woff2.buffer);
    header.setUint32(8, woff2.byteLength);
    header.setUint16(12, 1);
    header.setUint32(16, 1);
    document.embeddedAssets = [
      {
        assetId: crypto.randomUUID(),
        mimeType: "font/woff2",
        bytes: woff2.byteLength,
        encoding: "base64",
        data: bytesToBase64(woff2),
        extensions: {},
      },
    ];
    expectProjectError(
      () => validateProjectDocumentV1(document),
      "embedded-asset-decode-invalid",
    );

    const jsonBoundary = new Uint8Array(size);
    jsonBoundary.fill(0x20);
    jsonBoundary[0] = 0x7b;
    jsonBoundary[size - 1] = 0x7d;
    document.embeddedAssets = [
      {
        assetId: crypto.randomUUID(),
        mimeType: "application/json",
        bytes: size,
        encoding: "base64",
        data: bytesToBase64(jsonBoundary),
        extensions: {},
      },
    ];
    validateProjectDocumentV1(document);
  }, 60_000);

  it("Connection 标签限制为 256 字素且最多 8 行", () => {
    const store = createStore();
    store.createConnection(
      { kind: "map-point", point: { x: 0, y: 0 } },
      { kind: "map-point", point: { x: 64, y: 64 } },
      "line",
    );
    const document = toProjectV1(store.state) as any;
    document.managers.connectionManager.connections[0].label = Array.from(
      { length: 9 },
      () => "line",
    ).join("\n");
    expectProjectError(
      () => validateProjectDocumentV1(document),
      "text-line-limit-exceeded",
    );

    document.managers.connectionManager.connections[0].label = "😀".repeat(257);
    expectProjectError(
      () => validateProjectDocumentV1(document),
      "text-grapheme-limit-exceeded",
    );
  });

  it("Fragment 对排序反例和多余 requiredModules 使用稳定错误码", () => {
    const store = createStore();
    store.createConnection(
      { kind: "map-point", point: { x: 0, y: 0 } },
      { kind: "map-point", point: { x: 64, y: 64 } },
      "line",
    );
    const fragment = createFragmentV1(toProjectV1(store.state) as any, {
      fragmentId: crypto.randomUUID(),
      bounds: { minX: 0, minY: 0, maxX: 64, maxY: 64 },
      includedLayerIds: ["tessera.basic.connection"],
    }) as any;
    for (const invalidCellId of [
      "cell:square:00:0",
      "cell:square:9007199254740992:0",
    ]) {
      const invalid = structuredClone(fragment);
      invalid.objects.connections[0].start = {
        kind: "cell-center",
        cellId: invalidCellId,
        extensions: {},
      };
      try {
        validateFragmentDocumentV1(invalid);
        throw new Error("expected-fragment-error");
      } catch (error) {
        expect(error).toBeInstanceOf(FragmentFormatError);
        expect(error).toMatchObject({ code: "fragment-schema-invalid" });
        expect(
          (error as FragmentFormatError).issues[0]?.instancePath,
        ).toContain("/objects/connections/0/start");
      }
    }
    fragment.requiredModules.push({
      moduleId: "unused.module",
      version: "1.0.0",
      extensions: {},
    });
    try {
      validateFragmentDocumentV1(fragment);
      throw new Error("expected-fragment-error");
    } catch (error) {
      expect(error).toBeInstanceOf(FragmentFormatError);
      expect(error).toMatchObject({
        code: "fragment-required-module-set-invalid",
      });
    }
  });
});
