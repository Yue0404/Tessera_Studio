const OBSOLETE_LICENSE_STATEMENTS = [
  "仓库当前没有根级项目许可证",
  "仓库尚无根级项目许可证",
  "did not contain a repository-level LICENSE",
];

const REQUIRED_LICENSE_STATEMENTS = {
  README: [
    "除另有说明外，Tessera Studio 自有代码和自有资产依据根目录的 [PolyForm Noncommercial License 1.0.0](LICENSE) 提供，并附带 `Required Notice: Copyright 2026 Yue0404`。",
    "该许可证不覆盖第三方依赖或第三方资产，也不对用户在本地生成或导入的 `tessera.civ6` 游戏资产重新授权；相关权利仍由各自权利人和适用条款决定",
  ],
  "Release 说明": [
    "根目录 `LICENSE` 采用官方未修改的 PolyForm Noncommercial License 1.0.0，并包含 `Required Notice: Copyright 2026 Yue0404`。",
    "该许可证仅覆盖 Tessera Studio 自有代码和自有资产；第三方依赖、第三方资产、Civilization VI 游戏资产和用户在本地生成或导入的 `tessera.civ6` 模块不因此获得重新授权。",
  ],
  提取器许可说明: [
    "The repository root LICENSE applies to the extractor's Tessera Studio-owned source code under the official, unmodified PolyForm Noncommercial License 1.0.0.",
    "Required Notice: Copyright 2026 Yue0404",
    "The repository license covers only Tessera Studio-owned code and assets.",
    "The bundled .NET runtime and its third-party components remain under the license terms included separately as DOTNET-LICENSE.txt and DOTNET-THIRD-PARTY-NOTICES.txt.",
    "Civilization VI game assets and locally generated or imported tessera.civ6 modules are not covered or relicensed by the repository license.",
  ],
};

/** 验证发布文档准确陈述项目授权范围，避免以零散关键词冒充完整授权边界。 */
export function validateReleaseLicenseStatements({
  readme,
  releaseNotes,
  extractorNotice,
}) {
  const documents = [
    ["README", readme],
    ["Release 说明", releaseNotes],
    ["提取器许可说明", extractorNotice],
  ];
  const issues = [];

  for (const [name, content] of documents) {
    for (const obsolete of OBSOLETE_LICENSE_STATEMENTS) {
      if (content.includes(obsolete)) {
        issues.push(`${name} 仍含过时的无许可证声明：${obsolete}`);
      }
    }
    for (const required of REQUIRED_LICENSE_STATEMENTS[name]) {
      if (!content.includes(required)) {
        issues.push(`${name} 缺少准确的授权边界：${required}`);
      }
    }
  }

  return issues;
}
