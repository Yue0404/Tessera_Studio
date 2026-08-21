import { expect, test, type Page } from "@playwright/test";

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

for (const gridLabel of ["正方形", "尖顶六边形"] as const) {
  test(`${gridLabel}：创建、编辑、撤销重做、自动保存、刷新、导出与载入`, async ({
    page,
    browser,
  }) => {
    const name = `${gridLabel}端到端`;
    await createProject(page, gridLabel, name);
    const canvas = page.getByLabel("地图编辑画布");
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
    const download = await downloadPromise;
    const path = await download.path();
    if (path === null) throw new Error("导出文件没有可读取的临时路径");
    const cleanContext = await browser.newContext();
    const cleanPage = await cleanContext.newPage();
    await cleanPage.goto("/");
    await cleanPage.getByLabel("打开").setInputFiles(path);
    await expect(cleanPage.getByText(name, { exact: true })).toBeVisible();
    await expect(cleanPage.getByTestId("edge-count")).toContainText("1");
    await cleanContext.close();
  });
}

test("40000×40000 创建保持稀疏，合法 full JSON 中没有显式分块或对象", async ({
  page,
}) => {
  await createProject(page, "正方形", "稀疏上限", "40000");
  await expect(page.getByTestId("cell-count")).toContainText("0");
  await expect(page.getByTestId("edge-count")).toContainText("0");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出" }).click();
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
