import { expect, test, type Download, type Page } from "@playwright/test";

async function createSquareProject(page: Page, name: string, size = "20") {
  await page.goto("/");
  await page.getByLabel("工程名称").fill(name);
  await page.getByText("正方形", { exact: true }).click();
  await page.getByLabel("宽度").fill(size);
  await page.getByLabel("高度").fill(size);
  await page.getByRole("button", { name: "创建工程" }).click();
  await expect(page.getByLabel("地图编辑画布")).toBeVisible();
}

async function readDownload(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function openVisualExport(page: Page) {
  await page.getByRole("button", { name: "导出" }).click();
  await page.getByRole("button", { name: "图片导出" }).click();
  await expect(
    page.getByRole("dialog", { name: "导出地图图片" }),
  ).toBeVisible();
}

test("PNG viewport 与 SVG selection 通过生产 UI 下载并可解析", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await createSquareProject(page, "图片 UI 导出");
  const canvas = page.getByLabel("地图编辑画布");
  await page.getByRole("button", { name: "画刷" }).click();
  await canvas.click({ position: { x: 500, y: 300 } });
  await expect(page.getByTestId("cell-count")).toContainText("1");

  await openVisualExport(page);
  const pngDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "开始生成" }).click();
  const png = await pngDownload;
  expect(png.suggestedFilename()).toBe("图片 UI 导出.png");
  const pngBytes = await readDownload(png);
  expect([...pngBytes.subarray(0, 8)]).toEqual([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  expect(pngBytes.readUInt32BE(16)).toBeGreaterThan(0);
  expect(pngBytes.readUInt32BE(20)).toBeGreaterThan(0);
  await expect(page.getByTestId("cell-count")).toContainText("1");

  await page.getByRole("button", { name: "框选" }).click();
  await canvas.hover({ position: { x: 450, y: 250 } });
  await page.mouse.down();
  await page.mouse.move(560, 350, { steps: 4 });
  await page.mouse.up();
  await openVisualExport(page);
  await page.getByLabel("SVG").check();
  await page.getByLabel("图片范围").selectOption("selection");
  await page.getByText("显示系统网格").click();
  const svgDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "开始生成" }).click();
  const svg = await svgDownload;
  expect(svg.suggestedFilename()).toBe("图片 UI 导出.svg");
  const svgText = (await readDownload(svg)).toString("utf8");
  expect(svgText.length).toBeGreaterThan(100);
  const parsed = await page.evaluate((text) => {
    const document = new DOMParser().parseFromString(text, "image/svg+xml");
    return {
      root: document.documentElement.localName,
      parserErrors: document.querySelectorAll("parsererror").length,
      viewBox: document.documentElement.getAttribute("viewBox"),
    };
  }, svgText);
  expect(parsed).toMatchObject({ root: "svg", parserErrors: 0 });
  expect(parsed.viewBox).toBeTruthy();
});

test("已启动的 PNG 可取消，非法 custom 范围给出受控行动", async ({ page }) => {
  test.setTimeout(90_000);
  await createSquareProject(page, "图片取消", "80");
  const downloads: Download[] = [];
  page.on("download", (download) => downloads.push(download));
  await openVisualExport(page);
  await page.getByLabel("PNG").check();
  await page.getByLabel("图片范围").selectOption("full-map");
  await page.getByLabel("2×").check();
  await page.getByRole("button", { name: "开始生成" }).click();
  await page.getByRole("button", { name: "取消生成" }).click();
  await expect(page.getByText("已取消图片导出，没有生成文件。")).toBeVisible();
  expect(downloads).toHaveLength(0);

  await page.getByLabel("图片范围").selectOption("custom");
  await page.getByLabel("最小 X").fill("100");
  await page.getByLabel("最大 X").fill("10");
  await page.getByRole("button", { name: "开始生成" }).click();
  await expect(page.getByRole("alert")).toContainText("图片范围无效");
  await expect(
    page.getByRole("button", { name: "改用当前视口" }),
  ).toBeVisible();
  expect(downloads).toHaveLength(0);
});
