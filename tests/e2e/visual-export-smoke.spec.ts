import { expect, test } from "@playwright/test";

interface PngSmokeResult {
  readonly blobType: string;
  readonly blobSize: number;
  readonly signature: readonly number[];
  readonly width: number;
  readonly height: number;
  readonly executionMode: string;
  readonly samples: Readonly<Record<string, readonly number[]>>;
  readonly coloredPixelCounts: Readonly<Record<string, number>>;
}

interface VisualExportSmokeModule {
  renderSquarePngSmoke(
    forceFallback: boolean,
    background: "transparent" | "color",
    hideAnnotation?: boolean,
  ): Promise<PngSmokeResult>;
  renderHexPngSmoke(): Promise<PngSmokeResult>;
  renderSvgSmoke(): Promise<{
    readonly blobType: string;
    readonly parseError: boolean;
    readonly loaded: boolean;
    readonly containsScript: boolean;
    readonly containsExternalReference: boolean;
    readonly hasGeometry: boolean;
  }>;
}

const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("Chromium Worker 真实生成方格 PNG，包含透明度、裁切线、文字和标记", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const module =
      (await import("/src/visual-export-browser-smoke-harness.ts")) as VisualExportSmokeModule;
    return module.renderSquarePngSmoke(false, "transparent");
  });
  expect(result.blobType).toBe("image/png");
  expect(result.blobSize).toBeGreaterThan(100);
  expect(result.signature).toEqual(pngSignature);
  expect(result.executionMode).toBe("worker");
  expect(result.width).toBe(160);
  expect(result.height).toBe(160);
  expect(result.samples.empty?.[3]).toBe(0);
  expect(result.samples.redCell).toEqual([255, 0, 0, 255]);
  expect(result.samples.marker?.[1]).toBeGreaterThan(200);
  expect(result.samples.marker?.[3]).toBeGreaterThan(200);
  expect(result.coloredPixelCounts.crossingLineLeft).toBeGreaterThan(10);
  expect(result.coloredPixelCounts.crossingLineRight).toBeGreaterThan(10);
  expect(result.samples.text?.[3]).toBeGreaterThan(0);
});

test("主线程 fallback 支持指定 RGBA 背景且隐藏层不绘制", async ({ page }) => {
  const [colored, hidden] = await page.evaluate(async () => {
    const module =
      (await import("/src/visual-export-browser-smoke-harness.ts")) as VisualExportSmokeModule;
    return Promise.all([
      module.renderSquarePngSmoke(true, "color"),
      module.renderSquarePngSmoke(true, "transparent", true),
    ]);
  });
  expect(colored.executionMode).toBe("fallback");
  expect(colored.signature).toEqual(pngSignature);
  const background = colored.samples.empty ?? [];
  // 半透明 PNG 经预乘/反预乘后，不同浏览器可产生至多两个通道级的舍入差。
  expect(Math.abs((background[0] ?? 0) - 17)).toBeLessThanOrEqual(2);
  expect(Math.abs((background[1] ?? 0) - 34)).toBeLessThanOrEqual(2);
  expect(Math.abs((background[2] ?? 0) - 51)).toBeLessThanOrEqual(2);
  expect(background[3]).toBe(128);
  expect(hidden.samples.text?.[3]).toBe(0);
  expect(hidden.samples.redCell).toEqual([255, 0, 0, 255]);
});

test("尖顶六边形 PNG 使用真实几何中心绘制", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const module =
      (await import("/src/visual-export-browser-smoke-harness.ts")) as VisualExportSmokeModule;
    return module.renderHexPngSmoke();
  });
  expect(result.signature).toEqual(pngSignature);
  expect(result.samples.paintedHex?.[1]).toBeGreaterThan(100);
  expect(result.samples.paintedHex?.[2]).toBeGreaterThan(200);
  expect(result.samples.paintedHex?.[3]).toBe(255);
  expect(result.samples.empty?.[3]).toBe(0);
});

test("SVG Blob 可独立打开、解析且不含脚本或外部引用", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const module =
      (await import("/src/visual-export-browser-smoke-harness.ts")) as VisualExportSmokeModule;
    return module.renderSvgSmoke();
  });
  expect(result.blobType).toContain("image/svg+xml");
  expect(result.parseError).toBe(false);
  expect(result.loaded).toBe(true);
  expect(result.containsScript).toBe(false);
  expect(result.containsExternalReference).toBe(false);
  expect(result.hasGeometry).toBe(true);
});
