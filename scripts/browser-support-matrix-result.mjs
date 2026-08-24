/** 从 Playwright 控制台提取由真实 browser.version() 产生的最后一条身份记录。 */
export function browserMetadataFrom(output) {
  const matches = [
    ...output.matchAll(/\[tessera-browser-metadata\](\{[^\r\n]+\})/gu),
  ];
  const last = matches.at(-1)?.[1];
  if (last === undefined) return { browserName: null, browserVersion: null };
  try {
    const value = JSON.parse(last);
    return {
      browserName:
        typeof value.browserName === "string" && value.browserName.length > 0
          ? value.browserName
          : null,
      browserVersion:
        typeof value.browserVersion === "string" &&
        value.browserVersion.length > 0
          ? value.browserVersion
          : null,
    };
  } catch {
    return { browserName: null, browserVersion: null };
  }
}

/** 退出码为零但缺少真实浏览器身份时也不得登记为通过。 */
export function classifyCompletedBrowserRun(exitCode, metadata) {
  if (exitCode !== 0) {
    return { status: "failed", reason: "test-exit-nonzero" };
  }
  if (metadata.browserName === null || metadata.browserVersion === null) {
    return { status: "failed", reason: "browser-metadata-missing" };
  }
  return { status: "passed" };
}
