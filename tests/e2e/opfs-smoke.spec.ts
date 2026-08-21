import { expect, test } from "@playwright/test";

interface OpfsSmokeModule {
  stageAndCommit(commitId: string): Promise<number>;
  reopenAndRead(
    commitId: string,
  ): Promise<Readonly<{ committed: boolean; bytes: readonly number[] }>>;
  deleteAndList(commitId: string): Promise<readonly string[]>;
}

test("Chromium OPFS 流式写入、刷新读取与递归清理 smoke", async ({ page }) => {
  await page.goto("/");
  const commitId = crypto.randomUUID();
  const stagedBytes = await page.evaluate(async (id) => {
    const module =
      (await import("/src/opfs-browser-smoke-harness.ts")) as OpfsSmokeModule;
    return module.stageAndCommit(id);
  }, commitId);
  expect(stagedBytes).toBe(4);

  await page.reload();
  const reopened = await page.evaluate(async (id) => {
    const module =
      (await import("/src/opfs-browser-smoke-harness.ts")) as OpfsSmokeModule;
    return module.reopenAndRead(id);
  }, commitId);
  expect(reopened).toEqual({ committed: true, bytes: [1, 2, 3, 4] });

  const remaining = await page.evaluate(async (id) => {
    const module =
      (await import("/src/opfs-browser-smoke-harness.ts")) as OpfsSmokeModule;
    return module.deleteAndList(id);
  }, commitId);
  expect(remaining).not.toContain(commitId);
});
