import {
  expect,
  test,
  type ConsoleMessage,
  type Download,
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

for (const gridLabel of ["正方形", "尖顶六边形"] as const) {
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
}

test("元素搜索、标记编辑、箭头反转重绑定和锁层拒绝在生产包闭环", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const runtime = captureRuntimeErrors(page);
  await createProject(page, "正方形", "M6 交互闭环");
  const canvas = page.getByLabel("地图编辑画布");
  const resultList = page.getByRole("list", { name: "元素搜索结果" });
  await expect(resultList.getByRole("listitem")).toHaveCount(6);
  await page.getByRole("searchbox", { name: "搜索元素" }).fill("箭头");
  await expect(resultList.getByRole("listitem")).toHaveCount(1);
  await page.getByRole("searchbox", { name: "搜索元素" }).fill("");
  await expect(resultList.getByRole("listitem")).toHaveCount(6);

  await page.getByLabel("标记形状").selectOption("circle");
  await page.getByRole("button", { name: "标记", exact: true }).click();
  await canvas.click({ position: { x: 700, y: 360 } });
  await expect(page.getByTestId("overlay-count")).toContainText("1");
  await page.getByRole("button", { name: "选择" }).click();
  // 锚定标记绘制在地格中心，而不是首次点击的任意点。
  await canvas.click({ position: { x: 702, y: 378 } });
  await page.getByRole("button", { name: "属性" }).click();
  const inspector = page
    .locator("aside")
    .filter({ hasText: "已选择 1 个对象" });
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

  await page.getByRole("button", { name: "图层" }).click();
  const markerLayer = page
    .getByRole("listitem")
    .filter({ hasText: "tessera.basic.placed-object · 3000" });
  await markerLayer.getByRole("checkbox", { name: "锁定" }).check();
  await page.getByRole("button", { name: "标记", exact: true }).click();
  await canvas.click({ position: { x: 666, y: 360 } });
  await expect(page.getByTestId("overlay-count")).toContainText("1");
  await expect(page.getByRole("alert")).toContainText("图层已锁定");
  await markerLayer.getByRole("checkbox", { name: "锁定" }).uncheck();

  await page.getByRole("button", { name: "连线与箭头" }).first().click();
  await page.getByLabel("连线类型").selectOption("arrow");
  await page.getByLabel("端点类型").selectOption("cell-center");
  await canvas.click({ position: { x: 460, y: 300 } });
  await canvas.click({ position: { x: 620, y: 300 } });
  await expect(page.getByTestId("connection-count")).toContainText("1");
  await page.getByRole("button", { name: "选择" }).click();
  await canvas.click({ position: { x: 540, y: 300 } });
  await page.getByRole("button", { name: "属性" }).click();
  await page.getByRole("button", { name: "反转方向" }).click();
  await page.getByRole("button", { name: "重新绑定起点" }).click();
  await expect(page.getByText(/正在重新绑定起点/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText(/正在重新绑定起点/)).toHaveCount(0);
  await page.getByRole("button", { name: "重新绑定起点" }).click();
  await canvas.click({ position: { x: 460, y: 300 } });
  await expect(page.getByRole("alert")).toContainText("不能是同一目标");
  await expect(page.getByText(/正在重新绑定起点/)).toBeVisible();
  await canvas.click({ position: { x: 420, y: 360 } });
  await expect(page.getByText(/正在重新绑定起点/)).toHaveCount(0);
  await page.getByRole("button", { name: "撤销" }).click();
  await page.getByRole("button", { name: "撤销" }).click();
  await page.getByRole("button", { name: "重做" }).click();
  await page.getByRole("button", { name: "重做" }).click();

  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByTestId("save-status")).toHaveText("已保存");
  await page.reload();
  await expect(page.getByTestId("overlay-count")).toContainText("1");
  await expect(page.getByTestId("connection-count")).toContainText("1");
  const document = await exportProject(page);
  const marker = document.managers.overlayManager.overlays[0];
  expect(marker.styleOverrides).toMatchObject({
    markerShape: "diamond",
    size: 48,
    rotation: 45,
    color: "#abcdefFF",
    opacity: 0.4,
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
