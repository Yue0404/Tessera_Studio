import { expect, test, type Download, type Page } from "@playwright/test";

async function waitForEditor(page: Page) {
  await expect(page.getByLabel("地图编辑画布")).toBeVisible({
    timeout: 30_000,
  });
}

async function downloadProject(
  page: Page,
  kind: "完整 Tessera Project" | "部分 Tessera Project",
): Promise<Download> {
  await page.getByRole("button", { name: "导出" }).click();
  await page.getByRole("button", { name: "数据导出" }).click();
  if (kind === "部分 Tessera Project") {
    await page.getByLabel(kind).check();
    await page.getByLabel("自定义地图矩形").check();
  }
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "生成并下载" }).click();
  return downloading;
}

test("Pages 子路径完成创建、保存恢复和完整/部分工程往返", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000);
  if (baseURL === undefined) throw new Error("pages-base-url-unavailable");
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  await page.goto(baseURL);
  await expect(page.getByRole("heading", { name: "新建地图" })).toBeVisible();
  const scripts = await page
    .locator('script[type="module"][src]')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("src")),
    );
  expect(scripts.every((source) => source?.startsWith("./assets/"))).toBe(true);

  await page.getByLabel("工程名称").fill("Pages 候选工程");
  await page.getByText("正方形", { exact: true }).click();
  await page.getByLabel("宽度").fill("20");
  await page.getByLabel("高度").fill("20");
  await page.getByRole("button", { name: "创建工程" }).click();
  await waitForEditor(page);
  await page.getByRole("button", { name: "画刷" }).click();
  await page.getByLabel("地图编辑画布").click({
    position: { x: 500, y: 300 },
  });
  await expect(page.getByTestId("cell-count")).toContainText("1");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByTestId("save-status")).toHaveText("已保存");
  await page.reload();
  await waitForEditor(page);
  await expect(page.getByTestId("cell-count")).toContainText("1");

  const full = await downloadProject(page, "完整 Tessera Project");
  const fullPath = await full.path();
  if (fullPath === null)
    throw new Error("pages-full-download-path-unavailable");
  const partial = await downloadProject(page, "部分 Tessera Project");
  const partialPath = await partial.path();
  if (partialPath === null) {
    throw new Error("pages-partial-download-path-unavailable");
  }

  const fullContext = await browser.newContext();
  const partialContext = await browser.newContext();
  try {
    const fullPage = await fullContext.newPage();
    await fullPage.goto(baseURL);
    await fullPage
      .locator('input[accept=".tessera-project.json"]')
      .setInputFiles(fullPath);
    await waitForEditor(fullPage);
    await expect(fullPage.getByTestId("cell-count")).toContainText("1");

    const partialPage = await partialContext.newPage();
    await partialPage.goto(baseURL);
    await partialPage
      .locator('input[accept=".tessera-project.json"]')
      .setInputFiles(partialPath);
    await waitForEditor(partialPage);
    await expect(
      partialPage.getByText("当前为部分工程", { exact: true }),
    ).toBeVisible();
    await expect(partialPage.getByTestId("cell-count")).toContainText("1");
  } finally {
    await fullContext.close();
    await partialContext.close();
  }

  expect(failedResponses).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
