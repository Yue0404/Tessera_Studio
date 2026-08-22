import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

test("生成发布候选新建页与编辑器视觉证据", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
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

  const trackedOutput = process.env.TESSERA_CAPTURE_RELEASE_VISUALS === "1";
  const outputDirectory = trackedOutput
    ? resolve(import.meta.dirname, "../../manual/assets")
    : testInfo.outputPath("visual-evidence");
  await mkdir(outputDirectory, { recursive: true });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "新建地图" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator("body")).toHaveJSProperty("scrollHeight", 900);
  await page.screenshot({
    path: resolve(outputDirectory, "production-new-project-1440x900.png"),
    fullPage: false,
  });

  await page.getByLabel("工程名称").fill("发布候选视觉证据");
  await page.getByText("尖顶六边形", { exact: true }).click();
  await page.getByRole("button", { name: "创建工程" }).click();
  await expect(page.getByLabel("地图编辑画布")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator("body")).toHaveJSProperty("scrollHeight", 900);
  await page.screenshot({
    path: resolve(outputDirectory, "production-editor-1440x900.png"),
    fullPage: false,
  });

  expect(failedResponses).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  console.log(
    `视觉证据浏览器：${browser.browserType().name()} ${browser.version()}`,
  );
});
