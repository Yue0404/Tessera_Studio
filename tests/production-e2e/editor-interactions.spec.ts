import {
  expect,
  test,
  type ConsoleMessage,
  type Download,
  type Locator,
  type Page,
} from "@playwright/test";

async function createProject(
  page: Page,
  gridLabel: "正方形" | "尖顶六边形",
  name: string,
) {
  await page.goto("/");
  await page.getByLabel("工程名称").fill(name);
  await page.getByText(gridLabel, { exact: true }).click();
  await page.getByLabel("宽度").fill("20");
  await page.getByLabel("高度").fill("20");
  await page.getByRole("button", { name: "创建工程" }).click();
  await expect(page.getByLabel("地图编辑画布")).toBeVisible();
}

async function drag(
  page: Page,
  canvas: ReturnType<Page["getByLabel"]>,
  button: "left" | "middle",
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("canvas-bounds-missing");
  await page.mouse.move(box.x + start.x, box.y + start.y);
  await page.mouse.down({ button });
  await page.mouse.move(box.x + end.x, box.y + end.y, { steps: 4 });
  await page.mouse.up({ button });
}

async function moveToCell(
  page: Page,
  canvas: Locator,
  gridType: "square" | "hex-pointy",
  row: number,
  column: number,
  dispatchDirectly = false,
): Promise<{ readonly x: number; readonly y: number }> {
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("canvas-bounds-missing");
  const view = await canvas.evaluate((element) => ({
    cameraX: Number(element.dataset.cameraX),
    cameraY: Number(element.dataset.cameraY),
    zoom: Number(element.dataset.zoom),
    cellSize: Number(element.dataset.gridCellSize),
  }));
  const mapX =
    gridType === "square"
      ? (column + 0.5) * view.cellSize
      : Math.sqrt(3) * view.cellSize * (column + 0.5 + 0.5 * (row & 1));
  const mapY =
    gridType === "square"
      ? (row + 0.5) * view.cellSize
      : view.cellSize * (1 + 1.5 * row);
  const position = {
    x: view.cameraX + mapX * view.zoom,
    y: view.cameraY + mapY * view.zoom,
  };
  if (dispatchDirectly) {
    await canvas.dispatchEvent("pointermove", {
      pointerId: 1,
      buttons: 0,
      clientX: box.x + position.x,
      clientY: box.y + position.y,
    });
  } else {
    await page.mouse.move(box.x + position.x, box.y + position.y);
  }
  return position;
}

function captureRuntimeErrors(page: Page): {
  readonly errors: string[];
  dispose(): void;
} {
  const errors: string[] = [];
  const onConsole = (message: ConsoleMessage) => {
    if (message.type() === "error") errors.push(message.text());
  };
  const onPageError = (error: Error) => errors.push(error.message);
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  return {
    errors,
    dispose() {
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
    },
  };
}

async function readDownload(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function exportProject(page: Page): Promise<any> {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出" }).click();
  await page.getByRole("button", { name: "数据导出" }).click();
  await page.getByRole("button", { name: "生成并下载" }).click();
  return JSON.parse((await readDownload(await download)).toString("utf8"));
}

async function expectControlInsideUnscrolledPanel(
  panel: Locator,
  control: Locator,
): Promise<void> {
  const [clientRect, controlRect] = await Promise.all([
    panel.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        top: bounds.top + element.clientTop,
        bottom: bounds.top + element.clientTop + element.clientHeight,
        scrollTop: element.scrollTop,
      };
    }),
    control.boundingBox(),
  ]);
  if (controlRect === null) throw new Error("catalog-control-bounds-missing");
  expect(clientRect.scrollTop).toBe(0);
  expect(controlRect.y).toBeGreaterThanOrEqual(clientRect.top);
  expect(controlRect.y + controlRect.height).toBeLessThanOrEqual(
    clientRect.bottom,
  );
}

for (const gridLabel of ["正方形", "尖顶六边形"] as const) {
  test(`${gridLabel}：固定物体预设支持拖动不扩张、空白选择与整体删除`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const runtime = captureRuntimeErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await createProject(page, gridLabel, `${gridLabel}物体放置`);
    const canvas = page.getByLabel("地图编辑画布");
    const placementTools = page.locator('[data-tool-group="placement"]');
    const objectTool = placementTools.getByRole("button", {
      name: /^物体/u,
    });
    await objectTool.click();
    let objectQuick = page.getByRole("dialog", { name: "选择物体" });
    await objectQuick.getByRole("radio", { name: "圆形物体" }).click();
    await expect(objectTool).toHaveAttribute("aria-label", "物体 · 圆形物体");
    const settings = page.getByRole("region", { name: "当前元素设置" });
    await expect(settings).toContainText(
      "单击地图中的中心格，按当前预设一次性放置完整物体。",
    );
    await expect(settings).toHaveAttribute("data-active-tool", "object");
    await settings.getByLabel("物体颜色").fill("#123456");

    await moveToCell(
      page,
      canvas,
      gridLabel === "正方形" ? "square" : "hex-pointy",
      5,
      gridLabel === "正方形" ? 12 : 8,
    );
    await expect(canvas).toHaveAttribute("data-preview-kind", "object");
    await expect(canvas).toHaveAttribute("data-preview-count", "1");
    await expect(canvas).toHaveAttribute("data-preview-valid", "true");

    await canvas.click({ position: { x: 570, y: 300 } });
    await drag(page, canvas, "left", { x: 620, y: 300 }, { x: 670, y: 300 });
    await objectTool.click();
    objectQuick = page.getByRole("dialog", { name: "选择物体" });
    await objectQuick.getByRole("radio", { name: "方形物体" }).click();
    await expect(settings).toHaveAttribute(
      "data-active-element",
      "tessera.basic:object.square",
    );
    await canvas.click({ position: { x: 520, y: 400 } });
    await objectTool.click();
    objectQuick = page.getByRole("dialog", { name: "选择物体" });
    const clusterButton = objectQuick.getByRole("radio", {
      name: /^七格六边形/u,
    });
    if (gridLabel === "正方形") {
      await expect(clusterButton).toBeDisabled();
    } else {
      await clusterButton.click();
      await expect(settings).toHaveAttribute(
        "data-active-element",
        "tessera.basic:object.hex-cluster",
      );
      await moveToCell(page, canvas, "hex-pointy", 0, 8, true);
      await expect(canvas).toHaveAttribute("data-preview-kind", "object");
      await expect(canvas).toHaveAttribute("data-preview-count", "7");
      await expect(canvas).toHaveAttribute("data-preview-status", "invalid");
      const validCluster = await moveToCell(page, canvas, "hex-pointy", 8, 8);
      await expect(canvas).toHaveAttribute("data-preview-count", "7");
      await expect(canvas).toHaveAttribute("data-preview-valid", "true");
      await canvas.click({ position: validCluster });
    }
    let document = await exportProject(page);
    expect(document.domainGroups).toHaveLength(gridLabel === "正方形" ? 3 : 4);
    expect(
      document.domainGroups
        .map((group: any) => group.memberCellIds.length)
        .sort((left: number, right: number) => left - right),
    ).toEqual(gridLabel === "正方形" ? [1, 1, 1] : [1, 1, 1, 7]);
    expect(
      document.domainGroups.every(
        (group: any) => group.styleOverrides.fillColor === "#123456FF",
      ),
    ).toBe(true);

    await page.getByRole("button", { name: "选择" }).click();
    const firstObjectPosition =
      gridLabel === "正方形" ? { x: 558, y: 306 } : { x: 570, y: 300 };
    await canvas.click({ position: firstObjectPosition });
    const inspector = page.locator("aside").filter({
      has: page.getByText("已选择 1 个对象", { exact: true }),
    });
    await expect(inspector).toBeVisible();
    await page.keyboard.down("Shift");
    await canvas.click({ position: { x: 480, y: 220 } });
    await page.keyboard.up("Shift");
    await expect(inspector).toBeVisible();
    await canvas.click({ position: { x: 480, y: 220 } });
    await expect(inspector).toHaveCount(0);

    await canvas.click({ position: firstObjectPosition });
    const selected = page.locator("aside").filter({
      has: page.getByText("已选择 1 个对象", { exact: true }),
    });
    await expect(selected.getByLabel("物体颜色")).toHaveValue("#123456");
    await selected.getByLabel("物体颜色").fill("#abcdef");
    document = await exportProject(page);
    expect(
      document.domainGroups.filter(
        (group: any) =>
          String(group.styleOverrides.fillColor).toLowerCase() === "#abcdefff",
      ),
    ).toHaveLength(1);
    await selected.getByRole("button", { name: "删除所选对象" }).click();
    document = await exportProject(page);
    expect(document.domainGroups).toHaveLength(gridLabel === "正方形" ? 2 : 3);
    expect(runtime.errors).toEqual([]);
    runtime.dispose();
  });

  test(`${gridLabel}：平移工具、空格临时平移与中键平移完整恢复`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const runtime = captureRuntimeErrors(page);
    await createProject(page, gridLabel, `${gridLabel}平移入口`);
    const canvas = page.getByLabel("地图编辑画布");
    const cameraX = () =>
      canvas.evaluate((element) => Number(element.dataset.cameraX));

    await page.getByRole("button", { name: "平移" }).click();
    const beforeToolPan = await cameraX();
    await drag(page, canvas, "left", { x: 500, y: 300 }, { x: 540, y: 325 });
    expect(await cameraX()).not.toBe(beforeToolPan);
    await expect(page.getByTestId("cell-count")).toContainText("0");

    await page.getByRole("button", { name: "画刷" }).click();
    const beforeSpacePan = await cameraX();
    await page.keyboard.down("Space");
    await drag(page, canvas, "left", { x: 500, y: 300 }, { x: 535, y: 300 });
    await page.keyboard.up("Space");
    expect(await cameraX()).not.toBe(beforeSpacePan);
    await expect(page.getByTestId("cell-count")).toContainText("0");
    await expect(page.getByRole("button", { name: "画刷" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    const beforeMiddlePan = await cameraX();
    await drag(page, canvas, "middle", { x: 500, y: 300 }, { x: 525, y: 315 });
    expect(await cameraX()).not.toBe(beforeMiddlePan);
    await expect(page.getByRole("button", { name: "画刷" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    const search = page.getByRole("searchbox", { name: "搜索元素" });
    await search.fill("标");
    await search.press("Space");
    await expect(search).toHaveValue("标 ");
    await expect(page.getByRole("button", { name: "画刷" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    const box = await canvas.boundingBox();
    if (box === null) throw new Error("canvas-bounds-missing");
    await page.keyboard.down("Space");
    await page.mouse.move(box.x + 480, box.y + 280);
    await page.mouse.down();
    await page.mouse.move(box.x + 510, box.y + 280);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    const afterBlur = await cameraX();
    await page.mouse.move(box.x + 550, box.y + 280);
    await page.mouse.up();
    await page.keyboard.up("Space");
    expect(await cameraX()).toBe(afterBlur);

    const beforePointerCancel = await cameraX();
    await page.keyboard.down("Space");
    await canvas.evaluate((element) => {
      element.addEventListener(
        "pointerdown",
        (event) => {
          element.dataset.lastPointerId = String(event.pointerId);
        },
        { once: true },
      );
    });
    await page.mouse.move(box.x + 480, box.y + 280);
    await page.mouse.down();
    await page.mouse.move(box.x + 510, box.y + 280);
    const pointerId = Number(await canvas.getAttribute("data-last-pointer-id"));
    await canvas.dispatchEvent("pointercancel", {
      pointerId,
      button: 0,
      buttons: 0,
      clientX: box.x + 510,
      clientY: box.y + 280,
    });
    const afterPointerCancel = await cameraX();
    await page.mouse.move(box.x + 550, box.y + 280);
    await page.mouse.up();
    await page.keyboard.up("Space");
    expect(afterPointerCancel).not.toBe(beforePointerCancel);
    expect(await cameraX()).toBe(afterPointerCancel);
    await expect(page.getByTestId("cell-count")).toContainText("0");
    expect(runtime.errors).toEqual([]);
    runtime.dispose();
  });

  test(`${gridLabel}：非元素工具关闭设置，框选只选编辑对象且清空可撤销`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await createProject(page, gridLabel, `${gridLabel}框选清空`);
    const canvas = page.getByLabel("地图编辑画布");
    const activeSettings = page.getByRole("region", {
      name: "当前元素设置",
    });
    await expect(activeSettings).toHaveCount(0);

    await page.getByRole("button", { name: "画刷" }).click();
    await expect(activeSettings).toBeVisible();
    await canvas.click({ position: { x: 650, y: 360 } });
    await expect(page.getByTestId("cell-count")).toContainText("1");

    await page.getByRole("button", { name: "框选" }).click();
    await expect(activeSettings).toHaveCount(0);
    await drag(page, canvas, "left", { x: 610, y: 320 }, { x: 690, y: 400 });
    await expect(
      page.getByText("已选择 1 个对象", { exact: true }),
    ).toBeVisible();

    const clear = page.getByRole("button", { name: "清空画布" });
    await expect(clear).toBeEnabled();
    page.once("dialog", (dialog) => dialog.dismiss());
    await clear.click();
    await expect(page.getByTestId("cell-count")).toContainText("1");
    page.once("dialog", (dialog) => dialog.accept());
    await clear.click();
    await expect(page.getByTestId("cell-count")).toContainText("0");
    await expect(clear).toBeDisabled();
    await page.getByRole("button", { name: "撤销" }).click();
    await expect(page.getByTestId("cell-count")).toContainText("1");
    await page.getByRole("button", { name: "重做" }).click();
    await expect(page.getByTestId("cell-count")).toContainText("0");

    await page.getByRole("button", { name: "画刷" }).click();
    await expect(activeSettings).toBeVisible();
    await page.getByRole("button", { name: "选择" }).click();
    await expect(activeSettings).toHaveCount(0);
    await page.getByRole("button", { name: "平移" }).click();
    await expect(activeSettings).toHaveCount(0);
  });
}

test("所有写入工具提供纯渲染 hover 预览并在离开或切换时清理", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const runtime = captureRuntimeErrors(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await createProject(page, "正方形", "工具 hover 预览");
  const canvas = page.getByLabel("地图编辑画布");
  const editor = page.getByRole("main");
  const revision = await editor.getAttribute("data-project-revision");

  await page.getByRole("button", { name: "画刷" }).click();
  await moveToCell(page, canvas, "square", 5, 12);
  await expect(canvas).toHaveAttribute("data-preview-kind", "brush-paint");
  await expect(canvas).toHaveAttribute("data-preview-count", "1");
  await expect(canvas).toHaveAttribute("data-preview-valid", "true");
  await expect(editor).toHaveAttribute(
    "data-project-revision",
    revision ?? "0",
  );

  await page.getByLabel("操作模式").selectOption("fill");
  await moveToCell(page, canvas, "square", 6, 13);
  await expect(canvas).toHaveAttribute("data-preview-kind", "fill");
  await expect(canvas).toHaveAttribute("data-preview-count", "400");
  await expect(canvas).toHaveAttribute("data-preview-status", "valid");
  await expect(editor).toHaveAttribute(
    "data-project-revision",
    revision ?? "0",
  );

  await page.getByLabel("操作模式").selectOption("erase");
  await moveToCell(page, canvas, "square", 6, 14);
  await expect(canvas).toHaveAttribute("data-preview-kind", "brush-erase");

  await page.getByRole("button", { name: "边", exact: true }).click();
  await moveToCell(page, canvas, "square", 6, 14);
  await expect(canvas).toHaveAttribute("data-preview-kind", "edge");
  await expect(canvas).toHaveAttribute("data-preview-valid", "true");

  const objectTool = page.getByRole("button", { name: /^物体/u });
  await objectTool.click();
  await page
    .getByRole("dialog", { name: "选择物体" })
    .getByRole("radio", { name: "方形物体" })
    .click();
  await moveToCell(page, canvas, "square", 7, 14);
  await expect(canvas).toHaveAttribute("data-preview-kind", "object");
  await expect(canvas).toHaveAttribute("data-preview-count", "1");

  const markerTool = page.getByRole("button", { name: "标记", exact: true });
  await markerTool.click();
  await page
    .getByRole("dialog", { name: "选择放置类型" })
    .getByRole("radio", { name: "标记" })
    .click();
  await moveToCell(page, canvas, "square", 8, 14);
  await expect(canvas).toHaveAttribute("data-preview-kind", "marker");
  await markerTool.click();
  await page
    .getByRole("dialog", { name: "选择放置类型" })
    .getByRole("radio", { name: "文字" })
    .click();
  await moveToCell(page, canvas, "square", 8, 15);
  await expect(canvas).toHaveAttribute("data-preview-kind", "text");

  await page.getByRole("button", { name: "连线与箭头" }).click();
  await expect(canvas).toHaveAttribute("data-preview-kind", "none");
  const connectionStart = await moveToCell(page, canvas, "square", 9, 13);
  await expect(canvas).toHaveAttribute("data-preview-kind", "connection-start");
  await canvas.click({ position: connectionStart });
  await moveToCell(page, canvas, "square", 9, 14);
  await expect(canvas).toHaveAttribute("data-preview-kind", "connection-end");
  // 重选同一个连线工具也必须同步重置 Store FSM 与渲染器草稿。
  await page.getByRole("button", { name: "连线与箭头" }).click();
  await expect(canvas).toHaveAttribute("data-preview-kind", "none");

  await page.getByRole("button", { name: "画刷" }).click();
  await page.getByLabel("操作模式").selectOption("paint");
  const painted = await moveToCell(page, canvas, "square", 10, 12);
  await canvas.click({ position: painted });
  const revisionAfterPaint = await editor.getAttribute("data-project-revision");
  await page.getByRole("button", { name: /^橡皮擦/u }).click();
  await page
    .getByRole("dialog", { name: "选择擦除方式" })
    .getByRole("radio", { name: "单击擦除" })
    .click();
  await moveToCell(page, canvas, "square", 10, 12);
  await expect(canvas).toHaveAttribute("data-preview-kind", "eraser");
  await expect(canvas).toHaveAttribute("data-preview-count", "1");
  await expect(editor).toHaveAttribute(
    "data-project-revision",
    revisionAfterPaint ?? "1",
  );

  await page.mouse.move(10, 10);
  await expect(canvas).toHaveAttribute("data-preview-kind", "none");
  await page.getByRole("button", { name: "画刷" }).click();
  await moveToCell(page, canvas, "square", 11, 13);
  await expect(canvas).toHaveAttribute("data-preview-kind", "brush-paint");
  await page.getByRole("button", { name: "选择" }).click();
  await expect(canvas).toHaveAttribute("data-preview-kind", "none");
  expect(runtime.errors).toEqual([]);
  runtime.dispose();
});

test("非空短标签在三种端点模式下均可连续完成连线", async ({ page }) => {
  test.setTimeout(120_000);
  const runtime = captureRuntimeErrors(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await createProject(page, "正方形", "短标签端点回归");
  const canvas = page.getByLabel("地图编辑画布");
  await page.getByRole("button", { name: "连线与箭头" }).click();
  await page.getByLabel("连线类型").selectOption("line");
  const label = page.getByLabel("短标签");
  await label.fill("测试");

  await page.getByLabel("端点类型").selectOption("cell-center");
  const cellStart = await moveToCell(page, canvas, "square", 5, 12);
  const cellEnd = await moveToCell(page, canvas, "square", 5, 15);
  await canvas.click({ position: cellStart });
  await canvas.click({ position: cellEnd });
  await expect(page.getByTestId("connection-count")).toContainText("1");

  await page.getByLabel("端点类型").selectOption("edge-midpoint");
  await canvas.click({ position: { x: 480, y: 360 } });
  // 草稿开始后更新标签，第二端仍须沿用起点已经确认的边中点模式。
  await label.fill("边标签");
  await canvas.click({ position: { x: 650, y: 360 } });
  await expect(page.getByTestId("connection-count")).toContainText("2");

  await page.getByLabel("端点类型").selectOption("map-point");
  await label.fill("自由点");
  await canvas.click({ position: { x: 500, y: 440 } });
  await canvas.click({ position: { x: 680, y: 440 } });
  await expect(page.getByTestId("connection-count")).toContainText("3");
  await expect(page.getByTestId("connection-notice")).toHaveCount(0);
  expect(runtime.errors).toEqual([]);
  runtime.dispose();
});

for (const gridLabel of ["正方形", "尖顶六边形"] as const) {
  test(`${gridLabel}：地图设置扩大、合法缩小、格子尺寸与越界原子拒绝`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const runtime = captureRuntimeErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await createProject(page, gridLabel, `${gridLabel}地图设置闭环`);
    const editor = page.locator("main[data-project-revision]");
    const canvas = page.getByLabel("地图编辑画布");
    await page.getByRole("button", { name: "地图设置" }).click();
    const panel = page.locator("aside").filter({ hasText: "地图设置" });
    const width = panel.getByLabel("宽度");
    const height = panel.getByLabel("高度");
    const cellSize = panel.getByLabel("单元格尺寸");
    const apply = panel.getByRole("button", { name: "应用地图设置" });

    await width.fill("24");
    await height.fill("22");
    await cellSize.fill("40");
    await apply.click();
    await expect(width).toHaveValue("24");
    await expect(height).toHaveValue("22");
    await expect(cellSize).toHaveValue("40");
    await page.getByRole("button", { name: "撤销" }).click();
    await expect(width).toHaveValue("20");
    await expect(height).toHaveValue("20");
    await expect(cellSize).toHaveValue("36");
    await page.getByRole("button", { name: "重做" }).click();
    await expect(width).toHaveValue("24");
    await expect(height).toHaveValue("22");
    await expect(cellSize).toHaveValue("40");

    await width.fill("18");
    await height.fill("18");
    await apply.click();
    await expect(width).toHaveValue("18");
    await expect(height).toHaveValue("18");
    await page.getByRole("button", { name: "画刷" }).click();
    await canvas.click({ position: { x: 640, y: 360 } });
    await expect(page.getByTestId("cell-count")).toContainText("1");
    const revisionBeforeRejection = await editor.getAttribute(
      "data-project-revision",
    );
    const countBeforeRejection = await page
      .getByTestId("cell-count")
      .textContent();
    const exportBeforeRejection = await exportProject(page);

    await width.fill("4");
    await height.fill("4");
    await apply.click();
    await expect(panel.getByRole("alert")).toHaveText(
      "地图中存在超出新边界的内容；尺寸未修改。",
    );
    await expect(editor).toHaveAttribute(
      "data-project-revision",
      revisionBeforeRejection ?? "",
    );
    await expect(page.getByTestId("cell-count")).toHaveText(
      countBeforeRejection ?? "",
    );
    expect(await exportProject(page)).toEqual(exportBeforeRejection);
    expect(runtime.errors).toEqual([]);
    runtime.dispose();
  });
}

test("元素设置、标记文字编辑、箭头重绑定和锁层拒绝在生产包闭环", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const runtime = captureRuntimeErrors(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await createProject(page, "正方形", "M6 交互闭环");
  const canvas = page.getByLabel("地图编辑画布");
  const resultList = page.getByRole("list", { name: "元素搜索结果" });
  const activeSettings = page.getByRole("region", { name: "当前元素设置" });
  const catalogPanel = page.getByTestId("element-catalog-panel");
  const search = page.getByRole("searchbox", { name: "搜索元素" });
  await expect(activeSettings).toHaveCount(0);
  await page.getByRole("button", { name: "画刷" }).click();
  await expect(activeSettings).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "地格颜色设置" }),
  ).toBeVisible();
  const [settingsBox, searchBox] = await Promise.all([
    activeSettings.boundingBox(),
    search.boundingBox(),
  ]);
  if (settingsBox === null || searchBox === null)
    throw new Error("catalog-bounds-missing");
  expect(settingsBox.y).toBeLessThan(searchBox.y);
  expect(settingsBox.y + settingsBox.height).toBeLessThanOrEqual(720);
  await expect(resultList.getByRole("listitem")).toHaveCount(7);
  await page.getByRole("button", { name: "打开物体预设" }).click();
  await expect(page.getByRole("heading", { name: "物体预设" })).toBeVisible();
  await expect(resultList.getByRole("listitem")).toHaveCount(3);
  await page.getByRole("button", { name: "返回元素目录" }).click();
  await expect(resultList.getByRole("listitem")).toHaveCount(7);
  await search.fill("箭头");
  await expect(resultList.getByRole("listitem")).toHaveCount(1);
  await search.fill("");
  await expect(resultList.getByRole("listitem")).toHaveCount(7);

  await page
    .getByRole("button", {
      name: "使用目录元素 tessera.basic:marker",
      exact: true,
    })
    .click();
  await expect(page.getByRole("heading", { name: "标记设置" })).toBeVisible();
  await expect(activeSettings.getByLabel("标记形状")).toBeVisible();
  await expect(activeSettings.getByLabel("文字内容")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "标记", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await activeSettings.getByLabel("标记形状").selectOption("circle");
  await activeSettings.getByLabel("标记颜色").fill("#123456");
  await activeSettings.getByLabel("标记附文").fill("前线哨站");
  await page.getByRole("button", { name: "标记", exact: true }).click();
  const markerQuick = page.getByRole("dialog", { name: "选择放置类型" });
  await expect(markerQuick.getByLabel("标记附文")).toHaveCount(0);
  await markerQuick.getByRole("radio", { name: "标记" }).click();
  await canvas.click({ position: { x: 700, y: 360 } });
  await expect(page.getByTestId("overlay-count")).toContainText("1");
  await page.getByRole("button", { name: "橡皮擦" }).click();
  await page
    .getByRole("dialog", { name: "选择擦除方式" })
    .getByRole("radio", { name: "单击擦除" })
    .click();
  await canvas.click({ position: { x: 702, y: 378 } });
  await expect(page.getByTestId("overlay-count")).toContainText("0");
  await page.getByRole("button", { name: "撤销" }).click();
  await expect(page.getByTestId("overlay-count")).toContainText("1");
  await page.getByRole("button", { name: "选择" }).click();
  await expect(activeSettings).toHaveCount(0);
  // 锚定标记绘制在地格中心，而不是首次点击的任意点。
  await canvas.click({ position: { x: 702, y: 378 } });
  let inspector = page.locator("aside").filter({ hasText: "已选择 1 个对象" });
  await expect(inspector).toBeVisible();
  await expect(inspector.getByLabel("标记附文")).toHaveValue("前线哨站");
  await inspector.getByLabel("标记附文").fill("集结点");
  await expect(inspector.getByLabel("标记颜色")).toHaveValue("#123456");
  await inspector.getByLabel("标记形状").selectOption("diamond");
  await inspector.getByLabel("标记尺寸").fill("48");
  await inspector.getByLabel("旋转（度）").fill("45");
  await inspector.getByLabel("标记颜色").fill("#abcdef");
  await inspector.getByLabel("透明度").focus();
  await inspector.getByLabel("透明度").press("Home");
  for (let step = 0; step < 8; step += 1)
    await inspector.getByLabel("透明度").press("ArrowRight");
  await page.getByRole("button", { name: "撤销" }).click();
  await page.getByRole("button", { name: "重做" }).click();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("overlay-count")).toContainText("0");
  await page.getByRole("button", { name: "撤销" }).click();
  await expect(page.getByTestId("overlay-count")).toContainText("1");
  await expect(page.getByTestId("save-status")).toHaveText("已保存");
  await page.getByRole("button", { name: "重做" }).click();
  await expect(page.getByTestId("overlay-count")).toContainText("0");
  await page.getByRole("button", { name: "撤销" }).click();
  await expect(page.getByTestId("overlay-count")).toContainText("1");

  await page.getByRole("button", { name: "图层" }).click();
  const markerLayer = page
    .getByRole("listitem")
    .filter({ hasText: "tessera.basic.placed-object · 3000" });
  await markerLayer.getByRole("checkbox", { name: "锁定" }).check();
  await page.getByRole("button", { name: "选择" }).click();
  await canvas.click({ position: { x: 702, y: 378 } });
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("overlay-count")).toContainText("1");
  await expect(page.getByRole("alert")).toContainText("图层已锁定");
  await page.getByRole("button", { name: "图层" }).click();
  await markerLayer.getByRole("checkbox", { name: "锁定" }).uncheck();

  await page
    .getByRole("button", {
      name: "使用目录元素 tessera.basic:text",
      exact: true,
    })
    .click();
  await expect(page.getByRole("heading", { name: "文字设置" })).toBeVisible();
  await expect(activeSettings.getByLabel("文字内容")).toBeVisible();
  await expect(activeSettings.getByLabel("标记形状")).toHaveCount(0);
  const textRotation = activeSettings.getByLabel("旋转（度）");
  await expectControlInsideUnscrolledPanel(catalogPanel, textRotation);
  await expect(textRotation).toBeVisible();
  await activeSettings.getByLabel("锚定方式").selectOption("map-point");
  await activeSettings.getByLabel("文字内容").fill("可编辑文字");
  await canvas.click({ position: { x: 640, y: 420 } });
  await expect(page.getByTestId("overlay-count")).toContainText("2");
  await page.getByRole("button", { name: "选择" }).click();
  await canvas.click({ position: { x: 640, y: 420 } });
  inspector = page.locator("aside").filter({ hasText: "已选择 1 个对象" });
  await expect(inspector.getByLabel("文字内容")).toHaveValue("可编辑文字");
  await inspector.getByLabel("文字内容").fill("文字已编辑");
  await inspector.getByRole("button", { name: "删除所选对象" }).click();
  await expect(page.getByTestId("overlay-count")).toContainText("1");
  await page.getByRole("button", { name: "撤销" }).click();
  await expect(page.getByTestId("overlay-count")).toContainText("2");
  await expect(page.getByTestId("save-status")).toHaveText("已保存");
  await page.getByRole("button", { name: "重做" }).click();
  await expect(page.getByTestId("overlay-count")).toContainText("1");
  await page.getByRole("button", { name: "撤销" }).click();
  await expect(page.getByTestId("overlay-count")).toContainText("2");

  await page.getByRole("button", { name: "连线与箭头" }).first().click();
  const connectionLabel = activeSettings.getByLabel("短标签");
  await expectControlInsideUnscrolledPanel(catalogPanel, connectionLabel);
  await expect(connectionLabel).toBeVisible();
  await page.getByLabel("连线类型").selectOption("arrow");
  await page.getByLabel("端点类型").selectOption("cell-center");
  await canvas.click({ position: { x: 460, y: 300 } });
  await canvas.click({ position: { x: 620, y: 300 } });
  await expect(page.getByTestId("connection-count")).toContainText("1");
  await page.getByRole("button", { name: "选择" }).click();
  await canvas.click({ position: { x: 540, y: 300 } });
  await page.getByRole("button", { name: "反转方向" }).click();
  await page.getByRole("button", { name: "重新绑定起点" }).click();
  await expect(page.getByText(/正在重新绑定起点/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText(/正在重新绑定起点/)).toHaveCount(0);
  await page.getByRole("button", { name: "重新绑定起点" }).click();
  await canvas.click({ position: { x: 460, y: 300 } });
  await expect(page.getByTestId("connection-notice")).toContainText(
    /当前目标（第 \d+ 行、第 \d+ 列）与起点相同，请选取正确的终点。/,
  );
  await expect(page.getByText("连接操作未提交", { exact: false })).toHaveCount(
    0,
  );
  await expect(page.getByText(/正在重新绑定起点/)).toBeVisible();
  await canvas.click({ position: { x: 420, y: 360 } });
  await expect(page.getByTestId("connection-notice")).toHaveCount(0);
  await expect(page.getByText(/正在重新绑定起点/)).toHaveCount(0);
  await page.getByRole("button", { name: "撤销" }).click();
  await page.getByRole("button", { name: "撤销" }).click();
  await page.getByRole("button", { name: "重做" }).click();
  await page.getByRole("button", { name: "重做" }).click();

  // 等待防抖自动保存完成，再验证显式保存，避免让两次 IndexedDB 写事务竞争。
  await expect(page.getByTestId("save-status")).toHaveText("已保存");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByTestId("save-status")).toHaveText("已保存");
  await page.reload();
  await expect(page.getByTestId("overlay-count")).toContainText("2");
  await expect(page.getByTestId("connection-count")).toContainText("1");
  const document = await exportProject(page);
  const marker = document.managers.overlayManager.overlays.find(
    (overlay: { overlayType?: string }) => overlay.overlayType === "marker",
  );
  expect(marker.styleOverrides).toMatchObject({
    markerShape: "diamond",
    size: 48,
    rotation: 45,
    color: "#abcdefFF",
    opacity: 0.4,
  });
  expect(marker.attributes).toMatchObject({ label: "集结点" });
  const text = document.managers.overlayManager.overlays.find(
    (overlay: { overlayType?: string }) => overlay.overlayType === "text",
  );
  expect(text).toMatchObject({
    overlayType: "text",
    attributes: { text: "文字已编辑" },
  });
  const arrow = document.managers.connectionManager.connections[0];
  expect(arrow).toMatchObject({
    kind: "arrow",
    arrowStart: true,
    arrowEnd: false,
  });

  for (const format of ["PNG", "SVG"] as const) {
    await page.getByRole("button", { name: "导出" }).click();
    await page.getByRole("button", { name: "图片导出" }).click();
    await page.getByLabel(format).check();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "开始生成" }).click();
    const bytes = await readDownload(await download);
    if (format === "PNG") {
      expect([...bytes.subarray(0, 8)]).toEqual([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
    } else {
      expect(bytes.toString("utf8")).toContain("<svg");
    }
  }
  expect(runtime.errors).toEqual([]);
  runtime.dispose();
});
