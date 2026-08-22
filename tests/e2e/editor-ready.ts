import { expect, type Page } from "@playwright/test";

const EDITOR_LAZY_TIMEOUT = 30_000;

/**
 * 新浏览器上下文首次请求编辑器 chunk 时，Vite 可能需要现场编译依赖。
 * 等待局部懒加载状态结束，再以真实画布作为编辑器已可交互的事实。
 */
export async function waitForEditorReady(page: Page): Promise<void> {
  await page
    .getByRole("status")
    .filter({ hasText: "正在加载编辑器" })
    .waitFor({ state: "hidden", timeout: EDITOR_LAZY_TIMEOUT });
  await expect(page.getByLabel("地图编辑画布")).toBeVisible({
    timeout: EDITOR_LAZY_TIMEOUT,
  });
}

export async function waitForImportedProject(
  page: Page,
  projectName: string,
): Promise<void> {
  await waitForEditorReady(page);
  await expect(page.getByText(projectName, { exact: true })).toBeVisible({
    timeout: EDITOR_LAZY_TIMEOUT,
  });
}
