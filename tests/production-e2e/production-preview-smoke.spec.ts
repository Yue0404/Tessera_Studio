import { expect, test } from "@playwright/test";

test("生产预览可载入并打开包设置", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedResources: string[] = [];

  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failedResources.push(`${response.status()} ${response.url()}`);
    }
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "新建地图" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("应用载入失败，请重试。")).toHaveCount(0);

  await page.getByRole("button", { name: "管理模块与预设包" }).click();
  const dialog = page.getByRole("dialog", { name: "包设置" });
  await expect(dialog).toBeVisible();

  const importButton = dialog.getByRole("button", {
    name: "导入已有文明 6 模块包",
  });
  await expect(importButton).toBeVisible();
  await expect(importButton).toHaveCSS("color", "rgb(19, 38, 48)");
  await expect(importButton).toHaveCSS(
    "background-color",
    "rgb(217, 184, 102)",
  );

  await importButton.hover();
  await expect(importButton).toHaveCSS(
    "background-color",
    "rgb(240, 203, 117)",
  );
  await page.mouse.move(0, 0);
  await page.keyboard.press("Tab");
  await expect(importButton).toBeFocused();
  await expect(importButton).toHaveCSS("outline-width", "3px");
  await expect(importButton).toHaveCSS("outline-color", "rgb(115, 167, 216)");

  await importButton.evaluate((button) => {
    if (button instanceof HTMLButtonElement) button.disabled = true;
  });
  await expect(importButton).toHaveCSS("color", "rgb(198, 205, 207)");
  await expect(importButton).toHaveCSS("background-color", "rgb(43, 61, 71)");

  expect(failedResources).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
