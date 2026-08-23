import { describe, expect, it } from "vitest";
import {
  BASIC_MODULE_PACKAGE,
  BLANK_PRESET_PACKAGE,
  BuiltInPackageSource,
  ModuleRuntimeError,
  buildPackageRegistry,
  createMigrationPlan,
  packageSourcesEquivalent,
  parseExtensionPackageSource,
  readPackageFileBytes,
  readPackageSource,
  resolveLocalizedText,
  type ExtensionPackageSource,
  type ModuleManifest,
  type PackageFileSet,
  type ParsedModulePackage,
  type PresetManifest,
  type ResourceDecodeGateway,
} from "./index.js";
import { parsePackageFileSetForTests } from "./parser.js";
import { packageFileSetsEquivalent } from "./source.js";

const encoder = new TextEncoder();

function chunkedSource(
  files: Readonly<Record<string, Uint8Array | string>>,
  options: {
    readonly declaredBytes?: Readonly<Record<string, number>>;
    readonly chunkSize?: number;
    readonly onOpen?: (path: string) => void;
    readonly afterChunk?: (path: string, index: number) => void;
  } = {},
): ExtensionPackageSource {
  const entries = Object.entries(files).map(
    ([path, value]) =>
      [
        path,
        typeof value === "string" ? encoder.encode(value) : value,
      ] as const,
  );
  return {
    origin: "user-file",
    async *listFiles(signal?: AbortSignal) {
      for (const [path, bytes] of entries) {
        if (signal?.aborted === true) throw new DOMException("", "AbortError");
        yield {
          path,
          bytes: options.declaredBytes?.[path] ?? bytes.byteLength,
        };
      }
    },
    async *openFile(path: string, signal?: AbortSignal) {
      options.onOpen?.(path);
      const bytes = entries.find(([candidate]) => candidate === path)?.[1];
      if (bytes === undefined) throw new Error("测试文件不存在");
      const chunkSize = options.chunkSize ?? Math.max(1, bytes.byteLength);
      let index = 0;
      for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
        if (signal?.aborted === true) throw new DOMException("", "AbortError");
        yield bytes.slice(offset, offset + chunkSize);
        options.afterChunk?.(path, index);
        index += 1;
      }
    },
  };
}

function sourceFromValues(
  values: Readonly<Record<string, unknown>>,
  options: Parameters<typeof chunkedSource>[1] = {},
): ExtensionPackageSource {
  return chunkedSource(
    Object.fromEntries(
      Object.entries(values).map(([path, value]) => [
        path,
        JSON.stringify(value),
      ]),
    ),
    options,
  );
}

function jsonFiles(
  values: Readonly<Record<string, unknown>>,
  origin: PackageFileSet["origin"] = "user-file",
): PackageFileSet {
  return {
    origin,
    files: Object.entries(values).map(([path, value]) => ({
      path,
      bytes: encoder.encode(JSON.stringify(value)),
    })),
  };
}

function moduleValues(
  moduleId: string,
  options: {
    version?: string;
    dependencies?: ModuleManifest["dependencies"];
    appVersion?: ModuleManifest["appVersion"];
    grids?: ModuleManifest["supportedGrids"];
    packageSource?: ModuleManifest["packageSource"];
    migrationFiles?: readonly string[];
    migrations?: Readonly<Record<string, unknown>>;
  } = {},
): Record<string, unknown> {
  const elementId = `${moduleId}:marker`;
  const manifest: ModuleManifest = {
    formatVersion: "1",
    kind: "module",
    moduleId,
    version: options.version ?? "1.0.0",
    nameKey: { kind: "literal", language: "zh-CN", text: `${moduleId} 名称` },
    descriptionKey: {
      kind: "literal",
      language: "zh-CN",
      text: `${moduleId} 说明`,
    },
    authors: ["测试作者"],
    appVersion: options.appVersion ?? { min: "0.1.0" },
    supportedGrids: options.grids ?? ["square", "hex-pointy"],
    dependencies: options.dependencies ?? [],
    layers: [
      {
        layerId: `${moduleId}.marker`,
        nameKey: { kind: "literal", language: "zh-CN", text: "标记层" },
        zIndex: 3000,
        allowedPrimitives: ["marker"],
        allowedAnchors: ["cell", "map-point"],
        defaultVisible: true,
        defaultLocked: false,
        defaultOpacity: 1,
        extensions: {},
      },
    ],
    elementFiles: ["elements/marker.json"],
    constraintFiles: [],
    migrationFiles: options.migrationFiles ?? [],
    catalogManifestPath: null,
    defaultLanguage: "zh-CN",
    locales: {},
    resources: [],
    capabilities: ["anchored-overlay", "free-overlay"],
    packageSource: options.packageSource ?? {
      kind: "user-file",
      publisher: "测试发布者",
      publishedAt: "2026-08-21T00:00:00Z",
    },
    extensions: {},
  };
  const element = {
    elementId,
    categoryId: `${moduleId}:category.marker`,
    nameKey: { kind: "literal", language: "zh-CN", text: "标记" },
    descriptionKey: { kind: "literal", language: "zh-CN", text: "标记说明" },
    primitive: "marker",
    layerId: `${moduleId}.marker`,
    anchors: ["cell", "map-point"],
    supportedGrids: [...manifest.supportedGrids],
    defaultStyle: {
      shape: "circle",
      color: "#E3614DFF",
      opacity: 1,
      displaySize: 16,
      rotation: 0,
    },
    attributeSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
    occupancy: [],
    constraintIds: [],
    resourceIds: [],
    source: {
      sourceId: `${moduleId}:source.test`,
      rulesetId: "test-rules-v1",
      contentVersion: "1",
      retrievedAt: "2026-08-21T00:00:00Z",
    },
    extensions: {},
  };
  return {
    "module.json": manifest,
    "elements/marker.json": [element],
    ...(options.migrations ?? {}),
  };
}

function parseModule(
  moduleId: string,
  options?: Parameters<typeof moduleValues>[1],
): ParsedModulePackage {
  return parsePackageFileSetForTests(
    jsonFiles(moduleValues(moduleId, options)),
  ) as ParsedModulePackage;
}

function presetValues(presetId: string): Record<string, unknown> {
  const manifest: PresetManifest = {
    formatVersion: "1",
    kind: "preset",
    presetId,
    version: "1.0.0",
    nameKey: { kind: "literal", language: "zh-CN", text: "测试预设" },
    descriptionKey: { kind: "literal", language: "zh-CN", text: "预设说明" },
    authors: ["测试作者"],
    appVersion: { min: "0.1.0" },
    modules: [
      {
        moduleId: "tessera.basic",
        versionRange: "^1.0.0",
        required: true,
        extensions: {},
      },
    ],
    grid: {
      supportedGrids: ["square"],
      defaultGrid: "square",
      minWidth: 1,
      maxWidth: 40000,
      minHeight: 1,
      maxHeight: 40000,
      cellSize: 32,
      mapStyle: {},
      extensions: {},
    },
    layerStates: [
      {
        layerId: "tessera.basic.cell-style",
        visible: true,
        locked: false,
        opacity: 1,
      },
    ],
    panelLayout: { openCategories: ["tessera.basic:category.cell"] },
    defaultLanguage: "zh-CN",
    locales: {},
    packageSource: {
      kind: "user-file",
      publisher: "测试发布者",
      publishedAt: "2026-08-21T00:00:00Z",
    },
    extensions: {},
  };
  return { "preset.json": manifest };
}

function generatedCiv6Values(): Record<string, unknown> {
  const values = moduleValues("tessera.civ6", {
    grids: ["hex-pointy"],
    dependencies: [
      { moduleId: "tessera.basic", versionRange: "^1.0.0", optional: false },
    ],
    packageSource: {
      kind: "generated-local",
      generatorId: "tessera.civ6-extractor",
      generatorVersion: "1.0.0",
      generatedAt: "2026-08-21T00:00:00Z",
      sourceProduct: "Sid Meier's Civilization VI",
      sourceManifestPath: "provenance/source.json",
      sourceMetadata: {
        sourceBuild: "1.0.12.68",
        rulesetId: "civ6-standard-v1",
        dlcIds: ["DLC_A"],
        artDefVersion: "1",
        extensions: {},
      },
      extensions: {},
    },
  });
  const manifest = values["module.json"] as Record<string, unknown>;
  manifest.capabilities = ["anchored-overlay", "content-catalog"];
  manifest.catalogManifestPath = "catalog/content.json";
  values["catalog/content.json"] = {
    kind: "content-catalog",
    formatVersion: "1",
    moduleId: "tessera.civ6",
    moduleVersion: "1.0.0",
    catalogId: "tessera.civ6:catalog.main",
    catalogVersion: "1.0.0",
    catalogSource: {
      profileId: "tessera.civ6-extractor",
      metadata: { sourceBuild: "1.0.12.68", rulesetId: "civ6-standard-v1" },
      extensions: {},
    },
    categories: [
      {
        categoryId: "tessera.civ6:category.marker",
        nameKey: { kind: "literal", language: "zh-CN", text: "文明 6 标记" },
        count: 1,
        extensions: {},
      },
    ],
    entries: [
      {
        elementId: "tessera.civ6:marker",
        categoryId: "tessera.civ6:category.marker",
        sourceId: "tessera.civ6:source.test",
        contentVersion: "1",
        resourceIds: [],
        extensions: {},
      },
    ],
    extensions: {},
  };
  values["provenance/source.json"] = {
    kind: "generated-source-manifest",
    formatVersion: "1",
    generatorId: "tessera.civ6-extractor",
    files: [],
    extensions: {},
  };
  return values;
}

function expectCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error("expected ModuleRuntimeError");
  } catch (error) {
    expect(error).toBeInstanceOf(ModuleRuntimeError);
    expect(error).toMatchObject({ code });
  }
}

async function expectCodeAsync(
  action: () => Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await action();
    throw new Error("expected ModuleRuntimeError");
  } catch (error) {
    expect(error).toBeInstanceOf(ModuleRuntimeError);
    expect(error).toMatchObject({ code });
  }
}

function firstItem<T>(items: readonly T[]): T {
  const item = items[0];
  if (item === undefined) throw new Error("测试夹具必须包含至少一个条目");
  return item;
}

function firstRecord(values: Readonly<Record<string, unknown>>, path: string) {
  const entries = values[path];
  if (!Array.isArray(entries)) throw new Error(`测试夹具 ${path} 必须是数组`);
  const entry: unknown = firstItem(entries);
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`测试夹具 ${path} 首项必须是对象`);
  }
  return entry as Record<string, unknown>;
}

describe("Module Format v1 结构与本地化", () => {
  it("图层 ID 必须使用所属模块的点分命名空间", () => {
    const moduleId = "example.layer-owner";
    expect(parseModule(moduleId).manifest.layers[0]?.layerId).toBe(
      `${moduleId}.marker`,
    );

    const invalid = moduleValues(moduleId);
    const manifest = invalid["module.json"] as ModuleManifest;
    const layer = manifest.layers[0] as { layerId: string };
    layer.layerId = "example.other.marker";
    try {
      parsePackageFileSetForTests(jsonFiles(invalid));
      throw new Error("expected ModuleRuntimeError");
    } catch (error) {
      expect(error).toBeInstanceOf(ModuleRuntimeError);
      expect(error).toMatchObject({
        code: "package-id-namespace-invalid",
        path: "module.json/layers/0/layerId",
        details: {
          value: "example.other.marker",
          moduleId,
          expectedPrefix: `${moduleId}.`,
        },
      });
    }
  });

  it("内置模块与空白预设通过同一解析器且基础模块不可停用", () => {
    expect(BASIC_MODULE_PACKAGE.artifactId).toBe("tessera.basic");
    expect(BLANK_PRESET_PACKAGE.manifest.modules).toEqual([
      expect.objectContaining({ moduleId: "tessera.basic", required: true }),
    ]);
    expect(
      BASIC_MODULE_PACKAGE.manifest.layers.map(({ layerId, zIndex }) => [
        layerId,
        zIndex,
      ]),
    ).toEqual([
      ["tessera.basic.cell-style", 500],
      ["tessera.basic.edge-style", 1500],
      ["tessera.basic.placed-object", 3000],
      ["tessera.basic.connection", 4300],
      ["tessera.basic.annotation", 4400],
    ]);
  });

  it("literal 模式不需要 locales，key 模式使用默认语言", () => {
    expect(parseModule("example.literal").manifest.locales).toEqual({});
    expect(BASIC_MODULE_PACKAGE.locales["zh-CN"]?.["module.name"]).toBe(
      "初始模块",
    );
  });

  it("默认语言缺 key 稳定拒绝", async () => {
    const files = await Promise.all(
      BASIC_MODULE_PACKAGE.resources.files.map(async (file) => ({
        path: file.path,
        bytes:
          file.path === "locales/zh-CN.json"
            ? encoder.encode(JSON.stringify({ "module.description": "仍存在" }))
            : await readPackageFileBytes(
                BASIC_MODULE_PACKAGE.resources,
                file.path,
                file.bytes,
              ),
      })),
    );
    expectCode(
      () => parsePackageFileSetForTests({ origin: "built-in", files }),
      "package-localized-key-missing",
    );
  });

  it("LocalizedText 混填与未知顶层脚本字段均由 Schema 拒绝", () => {
    const mixed = moduleValues("example.mixed");
    (mixed["module.json"] as Record<string, unknown>).nameKey = {
      kind: "key",
      key: "name",
      text: "混填",
    };
    expectCode(
      () => parsePackageFileSetForTests(jsonFiles(mixed)),
      "package-schema-invalid",
    );
    const scripted = moduleValues("example.scripted");
    (scripted["module.json"] as Record<string, unknown>).script = "alert(1)";
    expectCode(
      () => parsePackageFileSetForTests(jsonFiles(scripted)),
      "package-schema-invalid",
    );
  });

  it("extensions 内形似 LocalizedText 的 opaque 数据不会被错误解析", () => {
    const values = moduleValues("example.opaque-localized");
    const manifest = values["module.json"] as {
      extensions: Record<string, unknown>;
    };
    manifest.extensions.example = {
      kind: "key",
      key: "not-a-product-text",
    };
    expect(parsePackageFileSetForTests(jsonFiles(values))).toMatchObject({
      manifest: {
        extensions: { example: { kind: "key", key: "not-a-product-text" } },
      },
    });
  });

  it("模块与预设入口互斥且制品 ID 不混用", () => {
    expectCode(
      () =>
        parsePackageFileSetForTests(
          jsonFiles({
            ...moduleValues("example.entry"),
            ...presetValues("example.preset.entry"),
          }),
        ),
      "package-entry-invalid",
    );
  });

  it("BuiltInPackageSource 返回副本并支持统一异步解析入口", async () => {
    const source = new BuiltInPackageSource({
      "preset.json": JSON.stringify({
        ...(presetValues("example.preset.source")["preset.json"] as object),
        packageSource: { kind: "built-in" },
      }),
    });
    const parsed = await parseExtensionPackageSource(source);
    expect(parsed).toMatchObject({
      kind: "preset",
      artifactId: "example.preset.source",
    });
  });

  it("LocalizedText 按请求语言回退，literal 不伪造跨语言文本", () => {
    const locales = {
      "zh-CN": { name: "默认名称" },
      "en-US": { name: "Requested name" },
    };
    expect(
      resolveLocalizedText(
        { kind: "key", key: "name" },
        "en-US",
        locales,
        "zh-CN",
      ),
    ).toBe("Requested name");
    expect(
      resolveLocalizedText(
        { kind: "key", key: "name" },
        "ja-JP",
        locales,
        "zh-CN",
      ),
    ).toBe("默认名称");
    expectCode(
      () =>
        resolveLocalizedText(
          { kind: "literal", language: "zh-CN", text: "仅中文" },
          "en-US",
          locales,
          "zh-CN",
        ),
      "package-localized-key-missing",
    );
    expectCode(
      () =>
        resolveLocalizedText(
          { kind: "key", key: "missing" },
          "en-US",
          locales,
          "zh-CN",
        ),
      "package-localized-key-missing",
    );
  });
});

describe("流式包源与资源解码边界", () => {
  it("多 chunk 解析只保留描述与可重开句柄", async () => {
    const parsed = await parseExtensionPackageSource(
      sourceFromValues(moduleValues("example.streaming"), { chunkSize: 3 }),
    );
    expect(
      parsed.resources.files.every((file) => typeof file.bytes === "number"),
    ).toBe(true);
    expect("bytes" in firstItem(parsed.resources.files)).toBe(true);
    expect(
      parsed.resources.files.some(
        (file) => (file as { bytes: unknown }).bytes instanceof Uint8Array,
      ),
    ).toBe(false);
    const first = await readPackageFileBytes(
      parsed.resources,
      "module.json",
      1024 ** 2,
    );
    const second = await readPackageFileBytes(
      parsed.resources,
      "module.json",
      1024 ** 2,
    );
    expect(second).toEqual(first);
  });

  it("枚举元数据超限在打开内容前拒绝，读取中长度欺骗稳定拒绝", async () => {
    let opens = 0;
    const oversized: ExtensionPackageSource = {
      origin: "user-file",
      async *listFiles() {
        yield { path: "module.json", bytes: 2 * 1024 ** 3 + 1 };
      },
      async *openFile() {
        opens += 1;
        yield new Uint8Array();
      },
    };
    await expectCodeAsync(
      () => parseExtensionPackageSource(oversized),
      "package-resource-invalid",
    );
    expect(opens).toBe(0);

    const values = moduleValues("example.length-lie");
    const text = JSON.stringify(values["module.json"]);
    await expectCodeAsync(
      () =>
        parseExtensionPackageSource(
          chunkedSource(
            {
              "module.json": text,
              "elements/marker.json": JSON.stringify(
                values["elements/marker.json"],
              ),
            },
            {
              declaredBytes: {
                "module.json": encoder.encode(text).byteLength - 1,
              },
              chunkSize: 2,
            },
          ),
        ),
      "package-resource-invalid",
    );
    await expectCodeAsync(
      () =>
        parseExtensionPackageSource(
          chunkedSource(
            {
              "module.json": text,
              "elements/marker.json": JSON.stringify(
                values["elements/marker.json"],
              ),
            },
            {
              declaredBytes: {
                "module.json": encoder.encode(text).byteLength + 1,
              },
              chunkSize: 2,
            },
          ),
        ),
      "package-resource-invalid",
    );
  });

  it("取消会在 chunk 边界稳定终止且不返回半成品", async () => {
    const controller = new AbortController();
    const source = sourceFromValues(moduleValues("example.abort"), {
      chunkSize: 2,
      afterChunk(path, index) {
        if (path === "module.json" && index === 0) controller.abort();
      },
    });
    await expectCodeAsync(
      () => parseExtensionPackageSource(source, { signal: controller.signal }),
      "package-aborted",
    );
  });

  it("同版比较支持 JSON 跨 chunk 语义与非 JSON 逐块差异", async () => {
    const left = await readPackageSource(
      chunkedSource(
        {
          "module.json": '{"a":1,"b":[true]}',
          "assets/icon.png": new Uint8Array([1, 2, 3, 4, 5]),
        },
        { chunkSize: 1 },
      ),
    );
    const equivalent = await readPackageSource(
      chunkedSource(
        {
          "module.json": '{ "b": [true], "a": 1 }',
          "assets/icon.png": new Uint8Array([1, 2, 3, 4, 5]),
        },
        { chunkSize: 4 },
      ),
    );
    expect(await packageSourcesEquivalent(left, equivalent)).toBe(true);
    const changed = await readPackageSource(
      chunkedSource(
        {
          "module.json": '{ "a": 1, "b": [true] }',
          "assets/icon.png": new Uint8Array([1, 2, 9, 4, 5]),
        },
        { chunkSize: 2 },
      ),
    );
    expect(await packageSourcesEquivalent(left, changed)).toBe(false);
  });

  it("非内置资源必须经过 decoder，失败稳定且资源逐个释放", async () => {
    const values = moduleValues("example.decode");
    const manifest = values["module.json"] as ModuleManifest;
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    (manifest.resources as ModuleManifest["resources"][number][]).push(
      {
        resourceId: "example.decode:image.first",
        path: "assets/first.png",
        mimeType: "image/png",
        bytes: png.byteLength,
        license: { status: "redistributable", sourceName: "测试资源" },
        extensions: {},
      },
      {
        resourceId: "example.decode:image.second",
        path: "assets/second.png",
        mimeType: "image/png",
        bytes: png.byteLength,
        license: { status: "redistributable", sourceName: "测试资源" },
        extensions: {},
      },
    );
    const sourceFiles = {
      "module.json": JSON.stringify(manifest),
      "elements/marker.json": JSON.stringify(values["elements/marker.json"]),
      "assets/first.png": png,
      "assets/second.png": png,
    };
    await expectCodeAsync(
      () => parseExtensionPackageSource(chunkedSource(sourceFiles)),
      "package-resource-decoder-unavailable",
    );

    let active = 0;
    let maxActive = 0;
    const calls: string[] = [];
    const decoder: ResourceDecodeGateway = {
      async validate(request) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        calls.push(request.path);
        try {
          for await (const chunk of request.stream) {
            void chunk;
            // 假解码器完整消费每个资源，模拟解码对象在返回前释放。
          }
        } finally {
          active -= 1;
        }
      },
    };
    const parsed = await parseExtensionPackageSource(
      chunkedSource(sourceFiles, { chunkSize: 2 }),
      { resourceDecoder: decoder },
    );
    expect(parsed.artifactId).toBe("example.decode");
    expect(calls).toEqual(["assets/first.png", "assets/second.png"]);
    expect(maxActive).toBe(1);
    expect(active).toBe(0);

    await expectCodeAsync(
      () =>
        parseExtensionPackageSource(chunkedSource(sourceFiles), {
          resourceDecoder: {
            async validate(request) {
              for await (const chunk of request.stream) {
                void chunk;
                break;
              }
              throw new Error("decode failed");
            },
          },
        }),
      "package-resource-decode-failed",
    );
    await expectCodeAsync(
      () =>
        parseExtensionPackageSource(
          chunkedSource(sourceFiles, { chunkSize: 2 }),
          {
            resourceDecoder: {
              async validate(request) {
                const iterator = request.stream[Symbol.asyncIterator]();
                await iterator.next();
              },
            },
          },
        ),
      "package-resource-decode-failed",
    );
  });
});

describe("引用闭包、Catalog 与资源", () => {
  it("重复元素 ID 与跨模块图层引用均拒绝", () => {
    const duplicate = moduleValues("example.duplicate");
    const elements = duplicate["elements/marker.json"] as unknown[];
    elements.push(structuredClone(elements[0]));
    expectCode(
      () => parsePackageFileSetForTests(jsonFiles(duplicate)),
      "package-duplicate-id",
    );

    const crossLayer = moduleValues("example.cross-layer");
    firstRecord(crossLayer, "elements/marker.json").layerId =
      "other.module.marker";
    expectCode(
      () => parsePackageFileSetForTests(jsonFiles(crossLayer)),
      "package-reference-cross-module",
    );
  });

  it("未知样式字段与缺失资源引用均拒绝", () => {
    const style = moduleValues("example.style");
    const element = firstRecord(style, "elements/marker.json");
    (element.defaultStyle as Record<string, unknown>).onclick = "bad";
    expectCode(
      () => parsePackageFileSetForTests(jsonFiles(style)),
      "package-schema-invalid",
    );

    const resource = moduleValues("example.resource");
    const resourceElement = firstRecord(resource, "elements/marker.json");
    resourceElement.resourceIds = ["example.resource:missing"];
    expectCode(
      () => parsePackageFileSetForTests(jsonFiles(resource)),
      "package-reference-missing",
    );
  });

  it("Catalog 校验分类计数、排序及元素一一对应", () => {
    const values = moduleValues("example.catalog");
    const manifest = values["module.json"] as Record<string, unknown>;
    manifest.capabilities = ["anchored-overlay", "content-catalog"];
    manifest.catalogManifestPath = "catalog/content.json";
    values["catalog/content.json"] = {
      kind: "content-catalog",
      formatVersion: "1",
      moduleId: "example.catalog",
      moduleVersion: "1.0.0",
      catalogId: "example.catalog:catalog.main",
      catalogVersion: "1.0.0",
      catalogSource: null,
      categories: [
        {
          categoryId: "example.catalog:category.marker",
          nameKey: { kind: "literal", language: "zh-CN", text: "标记" },
          count: 1,
          extensions: {},
        },
      ],
      entries: [
        {
          elementId: "example.catalog:marker",
          categoryId: "example.catalog:category.marker",
          sourceId: "example.catalog:source.test",
          contentVersion: "1",
          resourceIds: [],
          extensions: {},
        },
      ],
      extensions: {},
    };
    expect(parsePackageFileSetForTests(jsonFiles(values))).toMatchObject({
      kind: "module",
      catalog: { catalogId: "example.catalog:catalog.main" },
    });
    const catalog = values["catalog/content.json"] as {
      categories: { count: number }[];
    };
    firstItem(catalog.categories).count = 2;
    expectCode(
      () => parsePackageFileSetForTests(jsonFiles(values)),
      "package-catalog-invalid",
    );
    firstItem(catalog.categories).count = 1;
    const catalogWithEntries = values["catalog/content.json"] as {
      entries: { sourceId: string }[];
    };
    firstItem(catalogWithEntries.entries).sourceId =
      "example.catalog:source.changed";
    expectCode(
      () => parsePackageFileSetForTests(jsonFiles(values)),
      "package-catalog-invalid",
    );
  });

  it("资源声明校验字节、类型、许可与引用闭包", () => {
    const values = moduleValues("example.assets");
    const asset = { frame: 1 };
    const assetBytes = encoder.encode(JSON.stringify(asset)).byteLength;
    const manifest = values["module.json"] as ModuleManifest;
    (manifest.resources as unknown[]).push({
      resourceId: "example.assets:data.marker",
      path: "assets/marker.json",
      mimeType: "application/json",
      bytes: assetBytes,
      license: { status: "redistributable", sourceName: "测试资产" },
      extensions: {},
    });
    const element = firstRecord(values, "elements/marker.json");
    element.resourceIds = ["example.assets:data.marker"];
    (element.defaultStyle as Record<string, unknown>).resourceId =
      "example.assets:data.marker";
    values["assets/marker.json"] = asset;
    expect(parsePackageFileSetForTests(jsonFiles(values))).toMatchObject({
      manifest: { resources: [{ bytes: assetBytes }] },
    });

    (firstItem(manifest.resources).license as { status: string }).status =
      "prohibited";
    expectCode(
      () => parsePackageFileSetForTests(jsonFiles(values)),
      "package-resource-license-invalid",
    );

    const undeclaredStyle = moduleValues("example.style-asset");
    const styleElement = firstRecord(undeclaredStyle, "elements/marker.json");
    (styleElement.defaultStyle as Record<string, unknown>).resourceId =
      "example.style-asset:icon";
    expectCode(
      () => parsePackageFileSetForTests(jsonFiles(undeclaredStyle)),
      "package-reference-missing",
    );
  });

  it("资源白名单拒绝脚本、HTML、WASM、SVG 与远程 URL", () => {
    for (const mimeType of [
      "text/javascript",
      "text/html",
      "application/wasm",
      "image/svg+xml",
    ]) {
      const values = moduleValues("example.blocked-resource");
      const manifest = values["module.json"] as ModuleManifest;
      (manifest.resources as unknown[]).push({
        resourceId: "example.blocked-resource:data.blocked",
        path: "assets/blocked.bin",
        mimeType,
        bytes: 1,
        license: { status: "redistributable", sourceName: "恶意资源" },
        extensions: {},
      });
      expectCode(
        () => parsePackageFileSetForTests(jsonFiles(values)),
        "package-schema-invalid",
      );
    }

    const remote = moduleValues("example.remote-resource");
    const manifest = remote["module.json"] as ModuleManifest;
    (manifest.resources as unknown[]).push({
      resourceId: "example.remote-resource:data.remote",
      path: "https://evil.example/icon.png",
      mimeType: "image/png",
      bytes: 8,
      license: { status: "redistributable", sourceName: "远程资源" },
      extensions: {},
    });
    expectCode(
      () => parsePackageFileSetForTests(jsonFiles(remote)),
      "package-path-invalid",
    );
  });

  it("约束 AST 只能引用本模块元素与声明属性", () => {
    const values = moduleValues("example.constraints");
    const manifest = values["module.json"] as Record<string, unknown>;
    manifest.constraintFiles = ["constraints/rules.json"];
    const element = firstRecord(values, "elements/marker.json");
    element.attributeSchema = {
      type: "object",
      properties: {
        level: { type: "integer", minimum: 0, maximum: 10, default: 0 },
      },
      required: ["level"],
      additionalProperties: false,
    };
    element.constraintIds = ["example.constraints:constraint.level"];
    values["constraints/rules.json"] = [
      {
        constraintId: "example.constraints:constraint.level",
        severity: "warning",
        messageKey: { kind: "literal", language: "zh-CN", text: "等级范围" },
        appliesTo: ["example.constraints:marker"],
        maxRadius: 0,
        rulesetVersion: "1",
        condition: {
          op: "number-range",
          path: "attributes.level",
          min: 0,
          max: 10,
        },
        extensions: {},
      },
    ];
    expect(parsePackageFileSetForTests(jsonFiles(values))).toMatchObject({
      constraints: [{ constraintId: "example.constraints:constraint.level" }],
    });
    const condition = firstRecord(values, "constraints/rules.json")
      .condition as Record<string, unknown>;
    condition.path = "attributes.missing";
    expectCode(
      () => parsePackageFileSetForTests(jsonFiles(values)),
      "package-constraint-invalid",
    );
    firstRecord(values, "constraints/rules.json").condition = {
      op: "occupancy-count",
      slotId: "example.constraints:slot.missing",
      min: 0,
      max: 1,
    };
    expectCode(
      () => parsePackageFileSetForTests(jsonFiles(values)),
      "package-reference-missing",
    );
  });

  it("嵌套属性默认值必须满足固定对象 Schema", () => {
    const values = moduleValues("example.attributes");
    const element = firstRecord(values, "elements/marker.json");
    element.attributeSchema = {
      type: "object",
      properties: {
        configs: {
          type: "array",
          minItems: 1,
          maxItems: 1,
          items: {
            type: "object",
            properties: { enabled: { type: "boolean", default: true } },
            required: ["enabled"],
            additionalProperties: false,
          },
          default: [{}],
        },
      },
      required: ["configs"],
      additionalProperties: false,
    };
    expectCode(
      () => parsePackageFileSetForTests(jsonFiles(values)),
      "package-attribute-schema-invalid",
    );
  });
});

describe("generated-local 与 Civ6 profile", () => {
  it("合法 Civ6 generated-local 包通过统一解析器", () => {
    expect(
      parsePackageFileSetForTests(jsonFiles(generatedCiv6Values())),
    ).toMatchObject({
      kind: "module",
      artifactId: "tessera.civ6",
      manifest: { packageSource: { kind: "generated-local" } },
      catalog: { catalogSource: { profileId: "tessera.civ6-extractor" } },
    });
  });

  it("来源清单可记录未打包进模块的正式大型只读容器", () => {
    const values = generatedCiv6Values();
    const source = values["provenance/source.json"] as {
      files: Record<string, unknown>[];
    };
    source.files = [
      {
        relativePath: "Base/Platforms/Windows/BLPs/UI/Icons.blp",
        resourceId: "tessera.civ6:source.ui-icons",
        bytes: 229 * 1024 * 1024,
        extensions: {},
      },
    ];

    expect(parsePackageFileSetForTests(jsonFiles(values))).toMatchObject({
      artifactId: "tessera.civ6",
    });
  });

  it("未知 profile、路径泄漏与任何哈希字段均稳定拒绝", () => {
    const unknown = generatedCiv6Values();
    const unknownSource = (unknown["module.json"] as ModuleManifest)
      .packageSource as {
      generatorId: string;
    };
    unknownSource.generatorId = "example.unknown-generator";
    expectCode(
      () => parsePackageFileSetForTests(jsonFiles(unknown)),
      "package-profile-unknown",
    );

    const leaked = generatedCiv6Values();
    const leakedSource = (leaked["module.json"] as ModuleManifest)
      .packageSource as {
      sourceMetadata: Record<string, unknown>;
    };
    leakedSource.sourceMetadata.extensions = { installPath: "/mnt/games/civ6" };
    expectCode(
      () => parsePackageFileSetForTests(jsonFiles(leaked)),
      "package-source-path-leak",
    );

    const hashed = generatedCiv6Values();
    const hashedSource = (hashed["module.json"] as ModuleManifest)
      .packageSource as {
      sourceMetadata: Record<string, unknown>;
    };
    hashedSource.sourceMetadata.extensions = { packageHash: "abc" };
    expectCode(
      () => parsePackageFileSetForTests(jsonFiles(hashed)),
      "package-content-hash-forbidden",
    );
  });
});

describe("依赖图、兼容性与同版本身份", () => {
  it("必需依赖缺失拒绝，可选依赖缺失形成不可变降级结果", async () => {
    const required = parseModule("example.required", {
      dependencies: [
        {
          moduleId: "example.missing",
          versionRange: "^1.0.0",
          optional: false,
        },
      ],
    });
    await expectCodeAsync(
      () =>
        buildPackageRegistry([BASIC_MODULE_PACKAGE, required], {
          currentAppVersion: "1.0.0",
        }),
      "package-dependency-missing",
    );
    const optional = parseModule("example.optional", {
      dependencies: [
        { moduleId: "example.missing", versionRange: "^1.0.0", optional: true },
      ],
    });
    const registry = await buildPackageRegistry(
      [BASIC_MODULE_PACKAGE, optional],
      {
        currentAppVersion: "1.0.0",
      },
    );
    expect(
      registry.modules.get("example.optional")?.optionalDependenciesMissing,
    ).toEqual(["example.missing"]);
    expect(Object.isFrozen(registry)).toBe(true);
  });

  it("依赖版本不匹配与依赖环稳定拒绝并报告链", async () => {
    const target = parseModule("example.target", { version: "2.0.0" });
    const consumer = parseModule("example.consumer", {
      dependencies: [
        { moduleId: "example.target", versionRange: "^1.0.0", optional: false },
      ],
    });
    await expectCodeAsync(
      () =>
        buildPackageRegistry([BASIC_MODULE_PACKAGE, target, consumer], {
          currentAppVersion: "1.0.0",
        }),
      "package-dependency-version-incompatible",
    );
    const left = parseModule("example.left", {
      dependencies: [
        { moduleId: "example.right", versionRange: "^1.0.0", optional: false },
      ],
    });
    const right = parseModule("example.right", {
      dependencies: [
        { moduleId: "example.left", versionRange: "^1.0.0", optional: false },
      ],
    });
    await expectCodeAsync(
      () =>
        buildPackageRegistry([BASIC_MODULE_PACKAGE, left, right], {
          currentAppVersion: "1.0.0",
        }),
      "package-dependency-cycle",
    );
    const optionalConsumer = parseModule("example.optional-version", {
      dependencies: [
        { moduleId: "example.target", versionRange: "^1.0.0", optional: true },
      ],
    });
    const degraded = await buildPackageRegistry(
      [BASIC_MODULE_PACKAGE, target, optionalConsumer],
      { currentAppVersion: "1.0.0" },
    );
    expect(
      degraded.modules.get("example.optional-version")
        ?.optionalDependenciesMissing,
    ).toEqual(["example.target"]);
  });

  it("appVersion、supportedGrids 与先行版本范围由 semver 实现校验", async () => {
    const future = parseModule("example.future", {
      version: "1.0.0-beta.1",
      appVersion: { min: "2.0.0" },
      grids: ["hex-pointy"],
    });
    await expectCodeAsync(
      () =>
        buildPackageRegistry([BASIC_MODULE_PACKAGE, future], {
          currentAppVersion: "1.0.0",
        }),
      "package-app-version-incompatible",
    );
    await expectCodeAsync(
      () =>
        buildPackageRegistry([BASIC_MODULE_PACKAGE, future], {
          currentAppVersion: "2.0.0",
          grid: "square",
        }),
      "package-grid-incompatible",
    );
    expectCode(
      () =>
        parseModule("example.invalid-app-range", {
          appVersion: { min: "2.0.0", maxExclusive: "1.0.0" },
        }),
      "package-version-invalid",
    );
  });

  it("基础模块缺失时不产生 Registry", async () => {
    await expectCodeAsync(
      () =>
        buildPackageRegistry([parseModule("example.only")], {
          currentAppVersion: "1.0.0",
        }),
      "package-basic-required",
    );
  });

  it("同版 JSON 深层语义等价，定义变化触发 version-reuse", async () => {
    const values = moduleValues("example.identity");
    const compact = jsonFiles(values);
    const pretty: PackageFileSet = {
      origin: "user-file",
      files: Object.entries(values).map(([path, value]) => ({
        path,
        bytes: encoder.encode(JSON.stringify(value, null, 2)),
      })),
    };
    expect(packageFileSetsEquivalent(compact, pretty)).toBe(true);
    expect(
      packageFileSetsEquivalent(
        {
          files: [
            {
              path: "assets/cafe\u0301.json",
              bytes: encoder.encode('{"ok":true}'),
            },
          ],
        },
        {
          files: [
            {
              path: "assets/café.json",
              bytes: encoder.encode('{ "ok": true }'),
            },
          ],
        },
      ),
    ).toBe(true);
    const first = parsePackageFileSetForTests(compact);
    const second = parsePackageFileSetForTests(pretty);
    expect(
      (
        await buildPackageRegistry([BASIC_MODULE_PACKAGE, first, second], {
          currentAppVersion: "1.0.0",
        })
      ).modules.has("example.identity"),
    ).toBe(true);
    const changed = moduleValues("example.identity");
    (changed["module.json"] as Record<string, unknown>).descriptionKey = {
      kind: "literal",
      language: "zh-CN",
      text: "内容已变化",
    };
    await expectCodeAsync(
      () =>
        buildPackageRegistry(
          [
            BASIC_MODULE_PACKAGE,
            first,
            parsePackageFileSetForTests(jsonFiles(changed)),
          ],
          { currentAppVersion: "1.0.0" },
        ),
      "package-version-reuse",
    );
    const pngLeft = {
      files: [{ path: "assets/icon.png", bytes: new Uint8Array([1, 2]) }],
    };
    const pngRight = {
      files: [{ path: "assets/icon.png", bytes: new Uint8Array([1, 3]) }],
    };
    expect(packageFileSetsEquivalent(pngLeft, pngRight)).toBe(false);
  });

  it("预设返回 available/missing 状态且基础模块要求不可选", async () => {
    const available = parsePackageFileSetForTests(
      jsonFiles(presetValues("example.preset.ok")),
    );
    const missingValues = presetValues("example.preset.missing");
    const missingManifest = missingValues["preset.json"] as {
      modules: Record<string, unknown>[];
    };
    missingManifest.modules.push({
      moduleId: "example.not-installed",
      versionRange: "^1.0.0",
      required: true,
      extensions: {},
    });
    const missing = parsePackageFileSetForTests(jsonFiles(missingValues));
    const registry = await buildPackageRegistry(
      [BASIC_MODULE_PACKAGE, available, missing],
      { currentAppVersion: "1.0.0" },
    );
    expect(registry.presets.get("example.preset.ok")?.status).toBe("available");
    expect(registry.presets.get("example.preset.missing")?.status).toBe(
      "missing",
    );

    const optionalBasic = presetValues("example.preset.optional-basic");
    const optionalBasicManifest = optionalBasic["preset.json"] as {
      modules: { moduleId: string; required: boolean }[];
    };
    firstItem(optionalBasicManifest.modules).required = false;
    expectCode(
      () => parsePackageFileSetForTests(jsonFiles(optionalBasic)),
      "package-basic-required",
    );

    const unknownLayer = presetValues("example.preset.unknown-layer");
    const unknownLayerManifest = unknownLayer["preset.json"] as {
      layerStates: { layerId: string }[];
    };
    firstItem(unknownLayerManifest.layerStates).layerId =
      "example.missing.layer";
    const unknownLayerPackage = parsePackageFileSetForTests(
      jsonFiles(unknownLayer),
    );
    expect(
      (
        await buildPackageRegistry(
          [BASIC_MODULE_PACKAGE, unknownLayerPackage],
          {
            currentAppVersion: "1.0.0",
          },
        )
      ).presets.get("example.preset.unknown-layer")?.status,
    ).toBe("corrupted");
  });

  it("同一制品 ID 的两个不同版本不能同时进入 Registry", async () => {
    await expectCodeAsync(
      () =>
        buildPackageRegistry(
          [
            BASIC_MODULE_PACKAGE,
            parseModule("example.package-conflict", { version: "1.0.0" }),
            parseModule("example.package-conflict", { version: "2.0.0" }),
          ],
          { currentAppVersion: "1.0.0" },
        ),
      "package-conflict",
    );
  });
});

describe("声明式迁移阶段", () => {
  function migrationValues(ranges: readonly string[]): Record<string, unknown> {
    const paths = ranges.map((_, index) => `migrations/${index}.json`);
    return moduleValues("example.migrating", {
      version: "2.0.0",
      migrationFiles: paths,
      migrations: Object.fromEntries(
        paths.map((path, index) => [
          path,
          {
            kind: "module-migration",
            formatVersion: "1",
            moduleId: "example.migrating",
            migrationId: `example.migrating:migration.step-${index}`,
            fromVersionRange: ranges[index],
            toVersion: "2.0.0",
            operations: [
              {
                op: "fill-default",
                elementId: "example.migrating:marker",
                attributeKey: "note",
                value: "",
                whenMissing: true,
              },
            ],
            extensions: {},
          },
        ]),
      ),
    });
  }

  it("空路径 not-required，合法非零路径 execution-not-supported", () => {
    expect(createMigrationPlan()).toEqual({
      status: "not-required",
      steps: [],
    });
    const module = parsePackageFileSetForTests(
      jsonFiles(migrationValues(["^1.0.0"])),
    ) as ParsedModulePackage;
    expect(createMigrationPlan(module, "2.0.0")).toEqual({
      status: "not-required",
      steps: [],
    });
    expect(createMigrationPlan(module, "1.5.0")).toMatchObject({
      status: "execution-not-supported",
      steps: [{ migrationId: "example.migrating:migration.step-0" }],
    });
    expect(createMigrationPlan(module, "0.5.0")).toEqual({
      status: "not-required",
      steps: [],
    });
  });

  it("迁移脚本字段、回指目标版本与重叠多路径均拒绝", () => {
    const scripted = migrationValues(["^1.0.0"]);
    const migration = scripted["migrations/0.json"] as Record<string, unknown>;
    migration.script = "execute()";
    expectCode(
      () => parsePackageFileSetForTests(jsonFiles(scripted)),
      "package-schema-invalid",
    );
    expectCode(
      () => parsePackageFileSetForTests(jsonFiles(migrationValues([">=1 <3"]))),
      "package-migration-cycle",
    );
    expectCode(
      () =>
        parsePackageFileSetForTests(
          jsonFiles(migrationValues(["^1.0.0", ">=1.5 <2"])),
        ),
      "package-migration-ambiguous",
    );
  });
});
