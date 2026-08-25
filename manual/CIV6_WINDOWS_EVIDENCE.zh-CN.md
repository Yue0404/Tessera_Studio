# Civilization VI 提取器 Windows 目标机证据

本文记录当前提交 `0700b2668fc8f3a098a7ab999b46270189ce426d` 的本机重建与自包含 GUI 冒烟结果。它闭合 Windows 11 24H2+ x64 目标机证据，但不是正式 GitHub Release，也不替代下载目录回填。

## 环境与支持边界

- 操作系统：Windows 11 专业工作站版 25H2 x64，build `26200.9168`；
- Module Format 最低要求：Windows 11 24H2+ x64，build `26100+`；
- 系统环境没有安装或暴露 `dotnet`；
- 构建时只在任务专用临时目录安装 .NET SDK `10.0.400` 便携版，并以 Microsoft 发布的 SHA-512 校验值逐字节验证；
- Microsoft 的 [Windows 11 release information](https://learn.microsoft.com/en-us/windows/release-health/windows11-release-information) 将 25H2 对应到 build 26200、24H2 对应到 build 26100；[.NET 10 supported OS](https://github.com/dotnet/core/blob/main/release-notes/10.0/supported-os.md) 列出 Windows 11 25H2/24H2 x64。当前机器因此满足正式支持下限。

## 重建与测试结果

- Core 测试：94/94 通过；
- GUI 测试：31/31 通过；
- 正式发布脚本的 GUI smoke 通过；
- 生成的自包含 ZIP 为 51,560,363 bytes；
- ZIP SHA-256：`35a465c7470d040dc32b12271b9667037af62e5a83efa8975d09efc012b66d30`；
- ZIP 共 276 个条目，路径规范、确定顺序、运行闭包、禁止游戏资产和禁止绝对路径审计全部通过；
- 解压后的自包含 `TesseraCiv6Extractor.exe` 在系统无 `dotnet` 条件下创建标题为“密铺地图工坊 · 文明 6 资源提取器”的主窗口，并正常退出。

## 发布边界与清理

- 以上结果是当前提交的本机重建证据，不是已发布资产；
- 两次 GitHub Actions Windows 工作流运行成功，但当时没有上传 artifact，不能据此声称已有可下载 Release；
- 本文的本机结果不替代发布验证；正式提取器已由 [GitHub Actions 运行 32758198853](https://github.com/Yue0404/Tessera_Studio/actions/runs/32758198853) 独立发布为 [`extractor-v0.1.0-preview.1`](https://github.com/Yue0404/Tessera_Studio/releases/tag/extractor-v0.1.0-preview.1)，真实下载 catalog 的 URL、体积和 SHA-256 由该工作流输出回填；
- 临时 SDK、安装脚本、构建候选、解压目录及其他任务临时产物均已清理，没有留下提取器 ZIP、游戏资产或生成模块包。
