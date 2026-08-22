import { expect, test, type Download, type Page } from "@playwright/test";
import { waitForEditorReady } from "./editor-ready.js";

async function createSquareProject(page: Page, name: string) {
  await page.goto("/");
  await page.getByLabel("工程名称").fill(name);
  await page.getByText("正方形", { exact: true }).click();
  await page.getByLabel("宽度").fill("20");
  await page.getByLabel("高度").fill("20");
  await page.getByRole("button", { name: "创建工程" }).click();
  await waitForEditorReady(page);
}

async function downloadFromDialog(
  page: Page,
  kind: "完整 Tessera Project" | "部分 Tessera Project" | "Tessera Fragment",
): Promise<Download> {
  await page.getByRole("button", { name: "导出" }).click();
  await page.getByRole("button", { name: "数据导出" }).click();
  if (kind !== "完整 Tessera Project") {
    await page.getByLabel(kind).check();
    await page.getByLabel("自定义地图矩形").check();
  }
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "生成并下载" }).click();
  return downloading;
}

test("Project full/partial 下载载入、Fragment 合并与同 ID 冲突均走真实 UI", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await createSquareProject(page, "E2 数据工作流");
  await page.getByRole("button", { name: "画刷" }).click();
  await page.getByLabel("地图编辑画布").click({ position: { x: 500, y: 300 } });
  await expect(page.getByTestId("cell-count")).toContainText("1");

  const full = await downloadFromDialog(page, "完整 Tessera Project");
  const fullPath = await full.path();
  if (fullPath === null) throw new Error("完整工程下载没有临时路径");
  expect(full.suggestedFilename()).toBe("E2 数据工作流.tessera-project.json");

  const partial = await downloadFromDialog(page, "部分 Tessera Project");
  const partialPath = await partial.path();
  if (partialPath === null) throw new Error("部分工程下载没有临时路径");
  expect(partial.suggestedFilename()).toBe(
    "E2 数据工作流.partial.tessera-project.json",
  );

  const fragment = await downloadFromDialog(page, "Tessera Fragment");
  const fragmentPath = await fragment.path();
  if (fragmentPath === null) throw new Error("Fragment 下载没有临时路径");
  expect(fragment.suggestedFilename()).toBe(
    "E2 数据工作流.tessera-fragment.json",
  );

  const fullContext = await browser.newContext();
  const fullPage = await fullContext.newPage();
  await fullPage.goto("/");
  await fullPage
    .locator('input[accept=".tessera-project.json"]')
    .setInputFiles(fullPath);
  await waitForEditorReady(fullPage);
  await expect(fullPage.getByTestId("cell-count")).toContainText("1", {
    timeout: 30_000,
  });
  await fullPage
    .locator('input[accept=".tessera-project.json"]')
    .setInputFiles(fullPath);
  await expect(
    fullPage.getByRole("dialog", { name: "本地已有同一工程" }),
  ).toBeVisible();
  await fullPage.getByRole("button", { name: "替换本地工程" }).click();
  await fullPage.getByRole("button", { name: "确认替换本地工程" }).click();
  await expect(
    fullPage.getByRole("dialog", { name: "本地已有同一工程" }),
  ).toBeHidden();
  await fullContext.close();

  const partialContext = await browser.newContext();
  const partialPage = await partialContext.newPage();
  await partialPage.goto("/");
  await partialPage
    .locator('input[accept=".tessera-project.json"]')
    .setInputFiles(partialPath);
  await waitForEditorReady(partialPage);
  await expect(
    partialPage.getByText("当前为部分工程", { exact: true }),
  ).toBeVisible();
  await expect(partialPage.getByTestId("cell-count")).toContainText("1");
  await downloadFromDialog(partialPage, "完整 Tessera Project");
  await expect(
    partialPage.getByText("当前为部分工程", { exact: true }),
  ).toBeVisible();
  await partialContext.close();

  const mergeContext = await browser.newContext();
  const mergePage = await mergeContext.newPage();
  await createSquareProject(mergePage, "Fragment 目标");
  await mergePage
    .locator('input[accept=".tessera-fragment.json"]')
    .setInputFiles(fragmentPath);
  await expect(
    mergePage.getByRole("dialog", { name: "合并 Tessera Fragment" }),
  ).toBeVisible();
  await mergePage.getByRole("button", { name: "确认合并并保存" }).click();
  await expect(mergePage.getByTestId("cell-count")).toContainText("1");
  await mergeContext.close();
});
