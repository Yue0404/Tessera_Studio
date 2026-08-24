import {
  expect,
  test as base,
  type Browser,
  type Page,
} from "@playwright/test";
import { waitForEditorReady } from "../e2e/editor-ready.js";

const logPrefix = "[tessera-edge-diagnostic]";
const rejectionPrefix = "[tessera-edge-unhandledrejection]";

interface DiagnosticFacts {
  readonly browserVersion: string;
  readonly rendererStatus: string | null;
  readonly webglVendor: string | null;
  readonly webglRenderer: string | null;
}

interface Diagnostic {
  observe(page: Page): Promise<void>;
  recordFacts(page: Page, browser: Browser): Promise<void>;
}

const test = base.extend<{ diagnostic: Diagnostic }>({
  diagnostic: async ({ page }, runFixture, testInfo) => {
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    const unhandledRejections: string[] = [];
    const observedPages = new WeakSet<Page>();

    const observe = async (target: Page) => {
      if (observedPages.has(target)) return;
      observedPages.add(target);
      target.on("pageerror", (error) => pageErrors.push(error.message));
      target.on("console", (message) => {
        if (message.type() !== "error") return;
        const text = message.text();
        if (text.startsWith(rejectionPrefix)) {
          unhandledRejections.push(text.slice(rejectionPrefix.length));
        } else {
          consoleErrors.push(text);
        }
      });
      await target.addInitScript(
        ({ prefix }) => {
          window.addEventListener("unhandledrejection", (event) => {
            const reason =
              event.reason instanceof Error
                ? (event.reason.stack ?? event.reason.message)
                : String(event.reason);
            console.error(`${prefix}${reason}`);
          });
        },
        { prefix: rejectionPrefix },
      );
    };

    await observe(page);
    await runFixture({
      observe,
      recordFacts: async (target, browser) => {
        const facts = await target
          .getByLabel("地图编辑画布")
          .evaluate((element) => {
            const canvas = element as HTMLCanvasElement;
            const gl =
              canvas.getContext("webgl2") ?? canvas.getContext("webgl");
            const debug = gl?.getExtension("WEBGL_debug_renderer_info");
            return {
              rendererStatus: canvas.dataset.rendererStatus ?? null,
              webglVendor:
                gl === null
                  ? null
                  : String(
                      gl.getParameter(
                        debug?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR,
                      ),
                    ),
              webglRenderer:
                gl === null
                  ? null
                  : String(
                      gl.getParameter(
                        debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER,
                      ),
                    ),
            };
          });
        console.log(
          `${logPrefix}${JSON.stringify({
            kind: "facts",
            caseId: process.env.TESSERA_EDGE_DIAGNOSTIC_CASE ?? testInfo.title,
            label: process.env.TESSERA_EDGE_DIAGNOSTIC_LABEL ?? "unknown",
            browserVersion: browser.version(),
            ...facts,
          } satisfies DiagnosticFacts & {
            readonly kind: "facts";
            readonly caseId: string;
            readonly label: string;
          })}`,
        );
      },
    });

    const errors = {
      kind: "errors",
      caseId: process.env.TESSERA_EDGE_DIAGNOSTIC_CASE ?? testInfo.title,
      pageErrors,
      consoleErrors,
      unhandledRejections,
    };
    console.log(`${logPrefix}${JSON.stringify(errors)}`);
    expect(errors.pageErrors, "页面不得产生 pageerror").toEqual([]);
    expect(errors.consoleErrors, "页面不得产生 console.error").toEqual([]);
    expect(errors.unhandledRejections, "页面不得有未处理 Promise 拒绝").toEqual(
      [],
    );
  },
});

async function createSquareProject(
  page: Page,
  name: string,
  size = 20,
): Promise<void> {
  await page.goto("/");
  await page.getByLabel("工程名称").fill(name);
  await page.getByText("正方形", { exact: true }).click();
  await page.getByLabel("宽度").fill(String(size));
  await page.getByLabel("高度").fill(String(size));
  await page.getByRole("button", { name: "创建工程" }).click();
  await waitForEditorReady(page);
}

test("[edge-diag:baseline] 编辑器与 WebGL 基线可用", async ({
  page,
  browser,
  diagnostic,
}) => {
  await createSquareProject(page, "Edge 诊断基线");
  await expect(page.getByLabel("地图编辑画布")).toHaveAttribute(
    "data-renderer-status",
    "available",
  );
  await diagnostic.recordFacts(page, browser);
});

test("[edge-diag:data-workflow] Project 下载后可在新上下文导入", async ({
  page,
  browser,
  diagnostic,
}, testInfo) => {
  await createSquareProject(page, "Edge 数据工作流");
  await page.getByRole("button", { name: "画刷" }).click();
  await page.getByLabel("地图编辑画布").click({
    position: { x: 500, y: 300 },
  });
  await expect(page.getByTestId("cell-count")).toContainText("1");

  await page.getByRole("button", { name: "导出" }).click();
  await page.getByRole("button", { name: "数据导出" }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "生成并下载" }).click();
  const download = await downloading;
  // 显式复制到本测试自己的输出目录，避免跨 context 借用 Playwright artifact 临时路径。
  const downloadPath = testInfo.outputPath("edge-diagnostic-project.json");
  await download.saveAs(downloadPath);

  const context = await browser.newContext();
  try {
    const importedPage = await context.newPage();
    await diagnostic.observe(importedPage);
    await importedPage.goto("/");
    await importedPage
      .locator('input[accept=".tessera-project.json"]')
      .setInputFiles(downloadPath);
    await waitForEditorReady(importedPage);
    await expect(importedPage.getByTestId("cell-count")).toContainText("1");
  } finally {
    await context.close();
  }
  await diagnostic.recordFacts(page, browser);
});

test("[edge-diag:zoom-hit] 25% 与 400% 下命中同一内容格", async ({
  page,
  browser,
  diagnostic,
}) => {
  await createSquareProject(page, "Edge 缩放命中", 400);
  const canvas = page.getByLabel("地图编辑画布");
  await page.getByRole("button", { name: "画刷" }).click();
  await canvas.click({ position: { x: 700, y: 360 } });
  await expect(page.getByTestId("cell-count")).toContainText("1");
  await canvas.hover({ position: { x: 700, y: 360 } });
  await page.mouse.wheel(0, -10_000);
  await expect(page.getByTestId("zoom-level")).toHaveText("缩放 400%");
  await canvas.click({ position: { x: 700, y: 360 } });
  await expect(page.getByTestId("cell-count")).toContainText("1");
  await page.mouse.wheel(0, 10_000);
  await expect(page.getByTestId("zoom-level")).toHaveText("缩放 25%");
  await canvas.click({ position: { x: 700, y: 360 } });
  await expect(page.getByTestId("cell-count")).toContainText("1");
  await diagnostic.recordFacts(page, browser);
});

test("[edge-diag:vertical-slice] 编辑撤销重做并刷新恢复", async ({
  page,
  browser,
  diagnostic,
}) => {
  await createSquareProject(page, "Edge 垂直切片");
  const canvas = page.getByLabel("地图编辑画布");
  await page.getByRole("button", { name: "画刷" }).click();
  await canvas.click({ position: { x: 500, y: 300 } });
  await expect(page.getByTestId("cell-count")).toContainText("1");
  await page.getByRole("button", { name: "撤销" }).click();
  await expect(page.getByTestId("cell-count")).toContainText("0");
  await page.getByRole("button", { name: "重做" }).click();
  await expect(page.getByTestId("cell-count")).toContainText("1");
  await expect(page.getByTestId("save-status")).toHaveText("已保存");
  await page.reload();
  await waitForEditorReady(page);
  await expect(page.getByTestId("cell-count")).toContainText("1");
  await diagnostic.recordFacts(page, browser);
});

test("[edge-diag:visual-export] Worker 生成真实 PNG", async ({
  page,
  browser,
  diagnostic,
}) => {
  await createSquareProject(page, "Edge 视觉导出");
  const result = await page.evaluate(async () => {
    const module =
      (await import("/src/visual-export-browser-smoke-harness.ts")) as {
        renderSquarePngSmoke(
          forceFallback: boolean,
          background: "transparent" | "color",
        ): Promise<{
          readonly blobType: string;
          readonly blobSize: number;
          readonly executionMode: string;
          readonly signature: readonly number[];
        }>;
      };
    return module.renderSquarePngSmoke(false, "transparent");
  });
  expect(result.blobType).toBe("image/png");
  expect(result.blobSize).toBeGreaterThan(100);
  expect(result.executionMode).toBe("worker");
  expect(result.signature).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  await diagnostic.recordFacts(page, browser);
});

test("[edge-diag:context-loss] WebGL 丢失恢复后继续编辑", async ({
  page,
  browser,
  diagnostic,
}) => {
  await createSquareProject(page, "Edge 上下文恢复");
  await page.getByRole("button", { name: "画刷" }).click();
  const canvas = page.getByLabel("地图编辑画布");
  const extensionAvailable = await canvas.evaluate((element) => {
    const target = element as HTMLCanvasElement;
    const gl = target.getContext("webgl2") ?? target.getContext("webgl");
    const extension = gl?.getExtension("WEBGL_lose_context");
    if (extension === null || extension === undefined) return false;
    (
      window as Window & { __tesseraRestoreContext?: () => void }
    ).__tesseraRestoreContext = () => extension.restoreContext();
    extension.loseContext();
    return true;
  });
  expect(extensionAvailable).toBe(true);
  await expect(page.getByTestId("renderer-context-lost")).toBeVisible();
  await page.evaluate(() => {
    (
      window as Window & { __tesseraRestoreContext?: () => void }
    ).__tesseraRestoreContext?.();
  });
  await expect(page.getByTestId("renderer-context-lost")).toBeHidden();
  await canvas.click({ position: { x: 500, y: 300 } });
  await expect(page.getByTestId("cell-count")).toContainText("1");
  await diagnostic.recordFacts(page, browser);
});
