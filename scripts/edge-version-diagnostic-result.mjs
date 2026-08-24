export const DIAGNOSTIC_PREFIX = "[tessera-edge-diagnostic]";

/** 从 Playwright 文本日志提取稳定的结构化事实，避免依赖 reporter 的自然语言。 */
export function diagnosticMessagesFrom(output) {
  const messages = [];
  for (const line of output.split(/\r?\n/u)) {
    const index = line.indexOf(DIAGNOSTIC_PREFIX);
    if (index < 0) continue;
    const payload = line.slice(index + DIAGNOSTIC_PREFIX.length).trim();
    try {
      messages.push(JSON.parse(payload));
    } catch {
      // DEBUG 日志可能把其它内容拼在同一行；畸形记录由缺少事实契约判失败。
    }
  }
  return messages;
}

export function classifyDiagnosticRun({
  id,
  exitCode,
  durationMs,
  output,
  expectedBrowserVersion,
  expectedCaseCount = 1,
}) {
  const messages = diagnosticMessagesFrom(output);
  const facts = messages.filter((message) => message.kind === "facts");
  const errors = messages.filter((message) => message.kind === "errors");
  const reasons = [];
  if (exitCode !== 0) reasons.push(`playwright-exit-${exitCode}`);
  if (facts.length !== expectedCaseCount) reasons.push("facts-count-invalid");
  if (errors.length !== expectedCaseCount) reasons.push("errors-count-invalid");
  if (
    facts.some(
      (fact) =>
        fact.browserVersion !== expectedBrowserVersion ||
        fact.rendererStatus !== "available",
    )
  ) {
    reasons.push("runtime-identity-invalid");
  }
  if (
    errors.some(
      (entry) =>
        entry.pageErrors.length > 0 ||
        entry.consoleErrors.length > 0 ||
        entry.unhandledRejections.length > 0,
    )
  ) {
    reasons.push("page-errors-reported");
  }
  return {
    id,
    status: reasons.length === 0 ? "passed" : "failed",
    exitCode,
    durationMs,
    facts,
    errors,
    ...(reasons.length === 0 ? {} : { reason: reasons.join(",") }),
  };
}
