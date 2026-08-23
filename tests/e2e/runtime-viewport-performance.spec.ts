import { expect, test, type Locator, type Page } from "@playwright/test";
import { waitForEditorReady } from "./editor-ready.js";

async function createProject(
  page: Page,
  type: "正方形" | "尖顶六边形",
  width = 400,
  height = 400,
): Promise<void> {
  await page.goto("/");
  await page.getByLabel("工程名称").fill(`运行时-${type}`);
  await page.getByText(type, { exact: true }).click();
  await page.getByLabel("宽度").fill(String(width));
  await page.getByLabel("高度").fill(String(height));
  await page.getByRole("button", { name: "创建工程" }).click();
  await waitForEditorReady(page);
}

function percentile(samples: readonly number[], quantile: number): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? 0;
}

interface ColorMetric {
  readonly count: number;
  readonly bounds: {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  } | null;
}

interface CanvasColorSnapshot {
  readonly png: Buffer;
  readonly red: ColorMetric;
  readonly green: ColorMetric;
}

async function canvasColorSnapshot(
  page: Page,
  canvas: Locator,
): Promise<CanvasColorSnapshot> {
  const png = await canvas.screenshot();
  const metrics = await page.evaluate(async (encoded) => {
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (value) => value.charCodeAt(0));
    const bitmap = await createImageBitmap(
      new Blob([bytes], { type: "image/png" }),
    );
    const surface = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = surface.getContext("2d", { willReadFrequently: true });
    if (context === null) throw new Error("pixel-digest-context-unavailable");
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixels = context.getImageData(
      0,
      0,
      surface.width,
      surface.height,
    ).data;
    const measure = (
      matches: (
        red: number,
        green: number,
        blue: number,
        alpha: number,
      ) => boolean,
    ) => {
      let count = 0;
      let left = surface.width;
      let top = surface.height;
      let right = -1;
      let bottom = -1;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if (
          !matches(
            pixels[offset] ?? 0,
            pixels[offset + 1] ?? 0,
            pixels[offset + 2] ?? 0,
            pixels[offset + 3] ?? 0,
          )
        ) {
          continue;
        }
        const pixelIndex = offset / 4;
        const x = pixelIndex % surface.width;
        const y = Math.floor(pixelIndex / surface.width);
        count += 1;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
      return {
        count,
        bounds: count === 0 ? null : { left, top, right, bottom },
      };
    };
    return {
      red: measure(
        (red, green, blue, alpha) =>
          alpha > 0 && red >= 160 && green <= 110 && blue <= 110,
      ),
      green: measure(
        (red, green, blue, alpha) =>
          alpha > 0 && green >= 160 && red <= 110 && blue <= 110,
      ),
    };
  }, png.toString("base64"));
  return { png, ...metrics };
}

async function canvasPixelDiff(
  page: Page,
  before: Buffer,
  after: Buffer,
  region: Readonly<NonNullable<ColorMetric["bounds"]>> | null = null,
): Promise<{
  readonly count: number;
  readonly bounds: ColorMetric["bounds"];
}> {
  return page.evaluate(
    async ({ beforeEncoded, afterEncoded, scanRegion }) => {
      const decode = async (encoded: string) => {
        const bytes = Uint8Array.from(atob(encoded), (value) =>
          value.charCodeAt(0),
        );
        const bitmap = await createImageBitmap(
          new Blob([bytes], { type: "image/png" }),
        );
        const surface = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = surface.getContext("2d", { willReadFrequently: true });
        if (context === null) throw new Error("pixel-diff-context-unavailable");
        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        return {
          width: surface.width,
          height: surface.height,
          pixels: context.getImageData(0, 0, surface.width, surface.height)
            .data,
        };
      };
      const left = await decode(beforeEncoded);
      const right = await decode(afterEncoded);
      if (left.width !== right.width || left.height !== right.height) {
        throw new Error("pixel-diff-size-mismatch");
      }
      let count = 0;
      let minX = left.width;
      let minY = left.height;
      let maxX = -1;
      let maxY = -1;
      const scan = scanRegion ?? {
        left: 0,
        top: 0,
        right: left.width - 1,
        bottom: left.height - 1,
      };
      const scanLeft = Math.max(0, scan.left);
      const scanTop = Math.max(0, scan.top);
      const scanRight = Math.min(left.width - 1, scan.right);
      const scanBottom = Math.min(left.height - 1, scan.bottom);
      for (let y = scanTop; y <= scanBottom; y += 1) {
        for (let x = scanLeft; x <= scanRight; x += 1) {
          const offset = (y * left.width + x) * 4;
          if (
            left.pixels[offset] === right.pixels[offset] &&
            left.pixels[offset + 1] === right.pixels[offset + 1] &&
            left.pixels[offset + 2] === right.pixels[offset + 2] &&
            left.pixels[offset + 3] === right.pixels[offset + 3]
          ) {
            continue;
          }
          count += 1;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
      return {
        count,
        bounds:
          count === 0
            ? null
            : { left: minX, top: minY, right: maxX, bottom: maxY },
      };
    },
    {
      beforeEncoded: before.toString("base64"),
      afterEncoded: after.toString("base64"),
      scanRegion: region,
    },
  );
}

async function canvasRoiColorMetrics(
  page: Page,
  png: Buffer,
  bounds: NonNullable<ColorMetric["bounds"]>,
): Promise<{ readonly red: ColorMetric; readonly green: ColorMetric }> {
  return page.evaluate(
    async ({ encoded, roi }) => {
      const bytes = Uint8Array.from(atob(encoded), (value) =>
        value.charCodeAt(0),
      );
      const bitmap = await createImageBitmap(
        new Blob([bytes], { type: "image/png" }),
      );
      const surface = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = surface.getContext("2d", { willReadFrequently: true });
      if (context === null) throw new Error("roi-color-context-unavailable");
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const pixels = context.getImageData(
        0,
        0,
        surface.width,
        surface.height,
      ).data;
      const measure = (
        matches: (
          red: number,
          green: number,
          blue: number,
          alpha: number,
        ) => boolean,
      ) => {
        let count = 0;
        let left = surface.width;
        let top = surface.height;
        let right = -1;
        let bottom = -1;
        for (
          let y = Math.max(0, roi.top);
          y <= Math.min(surface.height - 1, roi.bottom);
          y += 1
        ) {
          for (
            let x = Math.max(0, roi.left);
            x <= Math.min(surface.width - 1, roi.right);
            x += 1
          ) {
            const offset = (y * surface.width + x) * 4;
            if (
              !matches(
                pixels[offset] ?? 0,
                pixels[offset + 1] ?? 0,
                pixels[offset + 2] ?? 0,
                pixels[offset + 3] ?? 0,
              )
            ) {
              continue;
            }
            count += 1;
            left = Math.min(left, x);
            top = Math.min(top, y);
            right = Math.max(right, x);
            bottom = Math.max(bottom, y);
          }
        }
        return {
          count,
          bounds: count === 0 ? null : { left, top, right, bottom },
        };
      };
      return {
        red: measure(
          (red, green, blue, alpha) =>
            alpha > 0 && red >= 160 && green <= 110 && blue <= 110,
        ),
        green: measure(
          (red, green, blue, alpha) =>
            alpha > 0 && green >= 160 && red <= 110 && blue <= 110,
        ),
      };
    },
    { encoded: png.toString("base64"), roi: bounds },
  );
}

for (const grid of ["正方形", "尖顶六边形"] as const) {
  test(`${grid} 在 25%–400% 指针中心缩放后保持命中`, async ({ page }) => {
    await createProject(page, grid);
    const canvas = page.getByLabel("地图编辑画布");
    await page.getByRole("button", { name: "画刷" }).click();
    const bounds = await canvas.boundingBox();
    if (bounds === null) throw new Error("canvas-bounds-missing");
    const point = { x: bounds.x + 700, y: bounds.y + 360 };
    await page.mouse.click(point.x, point.y);
    await expect(page.getByTestId("cell-count")).toContainText("1");

    await page.mouse.move(point.x, point.y);
    await page.mouse.wheel(0, -10_000);
    await expect(page.getByTestId("zoom-level")).toHaveText("缩放 400%");
    await page.mouse.click(point.x, point.y);
    await expect(page.getByTestId("cell-count")).toContainText("1");

    await page.mouse.wheel(0, 10_000);
    await expect(page.getByTestId("zoom-level")).toHaveText("缩放 25%");
    await page.mouse.click(point.x, point.y);
    await expect(page.getByTestId("cell-count")).toContainText("1");

    await canvas.focus();
    await page.keyboard.press("0");
    await expect(page.getByTestId("zoom-level")).toHaveText("缩放 100%");
    await page.getByRole("button", { name: "放大地图" }).click();
    await expect(page.getByTestId("zoom-level")).toHaveText("缩放 125%");
  });
}

test("运行时分块批次只在首次进入或变脏时重建", async ({ page }) => {
  await createProject(page, "正方形");
  const canvas = page.getByLabel("地图编辑画布");
  const before = await canvas.evaluate((element) => ({
    batches: Number((element as HTMLElement).dataset.gridBatchCount),
    loaded: Number((element as HTMLElement).dataset.loadedChunkCount),
    rebuilt: Number((element as HTMLElement).dataset.gridTotalRebuiltCount),
  }));
  expect(before.batches).toBeGreaterThan(0);
  expect(before.loaded).toBeGreaterThanOrEqual(before.batches);

  await page.mouse.move(600, 350);
  await expect
    .poll(() => canvas.getAttribute("data-grid-rebuilt-count"))
    .toBe("0");

  await page.getByRole("button", { name: "画刷" }).click();
  await canvas.click({ position: { x: 600, y: 350 } });
  await expect
    .poll(async () =>
      Number(await canvas.getAttribute("data-grid-total-rebuilt-count")),
    )
    .toBe(before.rebuilt + 1);
});

test("已有边样式只重建 owner 分块且撤销恢复画面", async ({ page }) => {
  test.setTimeout(90_000);
  await createProject(page, "正方形");
  const canvas = page.getByLabel("地图编辑画布");
  await page.getByLabel("边颜色").fill("#ff0000");
  await page.getByRole("button", { name: "边", exact: true }).click();
  await canvas.click({ position: { x: 468, y: 306 } });
  await expect(page.getByTestId("edge-count")).toContainText("1");

  await page.getByRole("button", { name: "选择" }).click();
  await canvas.click({ position: { x: 468, y: 306 } });
  await page.getByRole("button", { name: "属性" }).click();
  const inspector = page
    .locator("aside")
    .filter({ hasText: "已选择 1 个对象" });
  const color = inspector.getByLabel("边颜色");
  const width = inspector.getByLabel("线宽");
  await expect(color).toBeVisible();
  await expect(width).toBeVisible();

  for (let index = 0; index < 3; index += 1) {
    await page.getByRole("button", { name: "缩小地图" }).click();
  }
  await expect(page.getByTestId("zoom-level")).toHaveText("缩放 25%");
  await expect
    .poll(async () =>
      Number(await canvas.getAttribute("data-grid-batch-count")),
    )
    .toBeGreaterThan(1);
  const original = await canvasColorSnapshot(page, canvas);
  const rebuiltBefore = Number(
    await canvas.getAttribute("data-grid-total-rebuilt-count"),
  );

  await color.fill("#00ff00");
  await expect
    .poll(async () =>
      Number(await canvas.getAttribute("data-grid-total-rebuilt-count")),
    )
    .toBe(rebuiltBefore + 1);
  await expect(canvas).toHaveAttribute("data-grid-rebuilt-count", "1");
  const recolored = await canvasColorSnapshot(page, canvas);

  await width.fill("12");
  await expect
    .poll(async () =>
      Number(await canvas.getAttribute("data-grid-total-rebuilt-count")),
    )
    .toBe(rebuiltBefore + 2);
  await expect(canvas).toHaveAttribute("data-grid-rebuilt-count", "1");
  const widened = await canvasColorSnapshot(page, canvas);

  await page.getByRole("button", { name: "撤销" }).click();
  await expect
    .poll(async () =>
      Number(await canvas.getAttribute("data-grid-total-rebuilt-count")),
    )
    .toBe(rebuiltBefore + 3);
  await expect(canvas).toHaveAttribute("data-grid-rebuilt-count", "1");
  const widthUndone = await canvasColorSnapshot(page, canvas);

  await page.getByRole("button", { name: "撤销" }).click();
  await expect
    .poll(async () =>
      Number(await canvas.getAttribute("data-grid-total-rebuilt-count")),
    )
    .toBe(rebuiltBefore + 4);
  await expect(canvas).toHaveAttribute("data-grid-rebuilt-count", "1");
  const colorUndone = await canvasColorSnapshot(page, canvas);

  const targetBounds = widened.green.bounds ?? recolored.green.bounds;
  if (targetBounds === null) throw new Error("edge-style-green-roi-missing");
  const roi = {
    left: targetBounds.left - 4,
    top: targetBounds.top - 4,
    right: targetBounds.right + 4,
    bottom: targetBounds.bottom + 4,
  };
  const originalRoi = await canvasRoiColorMetrics(page, original.png, roi);
  const recoloredRoi = await canvasRoiColorMetrics(page, recolored.png, roi);
  const widenedRoi = await canvasRoiColorMetrics(page, widened.png, roi);
  const widthUndoneRoi = await canvasRoiColorMetrics(
    page,
    widthUndone.png,
    roi,
  );
  const colorUndoneRoi = await canvasRoiColorMetrics(
    page,
    colorUndone.png,
    roi,
  );

  console.log(
    JSON.stringify({
      scenario: "edge-style-owner-chunk",
      rebuiltBefore,
      batchCount: Number(await canvas.getAttribute("data-grid-batch-count")),
      colorDiff: await canvasPixelDiff(page, original.png, recolored.png),
      widthDiff: await canvasPixelDiff(page, recolored.png, widened.png),
      widthUndoDiff: await canvasPixelDiff(
        page,
        recolored.png,
        widthUndone.png,
      ),
      colorUndoDiff: await canvasPixelDiff(page, original.png, colorUndone.png),
      original: { red: original.red, green: original.green },
      recolored: { red: recolored.red, green: recolored.green },
      widened: { red: widened.red, green: widened.green },
      widthUndone: { red: widthUndone.red, green: widthUndone.green },
      colorUndone: { red: colorUndone.red, green: colorUndone.green },
      roi,
      roiMetrics: {
        original: originalRoi,
        recolored: recoloredRoi,
        widened: widenedRoi,
        widthUndone: widthUndoneRoi,
        colorUndone: colorUndoneRoi,
      },
    }),
  );
  expect(originalRoi.red.count).toBeGreaterThan(0);
  expect(originalRoi.green.count).toBe(0);
  expect(recoloredRoi.red.count).toBe(0);
  expect(recoloredRoi.green.count).toBeGreaterThan(0);
  expect(widenedRoi.red.count).toBe(0);
  expect(widenedRoi.green.count).toBeGreaterThan(recoloredRoi.green.count);
  expect(widthUndoneRoi.red.count).toBe(0);
  expect(widthUndoneRoi.green).toEqual(recoloredRoi.green);
  expect(colorUndoneRoi.green.count).toBe(0);
  expect(colorUndoneRoi.red).toEqual(originalRoi.red);
});

test("VIEW-008 分块合成、连续平移和 40000 地图缓存有界", async ({ page }) => {
  test.setTimeout(60_000);
  await createProject(page, "正方形", 40_000, 40_000);
  const canvas = page.getByLabel("地图编辑画布");
  await page.getByRole("button", { name: "平移" }).click();
  const bounds = await canvas.boundingBox();
  if (bounds === null) throw new Error("canvas-bounds-missing");
  const samples: number[] = [];
  let totalRebuilt =
    Number(await canvas.getAttribute("data-grid-total-rebuilt-count")) || 0;

  for (let index = 0; index < 24; index += 1) {
    await page.mouse.move(bounds.x + 1_100, bounds.y + 450);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 180, bounds.y + 450, { steps: 1 });
    await page.mouse.up();
    await page.evaluate(
      () => new Promise<number>((resolve) => requestAnimationFrame(resolve)),
    );
    const nextTotalRebuilt =
      Number(await canvas.getAttribute("data-grid-total-rebuilt-count")) || 0;
    samples.push(
      nextTotalRebuilt > totalRebuilt
        ? Number(
            await canvas.getAttribute("data-grid-last-rebuild-duration-ms"),
          ) || 0
        : Number(await canvas.getAttribute("data-render-duration-ms")) || 0,
    );
    totalRebuilt = nextTotalRebuilt;
  }
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const finalStats = await canvas.evaluate((element) => ({
    batches: Number((element as HTMLElement).dataset.gridBatchCount),
    loaded: Number((element as HTMLElement).dataset.loadedChunkCount),
  }));
  console.log(
    JSON.stringify({
      scenario: "view-008-long-pan",
      renderP50Ms: percentile(samples, 0.5),
      renderP95Ms: percentile(samples, 0.95),
      longestRenderMs: Math.max(...samples),
      loadedChunkCount: finalStats.loaded,
      gpuBatchCount: finalStats.batches,
    }),
  );
  expect(percentile(samples, 0.95)).toBeLessThanOrEqual(100);
  expect(samples.filter((value) => value > 34)).toHaveLength(0);
  expect(finalStats.loaded).toBeLessThanOrEqual(256);
  expect(finalStats.batches).toBeLessThanOrEqual(finalStats.loaded);
  expect(finalStats.batches).toBeGreaterThan(0);
});

test("PERF-006 跨块线箭头与覆盖物在淘汰后重载保持稳定", async ({ page }) => {
  test.setTimeout(120_000);
  await createProject(page, "正方形", 40_000, 40_000);
  const canvas = page.getByLabel("地图编辑画布");
  const bounds = await canvas.boundingBox();
  if (bounds === null) throw new Error("canvas-bounds-missing");
  const drag = async (fromX: number, toX: number) => {
    await page.mouse.move(bounds.x + fromX, bounds.y + 450);
    await page.mouse.down();
    await page.mouse.move(bounds.x + toX, bounds.y + 450, { steps: 1 });
    await page.mouse.up();
  };
  const repeatDrag = async (fromX: number, toX: number, count: number) =>
    canvas.evaluate(
      async (element, options) => {
        const rect = element.getBoundingClientRect();
        // 合成 PointerEvent 没有浏览器活跃指针，测试期间仅替代 capture 边界。
        const capture = element.setPointerCapture;
        element.setPointerCapture = (pointerId: number) => {
          void pointerId;
        };
        try {
          for (let index = 0; index < options.count; index += 1) {
            element.dispatchEvent(
              new PointerEvent("pointerdown", {
                bubbles: true,
                pointerId: 31,
                button: 0,
                buttons: 1,
                clientX: rect.left + options.fromX,
                clientY: rect.top + 450,
              }),
            );
            element.dispatchEvent(
              new PointerEvent("pointermove", {
                bubbles: true,
                pointerId: 31,
                button: 0,
                buttons: 1,
                clientX: rect.left + options.toX,
                clientY: rect.top + 450,
              }),
            );
            window.dispatchEvent(
              new PointerEvent("pointerup", {
                bubbles: true,
                pointerId: 31,
                button: 0,
                buttons: 0,
                clientX: rect.left + options.toX,
                clientY: rect.top + 450,
              }),
            );
            await new Promise<number>((resolve) =>
              requestAnimationFrame(resolve),
            );
          }
        } finally {
          element.setPointerCapture = capture;
        }
      },
      { fromX, toX, count },
    );

  await page.getByRole("button", { name: "平移" }).click();
  await drag(1_100, 250);
  await drag(1_100, 250);

  await page.getByRole("button", { name: "标记" }).click();
  await canvas.click({ position: { x: 590, y: 360 } });
  await page.getByRole("button", { name: "连线与箭头" }).first().click();
  await page.getByLabel("端点类型").selectOption("map-point");
  await page.getByLabel("连线类型").selectOption("line");
  await canvas.click({ position: { x: 560, y: 300 } });
  await canvas.click({ position: { x: 650, y: 300 } });
  await page.getByLabel("连线类型").selectOption("arrow");
  await canvas.click({ position: { x: 560, y: 410 } });
  await canvas.click({ position: { x: 650, y: 410 } });
  await expect(page.getByTestId("overlay-count")).toContainText("1");
  await expect(page.getByTestId("connection-count")).toContainText("2");

  await page.getByRole("button", { name: "平移" }).click();
  for (let index = 0; index < 3; index += 1) {
    await page.getByRole("button", { name: "缩小地图" }).click();
  }
  await expect(page.getByTestId("zoom-level")).toHaveText("缩放 25%");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const before = await canvas.screenshot();
  const cameraBefore = {
    x: Number(await canvas.getAttribute("data-camera-x")),
    y: Number(await canvas.getAttribute("data-camera-y")),
  };
  const rebuiltBefore = Number(
    await canvas.getAttribute("data-grid-total-rebuilt-count"),
  );

  // 向远处访问足够多分块以淘汰起点，再按完全相反位移返回。
  // 用较少但更长的对称位移覆盖同等数量的分块，避免 Firefox 为测试循环
  // 生成数百帧 trace 而把资源稳定性断言拖入超时。
  await repeatDrag(1_100, -2_100, 25);
  console.log("[PERF-006] 已完成远端访问并触发LRU饱和");
  expect(Number(await canvas.getAttribute("data-loaded-chunk-count"))).toBe(
    256,
  );
  await repeatDrag(-2_100, 1_100, 25);
  console.log("[PERF-006] 已返回原始跨块对象区域");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );

  expect({
    x: Number(await canvas.getAttribute("data-camera-x")),
    y: Number(await canvas.getAttribute("data-camera-y")),
  }).toEqual(cameraBefore);
  await expect(page.getByTestId("overlay-count")).toContainText("1");
  await expect(page.getByTestId("connection-count")).toContainText("2");
  expect(
    Number(await canvas.getAttribute("data-grid-total-rebuilt-count")),
  ).toBeGreaterThan(rebuiltBefore);
  const after = await canvas.screenshot();
  // 本用例验收跨块 marker、line、arrow；外围网格批次重建另行跟踪。
  // 解码后比较对象区域真实像素，避免把 PNG 压缩字节差异误判为回归。
  const objectPixelDiff = await canvasPixelDiff(page, before, after, {
    left: 520,
    top: 250,
    right: 700,
    bottom: 450,
  });
  expect(objectPixelDiff).toEqual({ count: 0, bounds: null });
});

test("VIEW-008 DPR=1 分块边界投影误差不超过半像素", async ({ page }) => {
  await page.setViewportSize({ width: 1_440, height: 900 });
  await createProject(page, "正方形");
  const canvas = page.getByLabel("地图编辑画布");
  await page.getByRole("button", { name: "平移" }).click();
  const bounds = await canvas.boundingBox();
  if (bounds === null) throw new Error("canvas-bounds-missing");

  // 默认格宽由生产状态读取；两次精确拖动把首个64列边界移入画布。
  for (let index = 0; index < 2; index += 1) {
    await page.mouse.move(bounds.x + 1_100, bounds.y + 450);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 250, bounds.y + 450, { steps: 1 });
    await page.mouse.up();
  }
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );

  const cameraX = Number(await canvas.getAttribute("data-camera-x"));
  const cameraY = Number(await canvas.getAttribute("data-camera-y"));
  const cellSize = Number(await canvas.getAttribute("data-grid-cell-size"));
  const expectedBoundaryX = 64 * cellSize + cameraX;
  const screenshot = await canvas.screenshot();
  const measurement = await page.evaluate(
    async ({ encoded, expectedX, cameraY, cellSize }) => {
      const binary = atob(encoded);
      const bytes = Uint8Array.from(binary, (value) => value.charCodeAt(0));
      const bitmap = await createImageBitmap(
        new Blob([bytes], { type: "image/png" }),
      );
      const surface = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = surface.getContext("2d", { willReadFrequently: true });
      if (context === null) throw new Error("seam-canvas-context-unavailable");
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const brightnessAt = (x: number, y: number) => {
        const pixel = context.getImageData(Math.round(x), y, 1, 1).data;
        return (pixel[0] ?? 0) + (pixel[1] ?? 0) + (pixel[2] ?? 0);
      };
      const centers: number[] = [];
      const diagnostics: {
        y: number;
        center: number;
        brightness: number[];
      }[] = [];
      let sampledRows = 0;
      // 页面工具栏与状态条浮在 canvas 上；只采样无遮挡的画布中段。
      for (let y = 100; y < surface.height - 100; y += 3) {
        const rowOffset = (((y - cameraY) % cellSize) + cellSize) % cellSize;
        if (rowOffset <= 2 || rowOffset >= cellSize - 2) continue;
        sampledRows += 1;
        const left = Math.max(0, Math.floor(expectedX) - 3);
        const right = Math.min(surface.width - 1, Math.ceil(expectedX) + 3);
        const background =
          (brightnessAt(left - 4, y) + brightnessAt(right + 4, y)) / 2;
        let totalWeight = 0;
        let weightedX = 0;
        for (let x = left; x <= right; x += 1) {
          const weight = Math.max(0, brightnessAt(x, y) - background);
          totalWeight += weight;
          weightedX += weight * x;
        }
        if (totalWeight > 20) {
          const center = weightedX / totalWeight;
          centers.push(center);
          if (Math.abs(center - expectedX) > 0.5 && diagnostics.length < 12) {
            diagnostics.push({
              y,
              center,
              brightness: Array.from({ length: right - left + 1 }, (_, index) =>
                brightnessAt(left + index, y),
              ),
            });
          }
        }
      }
      return {
        sampledRows,
        detectedRows: centers.length,
        expectedBoundaryCssPx: expectedX,
        minimumCenterCssPx: Math.min(...centers),
        maximumCenterCssPx: Math.max(...centers),
        diagnostics,
        maxCenterDeviationCssPx: Math.max(
          0,
          ...centers.map((value) => Math.abs(value - expectedX)),
        ),
      };
    },
    {
      encoded: screenshot.toString("base64"),
      expectedX: expectedBoundaryX,
      cameraY,
      cellSize,
    },
  );
  console.log(JSON.stringify({ scenario: "view-008-seam", ...measurement }));
  expect(measurement.detectedRows / measurement.sampledRows).toBeGreaterThan(
    0.95,
  );
  expect(measurement.maxCenterDeviationCssPx).toBeLessThanOrEqual(0.5);
});
