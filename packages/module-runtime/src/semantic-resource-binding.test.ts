import { describe, expect, it } from "vitest";
import { ModuleRuntimeError } from "./errors.js";
import { validateModuleSemantics } from "./semantic.js";
import { validateElementFile } from "./validation.js";
import type {
  ModuleElementDefinition,
  ModuleManifest,
  ModuleResource,
  PrimitiveKind,
} from "./types.js";

const literal = (text: string) =>
  ({ kind: "literal", language: "zh-CN", text }) as const;

function resource(
  resourceId: string,
  mimeType: ModuleResource["mimeType"],
): ModuleResource {
  const extension = {
    "image/png": "png",
    "image/webp": "webp",
    "font/woff2": "woff2",
    "application/json": "json",
  }[mimeType];
  return {
    resourceId,
    path: `assets/${resourceId.replace(":", "-")}.${extension}`,
    mimeType,
    bytes: 8,
    license: {
      status: "redistributable",
      sourceName: "测试夹具",
    },
  };
}

function manifest(resources: readonly ModuleResource[]): ModuleManifest {
  return {
    formatVersion: "1",
    kind: "module",
    moduleId: "example.module",
    version: "1.0.0",
    nameKey: literal("测试模块"),
    descriptionKey: literal("测试模块"),
    authors: ["Tessera"],
    appVersion: { min: "1.0.0" },
    supportedGrids: ["square"],
    dependencies: [],
    layers: [
      {
        layerId: "example.module.main",
        nameKey: literal("主图层"),
        zIndex: 1,
        allowedPrimitives: ["cell-style", "marker", "text", "domain-object"],
        allowedAnchors: ["cell", "cell-center", "map-point"],
        defaultVisible: true,
        defaultLocked: false,
        defaultOpacity: 1,
      },
    ],
    elementFiles: [],
    constraintFiles: [],
    migrationFiles: [],
    catalogManifestPath: null,
    defaultLanguage: "zh-CN",
    locales: {},
    resources,
    capabilities: [],
    packageSource: { kind: "built-in" },
  } as ModuleManifest;
}

function element(
  primitive: PrimitiveKind,
  defaultStyle: ModuleElementDefinition["defaultStyle"],
  resourceIds: readonly string[],
): ModuleElementDefinition {
  return {
    elementId: `example.module:${primitive}`,
    categoryId: "example.module:category",
    nameKey: literal("测试元素"),
    descriptionKey: literal("测试元素"),
    primitive,
    layerId: "example.module.main",
    anchors: primitive === "cell-style" ? ["cell"] : ["map-point"],
    supportedGrids: ["square"],
    defaultStyle,
    attributeSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
    occupancy: [],
    constraintIds: [],
    resourceIds,
    source: {
      sourceId: "example.module:source",
      rulesetId: "test",
      contentVersion: "1",
      retrievedAt: "2026-08-24T00:00:00.000Z",
    },
  };
}

function expectCode(action: () => void, code: string): ModuleRuntimeError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ModuleRuntimeError);
    expect(error).toMatchObject({ code });
    return error as ModuleRuntimeError;
  }
  throw new Error("预期语义校验失败");
}

describe("模块样式资源语义绑定", () => {
  it("domain-object 只接受 group 与四种组表示，明确拒绝 connection 表示", () => {
    const domain = {
      ...element(
        "domain-object",
        {
          representation: "cell-style",
          style: { fillColor: "#FFFFFFFF", fillOpacity: 1 },
        },
        [],
      ),
      anchors: ["cell"] as const,
      group: {
        minMembers: 2,
        maxMembers: 64,
        connectivity: "edge" as const,
        memberRules: [],
      },
    };
    const domainWithoutGroup = structuredClone(domain);
    delete (domainWithoutGroup as { group?: unknown }).group;
    expect(() =>
      validateModuleSemantics(manifest([]), [domain], []),
    ).not.toThrow();
    expect(() =>
      validateElementFile([domain], "domain-elements.json"),
    ).not.toThrow();
    expectCode(
      () =>
        validateModuleSemantics(
          manifest([]),
          [
            {
              ...domain,
              defaultStyle: {
                representation: "connection",
                style: {
                  strokeColor: "#FFFFFFFF",
                  strokeOpacity: 1,
                  strokeWidth: 2,
                  lineCap: "round",
                  arrowStart: false,
                  arrowEnd: true,
                  arrowSize: 8,
                },
              },
            },
          ],
          [],
        ),
      "package-style-invalid",
    );
    expect(() =>
      validateElementFile(
        [{ ...domain, group: undefined }],
        "domain-elements.json",
      ),
    ).toThrowError(expect.objectContaining({ code: "package-schema-invalid" }));
    expect(() =>
      validateElementFile(
        [
          {
            ...element(
              "cell-style",
              { fillColor: "#FFFFFFFF", fillOpacity: 1 },
              [],
            ),
            group: domain.group,
          },
        ],
        "domain-elements.json",
      ),
    ).toThrowError(expect.objectContaining({ code: "package-schema-invalid" }));
    expectCode(
      () => validateModuleSemantics(manifest([]), [domainWithoutGroup], []),
      "package-style-invalid",
    );
  });

  it("接受图片 pattern、图片 marker 与 WOFF2 字体", () => {
    const resources = [
      resource("example.module:pattern", "image/png"),
      resource("example.module:marker", "image/webp"),
      resource("example.module:font", "font/woff2"),
    ];

    expect(() =>
      validateModuleSemantics(
        manifest(resources),
        [
          element(
            "cell-style",
            {
              fillColor: "#FFFFFFFF",
              fillOpacity: 1,
              patternResourceId: "example.module:pattern",
              patternScale: 1,
            },
            ["example.module:pattern"],
          ),
          element(
            "marker",
            {
              resourceId: "example.module:marker",
              color: "#FFFFFFFF",
              opacity: 1,
              displaySize: 24,
              rotation: 0,
            },
            ["example.module:marker"],
          ),
          element(
            "text",
            {
              color: "#FFFFFFFF",
              opacity: 1,
              fontResourceId: "example.module:font",
              fontSize: 16,
              fontWeight: "normal",
              align: "center",
              rotation: 0,
            },
            ["example.module:font"],
          ),
        ],
        [],
      ),
    ).not.toThrow();
  });

  it.each([
    {
      name: "JSON 不可冒充 cell pattern",
      primitive: "cell-style" as const,
      key: "patternResourceId",
      mimeType: "application/json" as const,
    },
    {
      name: "字体不可冒充 marker 图片",
      primitive: "marker" as const,
      key: "resourceId",
      mimeType: "font/woff2" as const,
    },
    {
      name: "图片不可冒充字体",
      primitive: "text" as const,
      key: "fontResourceId",
      mimeType: "image/png" as const,
    },
  ])("$name", ({ primitive, key, mimeType }) => {
    const id = "example.module:asset";
    const error = expectCode(
      () =>
        validateModuleSemantics(
          manifest([resource(id, mimeType)]),
          [element(primitive, { [key]: id }, [id])],
          [],
        ),
      "package-style-invalid",
    );

    expect(error.path).toBe(`elements/0/defaultStyle/${key}`);
  });

  it("样式资源即使存在于 manifest 也必须由元素声明", () => {
    const id = "example.module:pattern";

    expectCode(
      () =>
        validateModuleSemantics(
          manifest([resource(id, "image/png")]),
          [element("cell-style", { patternResourceId: id }, [])],
          [],
        ),
      "package-reference-missing",
    );
  });

  it("manifest 资源 ID 必须属于当前模块", () => {
    expectCode(
      () =>
        validateModuleSemantics(
          manifest([resource("other.module:image", "image/png")]),
          [],
          [],
        ),
      "package-id-namespace-invalid",
    );
  });
});
