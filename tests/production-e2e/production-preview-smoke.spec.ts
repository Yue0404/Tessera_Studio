import { expect, test } from "@playwright/test";

test("生产预览可载入并打开包设置", async ({ page }) => {
  const pageErrors: string[] = [];
  const runtimeConsoleErrors: string[] = [];
  const failedScripts: string[] = [];

  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().startsWith("Failed to load resource:")
    ) {
      runtimeConsoleErrors.push(message.text());
    }
  });
  page.on("response", (response) => {
    if (
      response.request().resourceType() === "script" &&
      response.status() >= 400
    ) {
      failedScripts.push(`${response.status()} ${response.url()}`);
    }
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "新建地图" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("应用载入失败，请重试。")).toHaveCount(0);

  await page.getByRole("button", { name: "管理模块与预设包" }).click();
  await expect(page.getByRole("dialog", { name: "包设置" })).toBeVisible();

  expect(failedScripts).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(runtimeConsoleErrors).toEqual([]);
});
