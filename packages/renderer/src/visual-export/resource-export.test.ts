import { createProject } from "@tessera/core";
import { describe, expect, it, vi } from "vitest";
import { planVisualExport } from "./plan.js";
import {
  captureVisualExportSnapshot,
  hydrateVisualExportSnapshotResources,
} from "./snapshot.js";
import { serializeVisualExportSvg } from "./svg.js";
import type { VisualExportCaptureOptions, VisualPrimitive } from "./types.js";

const patternIdentity = {
  moduleId: "example.weather",
  version: "1.0.0",
  resourceId: "example.weather:image.pattern",
} as const;
const markerIdentity = {
  moduleId: "example.weather",
  version: "1.0.0",
  resourceId: "example.weather:image.marker",
} as const;
const fontIdentity = {
  moduleId: "example.weather",
  version: "1.0.0",
  resourceId: "example.weather:font.label",
} as const;

function project() {
  return createProject({
    name: "资源导出",
    grid: { type: "square", width: 2, height: 2, cellSize: 32 },
    style: {
      canvasBackground: "#09141DFF",
      defaultCellColor: "#14232DFF",
      gridColor: "#59656AFF",
      gridOpacity: 0.7,
      gridWidth: 1,
      defaultEdgeColor: "#59656AFF",
    },
  });
}

function resourcePrimitives(
  state: ReturnType<typeof project>,
): readonly VisualPrimitive[] {
  const layer = state.layers.get("tessera.basic.annotation");
  if (layer === undefined) throw new Error("annotation-layer-missing");
  const base = {
    layerId: layer.layerId,
    zIndex: layer.zIndex,
    orderInLayer: 0,
    partRank: 0,
  } as const;
  return [
    {
      ...base,
      kind: "polygon",
      stableId: "pattern",
      points: [
        { x: 0, y: 0 },
        { x: 32, y: 0 },
        { x: 32, y: 32 },
        { x: 0, y: 32 },
      ],
      fillColor: "#FFFFFFFF",
      opacity: 1,
      patternResource: { identity: patternIdentity, scale: 2 },
    },
    {
      ...base,
      kind: "marker",
      stableId: "marker",
      point: { x: 16, y: 16 },
      shape: "diamond",
      size: 20,
      rotation: 0,
      color: "#FFFFFFFF",
      opacity: 0.75,
      imageResource: markerIdentity,
    },
    {
      ...base,
      kind: "text",
      stableId: "text",
      point: { x: 20, y: 20 },
      text: "资源文字",
      fontSize: 12,
      fontWeight: "normal",
      align: "center",
      rotation: 0,
      color: "#FFFFFFFF",
      opacity: 1,
      backgroundColor: null,
      fontResource: fontIdentity,
    },
  ];
}

function captureOptions(
  status: "ready" | "loading" | "failed" | "missing" = "ready",
): VisualExportCaptureOptions {
  const resolveResource = vi.fn(
    (identity: {
      readonly moduleId: string;
      readonly version: string;
      readonly resourceId: string;
    }) => {
      const common = { key: identity.resourceId, identity };
      if (status === "missing") return undefined;
      if (status === "loading") return { ...common, status } as const;
      if (status === "failed") {
        return {
          ...common,
          status,
          code: "resource-decode-failed",
          placeholder: {
            kind: "warning-checker",
            label: "resource-unavailable",
            primaryColor: "#FF00FFFF",
            secondaryColor: "#202020FF",
            strokeWidth: 2,
            strokeDashPattern: [4, 3],
            markerCrossRatio: 1 / 3,
            textBackgroundColor: "#FF00FFFF",
          },
        } as const;
      }
      if (identity.resourceId === patternIdentity.resourceId) {
        return {
          ...common,
          status,
          resource: {
            kind: "image",
            mimeType: "image/png",
            bytes: new Uint8Array([1, 2, 3]),
            width: 2,
            height: 2,
            handle: {},
          },
        } as const;
      }
      if (identity.resourceId === markerIdentity.resourceId) {
        return {
          ...common,
          status,
          resource: {
            kind: "image",
            mimeType: "image/webp",
            bytes: new TextEncoder().encode("<script>SECRET</script>"),
            width: 4,
            height: 2,
            handle: {},
          },
        } as const;
      }
      return {
        ...common,
        status,
        resource: {
          kind: "font",
          mimeType: "font/woff2",
          bytes: new Uint8Array([6, 7, 8]),
          family: "TesseraModule_safe",
          handle: {},
        },
      } as const;
    },
  );
  return {
    requiredExtensionElementIds: ["example.weather:resources"],
    extensionRenderers: [
      {
        elementId: "example.weather:resources",
        capture: resourcePrimitives,
      },
    ],
    resolveResource,
  };
}

function svgPlan(options: VisualExportCaptureOptions) {
  const snapshot = captureVisualExportSnapshot(project(), options);
  return planVisualExport(snapshot, {
    format: "svg",
    range: { kind: "full-map" },
    background: { kind: "transparent" },
    showGrid: false,
  });
}

describe("模块资源确定性视觉导出", () => {
  it("只携带引用资源，按安全 ordinal 去重并生成无外链 SVG", () => {
    const plan = svgPlan(captureOptions());
    expect(plan.snapshot.resources).toHaveLength(3);
    expect(plan.snapshot.resources.map((resource) => resource.key)).toEqual([
      "resource-000000",
      "resource-000001",
      "resource-000002",
    ]);
    expect(
      plan.snapshot.resources.map((resource) => resource.identity.resourceId),
    ).toEqual([
      fontIdentity.resourceId,
      markerIdentity.resourceId,
      patternIdentity.resourceId,
    ]);
    const svg = serializeVisualExportSvg(plan);
    expect(svg).toContain("data:image/png;base64,AQID");
    expect(svg).toContain(
      "data:image/webp;base64,PHNjcmlwdD5TRUNSRVQ8L3NjcmlwdD4=",
    );
    expect(svg).toContain("data:font/woff2;base64,BgcI");
    expect(svg).toContain("<pattern");
    expect(svg).toContain("<image");
    expect(svg).toContain("@font-face");
    expect(svg.match(/data:image\/png/gu)).toHaveLength(1);
    expect(svg.match(/data:image\/webp/gu)).toHaveLength(1);
    expect(svg.match(/data:font\/woff2/gu)).toHaveLength(1);
    expect(svg).not.toContain(patternIdentity.resourceId);
    expect(svg).not.toContain(markerIdentity.resourceId);
    expect(svg).not.toContain(fontIdentity.resourceId);
    expect(svg).not.toContain("SECRET");
    expect(svg).not.toMatch(/href="https?:/u);
    expect(svg).not.toMatch(/<script|\son[a-z]+=/iu);
    expect(() =>
      serializeVisualExportSvg(plan, {
        maxNodes: 1_000,
        maxUtf8Bytes: 128,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "visual-export-svg-byte-limit-exceeded",
      }),
    );
  });

  it("同一精确资源被多个 descriptor 引用时只携带一份字节", () => {
    const options = captureOptions();
    const snapshot = captureVisualExportSnapshot(project(), {
      ...options,
      extensionRenderers: [
        {
          elementId: "example.weather:resources",
          capture: (state) => {
            const primitives = resourcePrimitives(state);
            const marker = primitives.find(
              (primitive) => primitive.kind === "marker",
            );
            return marker === undefined ? primitives : [...primitives, marker];
          },
        },
      ],
    });

    expect(snapshot.extensions[0]?.descriptors).toHaveLength(4);
    expect(snapshot.resources).toHaveLength(3);
    expect(
      snapshot.resources.filter(
        (resource) =>
          resource.identity.resourceId === markerIdentity.resourceId,
      ),
    ).toHaveLength(1);
  });

  it("预取承诺完成后仍为 loading 的资源会显式拒绝而非静默占位", () => {
    const initial = captureVisualExportSnapshot(project(), {
      ...captureOptions("loading"),
      deferResourceCapture: true,
    });

    expect(() =>
      hydrateVisualExportSnapshotResources(
        initial,
        {
          ...captureOptions("loading"),
          prepareResource: async () => undefined,
        },
        [patternIdentity],
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "visual-export-extension-resource-invalid",
        details: expect.objectContaining({ reason: "resource-not-prepared" }),
      }),
    );
  });

  it.each(["loading", "failed", "missing"] as const)(
    "%s 资源在 Canvas/SVG 快照中使用共享占位且保留文字",
    (status) => {
      const plan = svgPlan(captureOptions(status));
      expect(plan.snapshot.resources).toEqual([]);
      const descriptors = plan.snapshot.extensions[0]?.descriptors ?? [];
      expect(
        descriptors.map((primitive) => primitive.resourcePlaceholder),
      ).toEqual(["pattern", "marker", "text"]);
      expect(
        descriptors.find((primitive) => primitive.kind === "text"),
      ).toMatchObject({ text: "资源文字", backgroundColor: "#FF00FFFF" });
      const svg = serializeVisualExportSvg(plan);
      expect(svg).toContain('stroke-dasharray="4 3"');
      expect(svg).toContain("<path");
      expect(svg).toContain("资源文字");
      expect(svg).toContain("#FF00FF");
      expect(svg).toContain("#202020");
    },
  );
});
