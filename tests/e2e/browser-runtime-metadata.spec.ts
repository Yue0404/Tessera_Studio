import { expect, test } from "@playwright/test";

test("记录真实浏览器运行时身份", async ({ browser, browserName }) => {
  const metadata = {
    browserName,
    browserVersion: browser.version(),
  };
  console.log(`[tessera-browser-metadata]${JSON.stringify(metadata)}`);
  expect(metadata.browserVersion).toMatch(/^\d+(?:\.\d+)+$/u);
});
