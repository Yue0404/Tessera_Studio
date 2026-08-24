import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function createSquareProject(page: Page, name: string) {
  await page.goto("/");
  await page.getByLabel("工程名称").fill(name);
  await page.getByText("正方形", { exact: true }).click();
  await page.getByLabel("宽度").fill("20");
  await page.getByLabel("高度").fill("20");
  await page.getByRole("button", { name: "创建工程" }).click();
  await expect(page.getByLabel("地图编辑画布")).toBeVisible({
    timeout: 30_000,
  });
}

test("限制性 CSP 在开发与生产资源路径下无违规", async ({ page }) => {
  await page.addInitScript(() => {
    const violations: string[] = [];
    Object.defineProperty(window, "__tesseraCspViolations", {
      configurable: true,
      value: violations,
    });
    document.addEventListener("securitypolicyviolation", (event) => {
      violations.push(
        [event.violatedDirective, event.blockedURI, event.sourceFile].join("|"),
      );
    });
  });
  await createSquareProject(page, "CSP 验证");

  const directives = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute("content");
  expect(directives).toBe(
    "default-src 'self'; script-src 'self'; worker-src 'self' blob:; " +
      "img-src 'self' blob: data:; font-src 'self' blob: data:; " +
      "style-src 'self' 'unsafe-inline'; connect-src 'self' " +
      "ws://localhost:* ws://127.0.0.1:*; object-src 'none'; " +
      "base-uri 'none'; form-action 'self'",
  );
  expect(directives).not.toContain("'unsafe-eval'");
  expect(directives).not.toContain("https:");
  // Radix 浮层仅使用 React 管理的行内定位样式，unsafe-inline 不扩散到脚本。
  expect(directives?.match(/'unsafe-inline'/g)).toHaveLength(1);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & {
              readonly __tesseraCspViolations?: readonly string[];
            }
          ).__tesseraCspViolations ?? [],
      ),
    )
    .toEqual([]);
});

test("新建页与编辑器通过 axe WCAG 2.2 AA 自动扫描", async ({ page }) => {
  await page.goto("/");
  const createResults = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  expect(createResults.violations).toEqual([]);

  await createSquareProject(page, "无障碍扫描");
  const editorResults = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  expect(editorResults.violations).toEqual([]);
});

test("画布工具支持键盘焦点、激活、tooltip 与 reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await createSquareProject(page, "键盘导航");
  const canvas = page.getByLabel("地图编辑画布");
  await canvas.focus();
  await expect(canvas).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "新建" })).toBeFocused();

  const select = page.getByRole("button", { name: "选择" });
  await select.focus();
  await page.keyboard.press("Enter");
  await expect(select).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Tab");
  const pan = page.getByRole("button", { name: "平移" });
  await expect(pan).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(pan).toHaveAttribute("aria-pressed", "true");
  const focusOutline = await pan.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      style: style.outlineStyle,
      width: Number.parseFloat(style.outlineWidth),
    };
  });
  expect(focusOutline.style).not.toBe("none");
  expect(focusOutline.width).toBeGreaterThanOrEqual(2);
  await pan.hover();
  await expect(page.getByRole("tooltip")).toHaveText("平移");

  const transitionMilliseconds = await page
    .getByTestId("canvas-tool-rail")
    .evaluate((element) => {
      const value = getComputedStyle(element).transitionDuration;
      return value.endsWith("ms")
        ? Number.parseFloat(value)
        : Number.parseFloat(value) * 1_000;
    });
  expect(transitionMilliseconds).toBeLessThanOrEqual(0.01);
});

test("真实 WebGL context loss 暂停交互，恢复后重画并继续编辑", async ({
  page,
}) => {
  await createSquareProject(page, "上下文恢复");
  await page.getByRole("button", { name: "画刷" }).click();
  const canvas = page.getByLabel("地图编辑画布");
  const extensionAvailable = await canvas.evaluate((element) => {
    const canvasElement = element as HTMLCanvasElement;
    const gl =
      canvasElement.getContext("webgl2") ?? canvasElement.getContext("webgl");
    const extension = gl?.getExtension("WEBGL_lose_context");
    if (extension === null || extension === undefined) return false;
    (
      window as Window & {
        __tesseraRestoreContext?: () => void;
      }
    ).__tesseraRestoreContext = () => extension.restoreContext();
    extension.loseContext();
    return true;
  });
  expect(extensionAvailable).toBe(true);
  await expect(page.getByTestId("renderer-context-lost")).toBeVisible();
  await expect(canvas).toHaveAttribute("aria-disabled", "true");

  await canvas.click({ position: { x: 500, y: 300 }, force: true });
  await expect(page.getByTestId("cell-count")).toContainText("0");

  await page.evaluate(() => {
    (
      window as Window & {
        __tesseraRestoreContext?: () => void;
      }
    ).__tesseraRestoreContext?.();
  });
  await expect(page.getByTestId("renderer-context-lost")).toBeHidden();
  await expect(canvas).toHaveAttribute("data-renderer-status", "available");
  await canvas.click({ position: { x: 500, y: 300 } });
  await expect(page.getByTestId("cell-count")).toContainText("1");
});
