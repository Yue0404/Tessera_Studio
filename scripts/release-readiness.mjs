import { createHash } from "node:crypto";

const REQUIREMENT_ID = /^[A-Z][A-Z0-9]*-[0-9]{3}$/u;

function traceEntries(trace) {
  return [
    ...(Array.isArray(trace?.entries) ? trace.entries : []),
    ...(Array.isArray(trace?.trackedP1Evidence) ? trace.trackedP1Evidence : []),
  ];
}

/** 正式发布只接受有身份、时间和理由的显式 blocker 决策。 */
export function validateReleaseAcceptanceDocument(document) {
  const issues = [];
  if (document?.schemaVersion !== "1") {
    issues.push("正式发布接受清单/schemaVersion 必须为 1");
  }
  if (!Array.isArray(document?.acceptedBlockers)) {
    issues.push("正式发布接受清单缺少 acceptedBlockers 数组");
    return issues;
  }
  const ids = new Set();
  for (const [index, item] of document.acceptedBlockers.entries()) {
    const path = `acceptedBlockers[${index}]`;
    if (!REQUIREMENT_ID.test(item?.requirementId ?? "")) {
      issues.push(`${path}.requirementId 无效`);
    } else if (ids.has(item.requirementId)) {
      issues.push(`${path}.requirementId 重复：${item.requirementId}`);
    } else {
      ids.add(item.requirementId);
    }
    for (const field of ["reason", "acceptedBy", "acceptedAt"]) {
      if (
        typeof item?.[field] !== "string" ||
        item[field].trim().length === 0
      ) {
        issues.push(`${path}.${field} 必须是非空字符串`);
      }
    }
    if (
      typeof item?.acceptedAt === "string" &&
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(
        item.acceptedAt,
      )
    ) {
      issues.push(`${path}.acceptedAt 必须是 UTC ISO 8601 时间`);
    }
  }
  return issues;
}

/** 纯校验函数由单元测试注入文件系统事实，避免测试依赖当前发布文档。 */
export function validateReleaseReadiness({
  trace,
  acceptance,
  hasRootLicense,
  releaseCatalog,
}) {
  const issues = [...validateReleaseAcceptanceDocument(acceptance)];
  const blockedIds = new Set(
    traceEntries(trace)
      .filter((entry) => entry?.status === "blocked")
      .flatMap((entry) => entry.requirementIds ?? []),
  );
  const acceptedIds = new Set(
    Array.isArray(acceptance?.acceptedBlockers)
      ? acceptance.acceptedBlockers.map((item) => item?.requirementId)
      : [],
  );

  for (const id of [...acceptedIds].filter(Boolean).sort()) {
    if (!blockedIds.has(id)) {
      issues.push(`正式发布接受清单引用了非 blocked 需求：${id}`);
    }
  }
  for (const id of [...blockedIds].sort()) {
    if (!acceptedIds.has(id)) {
      issues.push(`正式发布仍有未接受的需求阻塞：${id}`);
    }
  }
  if (!hasRootLicense) {
    issues.push(
      "正式发布缺少根级项目许可证；THIRD_PARTY_NOTICES.md 不能替代项目授权。",
    );
  }
  if (!Array.isArray(releaseCatalog?.releases)) {
    issues.push("正式发布缺少有效的提取器 release catalog。");
  } else if (releaseCatalog.releases.length === 0) {
    issues.push(
      "正式发布的提取器 release catalog 为空；请先发布真实资产并回填 URL、体积和 SHA-256。",
    );
  }
  return issues;
}

/** 正式放行只读取 Release 字节核对体积和 SHA-256，不写盘也不执行资产。 */
export async function verifyExtractorReleaseAssets(
  releaseCatalog,
  fetcher = globalThis.fetch,
) {
  const issues = [];
  for (const release of releaseCatalog.releases) {
    let response;
    try {
      response = await fetcher(release.assetUrl, {
        method: "GET",
        credentials: "omit",
        redirect: "follow",
      });
    } catch {
      issues.push(`无法下载正式提取器 Release：${release.assetUrl}`);
      continue;
    }
    if (!response.ok || response.body === null) {
      issues.push(
        `正式提取器 Release 不可用：${release.assetUrl}（HTTP ${response.status}）`,
      );
      continue;
    }

    const hash = createHash("sha256");
    const reader = response.body.getReader();
    let bytes = 0;
    let tooLarge = false;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > release.bytes) {
          tooLarge = true;
          await reader.cancel();
          break;
        }
        hash.update(next.value);
      }
    } catch {
      issues.push(`读取正式提取器 Release 失败：${release.assetUrl}`);
      continue;
    } finally {
      reader.releaseLock();
    }
    if (tooLarge || bytes !== release.bytes) {
      const actual = tooLarge ? "超过声明值" : String(bytes);
      issues.push(
        `正式提取器 Release 体积不匹配：${release.assetUrl}（期望 ${release.bytes}，实际 ${actual}）`,
      );
      continue;
    }
    const actualSha256 = hash.digest("hex");
    if (actualSha256 !== release.sha256) {
      issues.push(`正式提取器 Release SHA-256 不匹配：${release.assetUrl}`);
    }
  }
  return issues;
}
