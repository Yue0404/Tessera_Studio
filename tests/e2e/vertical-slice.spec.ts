import { expect, test, type Page } from "@playwright/test";
import { waitForImportedProject } from "./editor-ready.js";

async function createProject(
  page: Page,
  gridLabel: "正方形" | "尖顶六边形",
  name: string,
  size = "20",
) {
  await page.goto("/");
  await page.getByLabel("工程名称").fill(name);
  await page.getByText(gridLabel, { exact: true }).click();
  await page.getByLabel("宽度").fill(size);
  await page.getByLabel("高度").fill(size);
  await page.getByRole("button", { name: "创建工程" }).click();
  await expect(page.getByLabel("地图编辑画布")).toBeVisible();
}

async function exportJson(page: Page): Promise<Record<string, unknown>> {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出" }).click();
  await page.getByRole("button", { name: "数据导出" }).click();
  await page.getByRole("button", { name: "生成并下载" }).click();
  const stream = await (await downloadPromise).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
    string,
    unknown
  >;
}

for (const gridLabel of ["正方形", "尖顶六边形"] as const) {
  test(`${gridLabel}：创建、编辑、撤销重做、自动保存、刷新、导出与载入`, async ({
    page,
    browser,
  }) => {
    // Linux CI 中三次真实 WebGL 初始化约需 30 秒，保留完整流程并给予调度余量。
    test.setTimeout(90_000);

    const name = `${gridLabel}端到端`;
    await createProject(page, gridLabel, name);
    const canvas = page.getByLabel("地图编辑画布");
    await page.getByRole("button", { name: "画刷" }).click();
    await canvas.click({ position: { x: 700, y: 300 } });
    await expect(page.getByTestId("cell-count")).toContainText("1");
    await page.getByRole("button", { name: "边" }).click();
    await canvas.click({ position: { x: 700, y: 300 } });
    await expect(page.getByTestId("edge-count")).toContainText("1");
    await page.getByRole("button", { name: "撤销" }).click();
    await expect(page.getByTestId("edge-count")).toContainText("0");
    await page.getByRole("button", { name: "重做" }).click();
    await expect(page.getByTestId("edge-count")).toContainText("1");
    await expect(page.getByTestId("save-status")).toHaveText("已保存", {
      timeout: 5000,
    });
    await page.reload();
    await expect(page.getByTestId("cell-count")).toContainText("1");
    await expect(page.getByTestId("edge-count")).toContainText("1");

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出" }).click();
    await page.getByRole("button", { name: "数据导出" }).click();
    await page.getByRole("button", { name: "生成并下载" }).click();
    const download = await downloadPromise;
    const path = await download.path();
    if (path === null) throw new Error("导出文件没有可读取的临时路径");
    const cleanContext = await browser.newContext();
    const cleanPage = await cleanContext.newPage();
    await cleanPage.goto("/");
    await cleanPage.getByLabel("打开").setInputFiles(path);
    await waitForImportedProject(cleanPage, name);
    await expect(cleanPage.getByTestId("edge-count")).toContainText("1");
    await cleanContext.close();
  });
}

test("M1 工具、Manager、固定图层与刷新恢复闭环", async ({ page }) => {
  test.setTimeout(90_000);
  await createProject(page, "正方形", "M1 工具闭环");
  const canvas = page.getByLabel("地图编辑画布");

  await page.getByRole("button", { name: "画刷" }).click();
  await canvas.click({ position: { x: 500, y: 300 } });
  await expect(page.getByTestId("cell-count")).toContainText("1");

  await page.getByRole("button", { name: "标记" }).click();
  await canvas.click({ position: { x: 540, y: 300 } });
  await expect(page.getByTestId("overlay-count")).toContainText("1");

  await page.getByRole("button", { name: "连线与箭头" }).first().click();
  await canvas.click({ position: { x: 460, y: 300 } });
  await canvas.click({ position: { x: 580, y: 300 } });
  await expect(page.getByTestId("connection-count")).toContainText("1");
  await page.getByRole("button", { name: "撤销" }).click();
  await expect(page.getByTestId("connection-count")).toContainText("0");
  await page.getByRole("button", { name: "重做" }).click();
  await expect(page.getByTestId("connection-count")).toContainText("1");

  const edgeCountBefore = await page.getByTestId("edge-count").textContent();
  await page.getByRole("button", { name: "框选" }).click();
  await canvas.hover({ position: { x: 440, y: 270 } });
  await page.mouse.down();
  await page.mouse.move(600, 340, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByTestId("edge-count")).toHaveText(
    edgeCountBefore ?? "",
  );
  await page.getByRole("button", { name: "属性" }).click();
  await expect(page.getByText(/已选择 \d+ 个对象/)).toBeVisible();

  await page.getByRole("button", { name: "图层" }).click();
  const connectionLayer = page
    .getByRole("listitem")
    .filter({ hasText: "tessera.basic.connection · 4300" });
  await expect(connectionLayer).toBeVisible();
  await connectionLayer.getByRole("checkbox", { name: "显示" }).uncheck();
  await expect(
    connectionLayer.getByRole("checkbox", { name: "显示" }),
  ).not.toBeChecked();

  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByTestId("save-status")).toHaveText("已保存");
  await page.reload();
  await expect(page.getByTestId("cell-count")).toContainText("1");
  await expect(page.getByTestId("overlay-count")).toContainText("1");
  await expect(page.getByTestId("connection-count")).toContainText("1");
});

test("M1 文字中文输入、三类 Overlay 锚点与编辑删除", async ({ page }) => {
  test.setTimeout(90_000);
  await createProject(page, "正方形", "Overlay 交互");
  const canvas = page.getByLabel("地图编辑画布");
  const markerTool = page.getByRole("button", { name: "标记" });
  await markerTool.click();
  await page.getByLabel("元素类型").selectOption("text");
  const textInput = page.getByLabel("文字内容");
  await textInput.fill("中文输入不会切换工具");
  await textInput.press("Escape");
  await expect(markerTool).toHaveAttribute("aria-pressed", "true");
  await canvas.click({ position: { x: 500, y: 300 } });
  await expect(page.getByTestId("overlay-count")).toContainText("1");

  await page.getByLabel("元素类型").selectOption("marker");
  await page.getByLabel("锚定方式").selectOption("edge");
  await canvas.click({ position: { x: 416, y: 368 } });
  await expect(page.getByTestId("overlay-count")).toContainText("2");
  await expect(page.getByTestId("edge-count")).toContainText("1");
  await page.getByLabel("锚定方式").selectOption("map-point");
  await canvas.click({ position: { x: 590, y: 347 } });
  await expect(page.getByTestId("overlay-count")).toContainText("3");

  await page.getByRole("button", { name: "选择" }).click();
  await canvas.click({ position: { x: 500, y: 300 } });
  await page.getByRole("button", { name: "属性" }).click();
  const inspector = page
    .locator("aside")
    .filter({ hasText: "已选择 1 个对象" });
  await inspector.getByLabel("文字内容").fill("已编辑中文文字");
  await inspector.getByRole("button", { name: "删除所选对象" }).click();
  await expect(page.getByTestId("overlay-count")).toContainText("2");

  const project = await exportJson(page);
  const managers = project.managers as {
    overlayManager: { overlays: Record<string, unknown>[] };
  };
  expect(managers.overlayManager.overlays).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "anchored-overlay",
        anchor: expect.objectContaining({ kind: "edge" }),
      }),
      expect.objectContaining({
        kind: "free-overlay",
        point: expect.objectContaining({
          x: expect.any(Number),
          y: expect.any(Number),
        }),
      }),
    ]),
  );
});

test("M1 line/arrow 端点、双向标签与边完整样式", async ({ page }) => {
  test.setTimeout(90_000);
  await createProject(page, "正方形", "连线与边样式");
  const canvas = page.getByLabel("地图编辑画布");
  await page.getByRole("button", { name: "连线与箭头" }).first().click();
  await page.getByLabel("连线类型").selectOption("line");
  await page.getByLabel("端点类型").selectOption("map-point");
  await canvas.click({ position: { x: 480, y: 260 } });
  await canvas.click({ position: { x: 620, y: 260 } });
  await page.getByLabel("连线类型").selectOption("arrow");
  await page.getByLabel("箭头方向").selectOption("both");
  await page.getByLabel("短标签").fill("双向道路");
  await page.getByLabel("端点类型").selectOption("edge-midpoint");
  await canvas.click({ position: { x: 468, y: 306 } });
  await canvas.click({ position: { x: 576, y: 304 } });
  await expect(page.getByTestId("connection-count")).toContainText("2");
  await expect(page.getByTestId("edge-count")).toContainText("2");

  await page.getByRole("button", { name: "图层" }).click();
  const connectionLayer = page
    .getByRole("listitem")
    .filter({ hasText: "tessera.basic.connection · 4300" });
  await connectionLayer.getByRole("checkbox", { name: "显示" }).uncheck();
  await page.getByRole("button", { name: "选择" }).click();
  await canvas.click({ position: { x: 468, y: 306 } });
  await page.getByRole("button", { name: "属性" }).click();
  const inspector = page
    .locator("aside")
    .filter({ hasText: "已选择 1 个对象" });
  const width = inspector.getByLabel("线宽");
  await expect(width).toBeVisible({ timeout: 3_000 });
  await width.fill("7");
  const opacity = inspector.getByLabel("透明度");
  await expect(opacity).toBeVisible({ timeout: 3_000 });
  await opacity.focus();
  await opacity.press("Home");
  for (let step = 0; step < 8; step += 1) await opacity.press("ArrowRight");
  await inspector.getByLabel("线型").selectOption("dashed");

  const project = await exportJson(page);
  const managers = project.managers as {
    edgeManager: { edges: Record<string, unknown>[] };
    connectionManager: { connections: Record<string, unknown>[] };
  };
  expect(managers.edgeManager.edges).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        layerInstances: expect.arrayContaining([
          expect.objectContaining({
            styleOverrides: expect.objectContaining({
              strokeWidth: 7,
              strokeOpacity: 0.4,
              lineStyle: "dashed",
            }),
          }),
        ]),
      }),
    ]),
  );
  expect(managers.connectionManager.connections).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: "line" }),
      expect.objectContaining({
        kind: "arrow",
        arrowStart: true,
        arrowEnd: true,
        label: "双向道路",
      }),
    ]),
  );
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByTestId("save-status")).toHaveText("已保存");
  await page.reload();
  await expect(page.getByTestId("connection-count")).toContainText("2");
});

test("连通填充、擦除与 Shift 多选", async ({ page }) => {
  test.setTimeout(90_000);
  await createProject(page, "正方形", "填充擦除", "20");
  const canvas = page.getByLabel("地图编辑画布");
  await page.getByRole("button", { name: "画刷" }).click();
  await page.getByLabel("操作模式").selectOption("fill");
  await canvas.click({ position: { x: 500, y: 300 } });
  await expect(page.getByTestId("cell-count")).toContainText("400");
  await page.getByLabel("操作模式").selectOption("erase");
  await canvas.click({ position: { x: 500, y: 300 } });
  await expect(page.getByTestId("cell-count")).toContainText("399");
  await page.getByRole("button", { name: "选择" }).click();
  await canvas.click({ position: { x: 500, y: 300 } });
  await canvas.click({ position: { x: 532, y: 300 }, modifiers: ["Shift"] });
  await page.getByRole("button", { name: "属性" }).click();
  await expect(page.getByText("已选择 2 个对象")).toBeVisible();
});

test("M4 10001 以上填充进入后台且取消不提交半成品", async ({ page }) => {
  await createProject(page, "正方形", "后台填充取消", "101");
  await page.getByRole("button", { name: "画刷" }).click();
  await page.getByLabel("操作模式").selectOption("fill");
  await page.clock.install();
  const browserNow = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(browserNow + 60_000);
  await page.getByLabel("地图编辑画布").click({ position: { x: 500, y: 300 } });
  const cancel = page.getByRole("button", { name: "取消填充" });
  await expect(cancel).toBeVisible();
  await cancel.evaluate((button: HTMLButtonElement) => button.click());
  await page.clock.runFor(1);
  await expect(cancel).toBeHidden();
  await expect(page.getByTestId("cell-count")).toContainText("0");
});

test("M4 40000 地图连通填充触发总量门禁且保持稀疏", async ({ page }) => {
  await createProject(page, "正方形", "填充安全门", "40000");
  await page.getByRole("button", { name: "画刷" }).click();
  await page.getByLabel("操作模式").selectOption("fill");
  await page.getByLabel("地图编辑画布").click({ position: { x: 500, y: 300 } });
  await expect(page.getByRole("alert")).toContainText("运行时或 64 MiB");
  await expect(page.getByTestId("cell-count")).toContainText("0");
});

test("40000×40000 创建保持稀疏，合法 full JSON 中没有显式分块或对象", async ({
  page,
}) => {
  await createProject(page, "正方形", "稀疏上限", "40000");
  await expect(page.getByTestId("cell-count")).toContainText("0");
  await expect(page.getByTestId("edge-count")).toContainText("0");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出" }).click();
  await page.getByRole("button", { name: "数据导出" }).click();
  await page.getByRole("button", { name: "生成并下载" }).click();
  const stream = await (await downloadPromise).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const project = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
    kind: string;
    formatVersion: string;
    exportScope: string;
    isComplete: boolean;
    chunks: unknown[];
    managers: { edgeManager: { edges: unknown[] } };
  };
  expect(project).toMatchObject({
    kind: "tessera-project",
    formatVersion: "1",
    exportScope: "full",
    isComplete: true,
  });
  expect(project.chunks).toHaveLength(0);
  expect(project.managers.edgeManager.edges).toHaveLength(0);
});

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1600, height: 1000 },
]) {
  test(`浮动编辑器布局 ${viewport.width}×${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const createButton = page.getByRole("button", { name: "创建工程" });
    await expect(createButton).toBeVisible();
    await expect(createButton).toBeInViewport();
    await expect(page.getByText("始终启用", { exact: true })).toBeVisible();
    await expect(page.getByText("未安装", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "设置" })).toBeVisible();
    await expect(page.locator("body")).toHaveJSProperty(
      "scrollHeight",
      viewport.height,
    );
    const opacityLabel = await page
      .getByLabel("网格线透明度")
      .evaluate((input) => input.closest("label")?.getBoundingClientRect());
    expect(opacityLabel?.height).toBeLessThanOrEqual(44);
    expect(opacityLabel?.width).toBeGreaterThan(200);
    const gridWidthBackground = await page
      .getByLabel("网格线粗细")
      .evaluate((input) => getComputedStyle(input).backgroundColor);
    expect(gridWidthBackground).not.toBe("rgb(255, 255, 255)");
    await page.screenshot({
      path: `test-results/new-project-${viewport.width}x${viewport.height}.png`,
      fullPage: false,
    });
    await createProject(page, "尖顶六边形", `布局${viewport.width}`);
    await expect(page.locator("body")).toHaveJSProperty(
      "scrollHeight",
      viewport.height,
    );
    await page.screenshot({
      path: `test-results/editor-${viewport.width}x${viewport.height}.png`,
      fullPage: true,
    });
  });
}
