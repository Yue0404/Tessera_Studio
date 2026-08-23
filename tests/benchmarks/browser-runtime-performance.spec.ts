import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import { expect, test, type Page } from "@playwright/test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { createProject } from "../../packages/core/src/index.js";
import { stringifyProjectV1 } from "../../packages/formats/src/index.js";

const enabled = process.env.TESSERA_BROWSER_BENCHMARK === "1";
const viewport = { width: 1_440, height: 900 } as const;

function positiveIntegerEnvironment(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name}-invalid`);
  }
  return value;
}

function percentile(samples: readonly number[], quantile: number): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? 0;
}

function scenario(
  id: string,
  scope: string,
  unit: string,
  samples: readonly number[],
  passed: boolean,
  extra: Readonly<Record<string, unknown>> = {},
) {
  return {
    id,
    scope,
    unit,
    samples,
    p50: percentile(samples, 0.5),
    p95: percentile(samples, 0.95),
    passed,
    ...extra,
  };
}

function fixedProjectJson(dimension: number, contentCount: number): string {
  const state = createProject({
    name: "浏览器性能基准",
    grid: {
      type: "square",
      width: dimension,
      height: dimension,
      cellSize: 24,
    },
    style: {
      canvasBackground: "#09141DFF",
      defaultCellColor: "#16303AFF",
      gridColor: "#73B7C8FF",
      gridOpacity: 0.55,
      gridWidth: 1,
      defaultEdgeColor: "#D9B866FF",
    },
  });
  for (let index = 0; index < contentCount; index += 1) {
    const row = Math.floor(index / dimension);
    const column = index % dimension;
    const id = `cell:square:${row}:${column}`;
    state.cells.set(id, {
      instanceId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      cellId: id,
      row,
      column,
      fillColor: index % 2 === 0 ? "#E3614DFF" : "#2F8F83FF",
      fillOpacity: 1,
    });
  }
  return stringifyProjectV1(state, { mode: "full" });
}

async function importFixedProject(page: Page, json: string): Promise<void> {
  await page.goto("/");
  await page.locator('input[accept=".tessera-project.json"]').setInputFiles({
    name: "browser-benchmark.tessera-project.json",
    mimeType: "application/json",
    buffer: Buffer.from(json),
  });
  await expect(page.getByLabel("地图编辑画布")).toBeVisible({
    timeout: 30_000,
  });
}

async function createProjectInUi(page: Page, dimension: number): Promise<void> {
  await page.goto("/");
  await page.getByLabel("工程名称").fill(`基准-${dimension}`);
  await page.getByText("正方形", { exact: true }).click();
  await page.getByLabel("宽度").fill(String(dimension));
  await page.getByLabel("高度").fill(String(dimension));
  await page.getByRole("button", { name: "创建工程" }).click();
  await expect(page.getByLabel("地图编辑画布")).toBeVisible({
    timeout: 30_000,
  });
}

async function setZoom(page: Page, zoom: 0.25 | 1 | 4): Promise<void> {
  const canvas = page.getByLabel("地图编辑画布");
  await canvas.focus();
  await page.keyboard.press("0");
  if (zoom !== 1) {
    const bounds = await canvas.boundingBox();
    if (bounds === null) throw new Error("benchmark-canvas-bounds-missing");
    await page.mouse.move(bounds.x + 720, bounds.y + 420);
    await page.mouse.wheel(0, zoom === 4 ? -10_000 : 10_000);
  }
  await expect(page.getByTestId("zoom-level")).toHaveText(
    `缩放 ${zoom * 100}%`,
  );
}

async function measureMotion(
  page: Page,
  kind: "pan" | "zoom",
): Promise<{ frameGaps: number[]; renderDurations: number[] }> {
  const canvas = page.getByLabel("地图编辑画布");
  const bounds = await canvas.boundingBox();
  if (bounds === null) throw new Error("benchmark-canvas-bounds-missing");
  if (kind === "pan") await page.getByRole("button", { name: "平移" }).click();
  return canvas.evaluate(async (element, operation) => {
    const target = element as HTMLCanvasElement;
    const rect = target.getBoundingClientRect();
    const frameGaps: number[] = [];
    const renderDurations: number[] = [];
    let previous = await new Promise<number>((resolve) =>
      requestAnimationFrame(resolve),
    );
    if (operation === "pan") {
      target.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          pointerId: 1,
          buttons: 1,
          clientX: rect.left + 720,
          clientY: rect.top + 420,
        }),
      );
    }
    for (let index = 0; index < 48; index += 1) {
      const timestamp = await new Promise<number>((resolve) =>
        requestAnimationFrame(resolve),
      );
      frameGaps.push(timestamp - previous);
      previous = timestamp;
      if (operation === "pan") {
        target.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            pointerId: 1,
            buttons: 1,
            clientX: rect.left + 720 + (index % 2 === 0 ? 80 : -80),
            clientY: rect.top + 420,
          }),
        );
      } else {
        target.dispatchEvent(
          new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            deltaY: index % 2 === 0 ? 8 : -8,
            clientX: rect.left + 720,
            clientY: rect.top + 420,
          }),
        );
      }
      renderDurations.push(Number(target.dataset.renderDurationMs) || 0);
    }
    if (operation === "pan") {
      window.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          pointerId: 1,
          clientX: rect.left + 720,
          clientY: rect.top + 420,
        }),
      );
    }
    return { frameGaps, renderDurations };
  }, kind);
}

async function measureDrawing(page: Page): Promise<number[]> {
  const canvas = page.getByLabel("地图编辑画布");
  await setZoom(page, 1);
  await page.getByRole("button", { name: "画刷" }).click();
  return canvas.evaluate(async (element) => {
    const target = element as HTMLCanvasElement;
    const rect = target.getBoundingClientRect();
    const samples: number[] = [];
    target.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 2,
        buttons: 1,
        clientX: rect.left + 180,
        clientY: rect.top + 500,
      }),
    );
    for (let index = 0; index < 32; index += 1) {
      const startedAt = performance.now();
      target.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 2,
          buttons: 1,
          clientX: rect.left + 180 + index * 18,
          clientY: rect.top + 500,
        }),
      );
      const presentedAt = await new Promise<number>((resolve) =>
        requestAnimationFrame(resolve),
      );
      samples.push(Math.max(0, presentedAt - startedAt));
    }
    window.dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, pointerId: 2 }),
    );
    return samples;
  });
}

test.skip(!enabled, "只通过 benchmark:browser 显式运行");
test("benchmark-profile-v1 真实浏览器性能", async ({ browser }) => {
  const coldIterations = positiveIntegerEnvironment(
    "TESSERA_BENCHMARK_COLD_ITERATIONS",
    20,
  );
  const dimension = 100;
  const contentCount = 2_000;
  const json = fixedProjectJson(dimension, contentCount);
  const importSamples: number[] = [];
  const recoverySamples: number[] = [];

  for (let index = 0; index < coldIterations; index += 1) {
    console.log(`[benchmark] 冷启动 ${index + 1}/${coldIterations}`);
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
    });
    try {
      const page = await context.newPage();
      await page.goto("/");
      const importStartedAt = performance.now();
      await page
        .locator('input[accept=".tessera-project.json"]')
        .setInputFiles({
          name: "browser-benchmark.tessera-project.json",
          mimeType: "application/json",
          buffer: Buffer.from(json),
        });
      await expect(page.getByLabel("地图编辑画布")).toBeVisible({
        timeout: 30_000,
      });
      importSamples.push(performance.now() - importStartedAt);
      await expect(page.getByTestId("save-status")).toHaveText("已保存", {
        timeout: 30_000,
      });
      const recoveryStartedAt = performance.now();
      await page.reload();
      await expect(page.getByLabel("地图编辑画布")).toBeVisible({
        timeout: 30_000,
      });
      recoverySamples.push(performance.now() - recoveryStartedAt);
    } finally {
      await context.close();
    }
  }

  const interactionContext = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
  });
  const motionScenarios: Record<string, unknown>[] = [];
  let drawingSamples: number[];
  let gpuRenderer: string;
  let hardwareAccelerated: boolean;
  try {
    const page = await interactionContext.newPage();
    await importFixedProject(page, json);
    const gpu = await page.getByLabel("地图编辑画布").evaluate((element) => {
      const context = (element as HTMLCanvasElement).getContext("webgl");
      if (context === null)
        return { renderer: "unavailable", accelerated: false };
      const extension = context.getExtension("WEBGL_debug_renderer_info");
      const renderer =
        extension === null
          ? String(context.getParameter(context.RENDERER))
          : String(context.getParameter(extension.UNMASKED_RENDERER_WEBGL));
      return {
        renderer,
        accelerated: !/swiftshader|software|llvmpipe/iu.test(renderer),
      };
    });
    gpuRenderer = gpu.renderer;
    hardwareAccelerated = gpu.accelerated;
    for (const zoom of [0.25, 1, 4] as const) {
      await setZoom(page, zoom);
      for (const kind of ["pan", "zoom"] as const) {
        const measured = await measureMotion(page, kind);
        const fps = measured.frameGaps.map((value) => 1_000 / value);
        const p05Fps = percentile(fps, 0.05);
        motionScenarios.push(
          scenario(
            `${kind}-raf-${zoom * 100}pct`,
            "1440×900、DPR=1，生产 renderer 连续 rAF；不含 Playwright 命令往返。",
            "fps",
            fps,
            p05Fps >= 45 && Math.max(...measured.frameGaps) <= 100,
            {
              p05: p05Fps,
              longestPauseMs: Math.max(...measured.frameGaps),
              renderDurationP95Ms: percentile(measured.renderDurations, 0.95),
              zoom,
            },
          ),
        );
      }
    }
    drawingSamples = await measureDrawing(page);
  } finally {
    await interactionContext.close();
  }

  const mapContext = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
  });
  const mapSamples: number[] = [];
  let mapStats: {
    loaded: number;
    batches: number;
    heapDeltaBytes: number | null;
    heapDeltaAfterSaturationBytes: number | null;
    dragCount: number;
    saturatedAtDrag: number | null;
    stableAfterSaturationDrags: number;
    batchCountAtSaturation: number;
    maximumBatchCountAfterSaturation: number;
    heapGrowthRatioAfterSaturation: number | null;
  };
  try {
    const page = await mapContext.newPage();
    const cdp = await mapContext.newCDPSession(page);
    await createProjectInUi(page, 40_000);
    const canvas = page.getByLabel("地图编辑画布");
    await page.getByRole("button", { name: "平移" }).click();
    const bounds = await canvas.boundingBox();
    if (bounds === null) throw new Error("benchmark-canvas-bounds-missing");
    await cdp.send("HeapProfiler.collectGarbage");
    const heapBefore = await page.evaluate(
      () =>
        (performance as Performance & { memory?: { usedJSHeapSize: number } })
          .memory?.usedJSHeapSize ?? null,
    );
    let saturatedAtDrag: number | null = null;
    let heapAtSaturation: number | null = null;
    let batchCountAtSaturation = 0;
    let maximumBatchCountAfterSaturation = 0;
    let dragCount = 0;
    for (let index = 0; index < 500; index += 1) {
      await page.mouse.move(bounds.x + 1_160, bounds.y + 440);
      await page.mouse.down();
      await page.mouse.move(bounds.x + 160, bounds.y + 440, { steps: 1 });
      await page.mouse.up();
      await page.evaluate(
        () => new Promise<number>((resolve) => requestAnimationFrame(resolve)),
      );
      mapSamples.push(
        Number(await canvas.getAttribute("data-render-duration-ms")) || 0,
      );
      dragCount = index + 1;
      const loadedChunkCount = Number(
        await canvas.getAttribute("data-loaded-chunk-count"),
      );
      if (loadedChunkCount === 256 && saturatedAtDrag === null) {
        saturatedAtDrag = dragCount;
        batchCountAtSaturation = Number(
          await canvas.getAttribute("data-grid-batch-count"),
        );
        maximumBatchCountAfterSaturation = batchCountAtSaturation;
        await cdp.send("HeapProfiler.collectGarbage");
        heapAtSaturation = await page.evaluate(
          () =>
            (
              performance as Performance & {
                memory?: { usedJSHeapSize: number };
              }
            ).memory?.usedJSHeapSize ?? null,
        );
      } else if (saturatedAtDrag !== null) {
        maximumBatchCountAfterSaturation = Math.max(
          maximumBatchCountAfterSaturation,
          Number(await canvas.getAttribute("data-grid-batch-count")),
        );
      }
      if (saturatedAtDrag !== null && dragCount - saturatedAtDrag >= 64) {
        break;
      }
    }
    await cdp.send("HeapProfiler.collectGarbage");
    const heapAfter = await page.evaluate(
      () =>
        (performance as Performance & { memory?: { usedJSHeapSize: number } })
          .memory?.usedJSHeapSize ?? null,
    );
    mapStats = {
      loaded: Number(await canvas.getAttribute("data-loaded-chunk-count")),
      batches: Number(await canvas.getAttribute("data-grid-batch-count")),
      heapDeltaBytes:
        heapBefore === null || heapAfter === null
          ? null
          : heapAfter - heapBefore,
      heapDeltaAfterSaturationBytes:
        heapAtSaturation === null || heapAfter === null
          ? null
          : heapAfter - heapAtSaturation,
      dragCount,
      saturatedAtDrag,
      stableAfterSaturationDrags:
        saturatedAtDrag === null ? 0 : dragCount - saturatedAtDrag,
      batchCountAtSaturation,
      maximumBatchCountAfterSaturation,
      heapGrowthRatioAfterSaturation:
        heapAtSaturation === null ||
        heapAfter === null ||
        heapBefore === null ||
        heapAtSaturation <= heapBefore
          ? null
          : Math.max(0, heapAfter - heapAtSaturation) /
            ((heapAtSaturation - heapBefore) *
              (64 / Math.max(1, saturatedAtDrag ?? 1))),
    };
  } finally {
    await mapContext.close();
  }

  const fillContext = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
  });
  let fillCancelMs: number;
  let fillProgress: number;
  let fillWorkerCreated: boolean;
  try {
    const page = await fillContext.newPage();
    await page.addInitScript(() => {
      const NativeWorker = window.Worker;
      Object.defineProperty(window, "__tesseraFillWorkerCreated", {
        configurable: true,
        writable: true,
        value: false,
      });
      window.Worker = new Proxy(NativeWorker, {
        construct(target, argumentsList, newTarget) {
          const native = Reflect.construct(target, argumentsList, newTarget);
          if (!String(argumentsList[0]).includes("fill-region-worker")) {
            return native;
          }
          (
            window as Window & { __tesseraFillWorkerCreated?: boolean }
          ).__tesseraFillWorkerCreated = true;
          const wrapper = {
            onmessage: null as Worker["onmessage"],
            onerror: null as Worker["onerror"],
            postMessage: native.postMessage.bind(native),
            terminate: native.terminate.bind(native),
          };
          native.onmessage = (event) => {
            if (event.data?.type === "result") return;
            wrapper.onmessage?.call(native, event);
          };
          native.onerror = (event) => wrapper.onerror?.call(native, event);
          return wrapper;
        },
      });
    });
    await createProjectInUi(page, 500);
    await page.getByRole("button", { name: "画刷" }).click();
    await page.getByLabel("操作模式").selectOption("fill");
    await page
      .getByLabel("地图编辑画布")
      .click({ position: { x: 500, y: 300 } });
    const cancel = page.getByRole("button", { name: "取消填充" });
    await expect(cancel).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(
        async () => {
          const text = await page
            .getByRole("status")
            .filter({ hasText: "填充" })
            .textContent();
          const match = /(\d+)%/u.exec(text ?? "");
          return Number(match?.[1] ?? 0);
        },
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);
    fillProgress = await page
      .getByRole("status")
      .filter({ hasText: "填充" })
      .evaluate((element) =>
        Number(/(\d+)%/u.exec(element.textContent ?? "")?.[1] ?? 0),
      );
    const startedAt = performance.now();
    await cancel.click({ force: true });
    await expect(cancel).toBeHidden({ timeout: 30_000 });
    fillCancelMs = performance.now() - startedAt;
    await expect(page.getByTestId("cell-count")).toContainText("0");
    fillWorkerCreated = await page.evaluate(
      () =>
        (window as Window & { __tesseraFillWorkerCreated?: boolean })
          .__tesseraFillWorkerCreated === true,
    );
  } finally {
    await fillContext.close();
  }

  const cpu = os.cpus()[0];
  const availableMemoryBytes = os.freemem();
  const logicalCpuCount = os.cpus().length;
  const comparable =
    process.platform === "win32" &&
    logicalCpuCount === 8 &&
    availableMemoryBytes >= 8 * 1024 ** 3 &&
    availableMemoryBytes < 9 * 1024 ** 3 &&
    hardwareAccelerated;
  const scenarios = [
    scenario(
      "project-import-100x100-2000-content",
      "固定100×100工程、2000内容格；File读取开始到生产编辑画布可交互。",
      "ms",
      importSamples,
      percentile(importSamples, 0.95) <= 3_000,
      { thresholdP95Ms: 3_000 },
    ),
    scenario(
      "project-recovery-100x100-2000-content",
      "同一工程本地保存后刷新，从导航到生产编辑画布可交互。",
      "ms",
      recoverySamples,
      percentile(recoverySamples, 0.95) <= 3_000,
      { thresholdP95Ms: 3_000 },
    ),
    ...motionScenarios,
    scenario(
      "continuous-drawing-pointer-to-present",
      "生产画刷 PointerEvent 到下一次 rAF；包含领域提交与分块重画。",
      "ms",
      drawingSamples,
      percentile(drawingSamples, 0.95) <= 50,
      { thresholdP95Ms: 50 },
    ),
    scenario(
      "view-008-40000-long-pan",
      "40000×40000 稀疏工程长距离平移至256分块饱和后继续64次；批次数与加载分块受LRU上限约束。",
      "ms",
      mapSamples,
      percentile(mapSamples, 0.95) <= 100 &&
        mapSamples.filter((value) => value > 34).length <= 1 &&
        mapStats.loaded === 256 &&
        mapStats.saturatedAtDrag !== null &&
        mapStats.stableAfterSaturationDrags >= 64 &&
        mapStats.maximumBatchCountAfterSaturation <=
          mapStats.batchCountAtSaturation + 8 &&
        (mapStats.heapGrowthRatioAfterSaturation === null ||
          mapStats.heapGrowthRatioAfterSaturation <= 0.25) &&
        mapStats.batches <= mapStats.loaded,
      {
        thresholdP95Ms: 100,
        missedFrames: mapSamples.filter((value) => value > 34).length,
        loadedChunkCount: mapStats.loaded,
        gpuBatchCount: mapStats.batches,
        heapDeltaBytes: mapStats.heapDeltaBytes,
        heapDeltaAfterSaturationBytes: mapStats.heapDeltaAfterSaturationBytes,
        dragCount: mapStats.dragCount,
        saturatedAtDrag: mapStats.saturatedAtDrag,
        stableAfterSaturationDrags: mapStats.stableAfterSaturationDrags,
        batchCountAtSaturation: mapStats.batchCountAtSaturation,
        maximumBatchCountAfterSaturation:
          mapStats.maximumBatchCountAfterSaturation,
        heapGrowthRatioAfterSaturation: mapStats.heapGrowthRatioAfterSaturation,
      },
    ),
    scenario(
      "fill-worker-250000-cancel",
      "生产500×500连通填充创建真实Worker；保留真实progress、拦截最终result后由生产UI取消。",
      "ms",
      [fillCancelMs],
      fillWorkerCreated && fillProgress > 0 && fillCancelMs <= 250,
      {
        thresholdMs: 250,
        workerCreated: fillWorkerCreated,
        observedProgressPercent: fillProgress,
        stateUnchanged: true,
      },
    ),
  ];
  const profile = {
    profile: "benchmark-profile-v1",
    generatedAt: new Date().toISOString(),
    configuration: {
      coldIterations,
      projectDimension: dimension,
      projectContentCount: contentCount,
      fillCount: 250_000,
    },
    environment: {
      os: `${os.platform()} ${os.release()} ${os.arch()}`,
      cpu: cpu?.model ?? "unknown",
      logicalCpuCount,
      availableMemoryBytes,
      browserName: "Microsoft Edge / Chromium",
      browserVersion: browser.version(),
      viewport,
      dpr: 1,
      gpuRenderer,
      hardwareAccelerated,
      comparable,
      comparisonReason: comparable
        ? "精确满足 benchmark-profile-v1 参考环境。"
        : "本机CPU/可用内存或GPU加速与4核8线程、8GiB可用内存参考环境不完全一致，数据仅作实机证据。",
    },
    scenarios,
  };
  const schema = JSON.parse(
    await readFile(
      new URL("./benchmark-profile-v1.schema.json", import.meta.url),
      "utf8",
    ),
  ) as object;
  const validate = new Ajv2020({ strict: true, allErrors: true });
  addFormats(validate);
  if (!validate.compile(schema)(profile)) {
    throw new Error(
      `benchmark-profile-invalid:${JSON.stringify(validate.errors)}`,
    );
  }
  const output = process.env.TESSERA_BENCHMARK_OUTPUT;
  if (output !== undefined) {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify(profile));
  expect(scenarios.filter((value) => value.passed !== true)).toEqual([]);
});
