import { expect, test } from "@playwright/test";

interface StorageSmokeModule {
  saveTwoProjectsInChromium(
    databaseName: string,
  ): Promise<
    | { readonly ok: true; readonly latestName: string | null }
    | { readonly ok: false; readonly error: unknown }
  >;
  closedRepositoryErrorInChromium(databaseName: string): Promise<unknown>;
}

test("Chromium IndexedDB 连续保存按本地激活顺序恢复最后工程", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async (databaseName) => {
    const module =
      (await import("/src/storage-browser-smoke-harness.ts")) as StorageSmokeModule;
    return module.saveTwoProjectsInChromium(databaseName);
  }, `storage-smoke-${crypto.randomUUID()}`);
  expect(result).toEqual({ ok: true, latestName: "旧文档后保存" });
});

test("Chromium smoke 保留关闭连接保存失败的完整 cause 链", async ({ page }) => {
  await page.goto("/");
  const error = await page.evaluate(async (databaseName) => {
    const module =
      (await import("/src/storage-browser-smoke-harness.ts")) as StorageSmokeModule;
    return module.closedRepositoryErrorInChromium(databaseName);
  }, `storage-closed-${crypto.randomUUID()}`);
  expect(error).toMatchObject({
    name: "StorageRepositoryError",
    code: "project-save-failed",
    cause: { name: "DatabaseClosedError" },
  });
});

test("App StrictMode 初次保存无 unhandled rejection", async ({ page }) => {
  await page.addInitScript(() => {
    const errors: unknown[] = [];
    Object.defineProperty(window, "__storageUnhandled", { value: errors });
    window.addEventListener("unhandledrejection", (event) => {
      const serialize = (error: any, depth = 0): unknown =>
        depth >= 5 || error === null || typeof error !== "object"
          ? String(error)
          : {
              name: error.name ?? null,
              message: error.message ?? null,
              code: error.code ?? null,
              details: error.details ?? null,
              cause:
                error.cause === undefined
                  ? null
                  : serialize(error.cause, depth + 1),
            };
      errors.push(serialize(event.reason));
    });
  });
  await page.goto("/");
  await page.getByLabel("工程名称").fill("Storage cause 诊断");
  await page.getByRole("button", { name: "创建工程" }).click();
  await page.waitForTimeout(500);
  const errors = await page.evaluate(
    () =>
      (window as typeof window & { __storageUnhandled: unknown[] })
        .__storageUnhandled,
  );
  expect(errors).toEqual([]);
  await expect(page.getByTestId("save-status")).toHaveText("已保存");
});
