import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

async function createProject(page: Page, options: { large?: boolean } = {}) {
  await page.goto("/");
  await page
    .getByLabel("工程名称")
    .fill(options.large ? "最大地图" : "M6-B 工程");
  await page.getByText("正方形", { exact: true }).click();
  if (options.large === true) {
    await page.getByLabel("宽度").fill("40000");
    await page.getByLabel("高度").fill("40000");
  }
  await page.getByRole("button", { name: "创建" }).click();
  await expect(page.getByTestId("map-canvas")).toBeVisible({ timeout: 20_000 });
}

test("新建表单用真实 SVG 预览两种网格并随尺寸样式更新", async ({ page }) => {
  await page.goto("/");
  const preview = page.getByTestId("project-grid-preview");
  await expect(preview.getByRole("img")).toHaveAttribute(
    "data-grid-type",
    "hex-pointy",
  );
  await expect(preview.locator("polygon")).toHaveCount(12);
  await page.getByText("正方形", { exact: true }).click();
  await page.getByLabel("宽度").fill("2");
  await page.getByLabel("高度").fill("2");
  await page.getByLabel("单元格尺寸").fill("48");
  await expect(preview.getByRole("img")).toHaveAttribute(
    "data-grid-type",
    "square",
  );
  await expect(preview.getByRole("img")).toHaveAttribute("data-map-width", "2");
  await expect(preview.locator("polygon")).toHaveCount(4);
});

test("最大地图适应限制、内容适应、指针状态和快捷键保持稀疏", async ({
  page,
}) => {
  await createProject(page, { large: true });
  const canvas = page.getByTestId("map-canvas");
  await page.getByRole("button", { name: "适应地图" }).click();
  await expect(page.getByRole("alert")).toContainText("25% 安全缩放下限");
  await page.keyboard.press("b");
  await expect(page.getByRole("button", { name: "画刷" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await canvas.click({ position: { x: 420, y: 300 } });
  await expect(page.getByTestId("cell-count")).toContainText("1");
  await page.getByRole("button", { name: "适应已有内容" }).click();
  await expect(page.getByTestId("zoom-level")).toHaveText("缩放 400%");
  const zoomInput = page.getByRole("spinbutton", { name: "缩放百分比" });
  await zoomInput.fill("450");
  await zoomInput.press("Enter");
  await expect(page.getByTestId("zoom-level")).toHaveText("缩放 400%");
  await zoomInput.fill("5");
  await zoomInput.blur();
  await expect(page.getByTestId("zoom-level")).toHaveText("缩放 25%");
  await zoomInput.fill("250");
  await zoomInput.press("Escape");
  await expect(zoomInput).toHaveValue("25");
  await page.getByRole("button", { name: "100%" }).click();
  await expect(page.getByTestId("zoom-level")).toHaveText("缩放 100%");
  await page.getByRole("button", { name: "地图设置" }).click();
  await page.getByRole("button", { name: "居中" }).click();
  const centering = await page.evaluate(() => {
    const root = document.querySelector("main");
    const canvas = document.querySelector<HTMLCanvasElement>(
      '[data-testid="map-canvas"]',
    );
    if (root === null || canvas === null)
      throw new Error("center-proof-missing");
    const rootRect = root.getBoundingClientRect();
    let left = 0;
    let right = 0;
    for (const element of root.querySelectorAll<HTMLElement>(
      "[data-canvas-obstruction]",
    )) {
      const rect = element.getBoundingClientRect();
      if (element.dataset.canvasObstruction === "left") {
        left = Math.max(left, rect.right - rootRect.left);
      } else if (element.dataset.canvasObstruction === "right") {
        right = Math.max(right, rootRect.right - rect.left);
      }
    }
    const zoom = Number(canvas.dataset.zoom);
    const cameraX = Number(canvas.dataset.cameraX);
    const cellSize = Number(canvas.dataset.gridCellSize);
    return {
      actual: cameraX + (40_000 * cellSize * zoom) / 2,
      expected: left + (rootRect.width - left - right) / 2,
    };
  });
  expect(Math.abs(centering.actual - centering.expected)).toBeLessThan(1);
  await canvas.hover({ position: { x: 400, y: 300 } });
  await expect(page.getByTestId("pointer-status")).not.toHaveText(
    "指针：地图外",
  );
  await page.getByRole("button", { name: "100%" }).hover();
  await expect(page.getByTestId("pointer-status")).toHaveText("指针：地图外");

  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("cell-count")).toContainText("0");
  await page.keyboard.press("Control+Shift+z");
  await expect(page.getByTestId("cell-count")).toContainText("1");
  const search = page.getByRole("searchbox", { name: "搜索元素" });
  await search.focus();
  await search.press("v");
  await expect(search).toHaveValue("v");
  await expect(page.getByRole("button", { name: "画刷" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("容量不足时可立即导出并重新载入完整 Project v1", async ({ page }) => {
  await page.addInitScript(() => {
    const originalAdd = IDBObjectStore.prototype.add;
    const originalPut = IDBObjectStore.prototype.put;
    const shouldFail = () =>
      (window as unknown as { __tesseraFailSave?: boolean })
        .__tesseraFailSave === true;
    IDBObjectStore.prototype.add = function (...args) {
      if (shouldFail()) throw new DOMException("quota", "QuotaExceededError");
      return originalAdd.apply(this, args);
    };
    IDBObjectStore.prototype.put = function (...args) {
      if (shouldFail()) throw new DOMException("quota", "QuotaExceededError");
      return originalPut.apply(this, args);
    };
  });
  await createProject(page);
  await page.evaluate(() => {
    (window as unknown as { __tesseraFailSave?: boolean }).__tesseraFailSave =
      true;
  });
  await page.keyboard.press("b");
  await page.getByTestId("map-canvas").click({ position: { x: 420, y: 300 } });
  await page.keyboard.press("Control+s");
  const recovery = page.getByTestId("save-recovery");
  await expect(recovery).toContainText("本地存储空间不足");
  const downloadPromise = page.waitForEvent("download");
  await recovery.getByRole("button", { name: "立即导出完整工程" }).click();
  const download = await downloadPromise;
  const projectPath = await download.path();
  expect(projectPath).not.toBeNull();
  if (projectPath === null) throw new Error("完整工程下载缺少本地路径");
  const document = JSON.parse(await readFile(projectPath, "utf8"));
  expect(document.formatVersion).toBe("1");
  expect(document.exportScope).toBe("full");
  await page.evaluate(() => {
    (window as unknown as { __tesseraFailSave?: boolean }).__tesseraFailSave =
      false;
  });
  await page
    .locator('input[type="file"][accept=".tessera-project.json"]')
    .setInputFiles(projectPath);
  await expect(page.getByTestId("cell-count")).toContainText("1", {
    timeout: 20_000,
  });
});
