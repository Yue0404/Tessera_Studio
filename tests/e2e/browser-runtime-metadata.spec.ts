import { expect, test } from "@playwright/test";

test("记录真实浏览器运行时身份", async ({ browser, browserName }) => {
  const metadata = {
    browserName,
    browserVersion: browser.version(),
  };
  console.log(`[tessera-browser-metadata]${JSON.stringify(metadata)}`);
  // Firefox 官方 beta 构建会返回 152.0b1；保留数字主版本约束并允许标准预发布后缀。
  expect(metadata.browserVersion).toMatch(/^\d+(?:\.\d+)+(?:[a-z]+\d*)?$/iu);
});
