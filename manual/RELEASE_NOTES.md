# 发布候选说明

## 当前候选范围

M6 发布候选覆盖：

- 正方形与尖顶正六边形编辑；
- 固定模块图层、共享边、连接线、文字和标记；
- 撤销/重做、本地自动保存与刷新恢复；
- full/partial Project、Fragment、PNG、SVG；
- 通用模块/预设包安装和只读缺失占位；
- 可选 Civilization VI 本地模块工作流；
- PC 桌面 Chrome、Edge、Firefox 自动化证据；
- 纯静态 GitHub Pages 制品。

## 发布状态与已知阻塞

- 核心静态网站仍面向 Windows 10+ 的支持矩阵内现代浏览器；仅可选 Civ6 提取器不承诺普通 Windows 10 22H2，正式支持目标为 Windows 11 24H2+ x64。当前提交已在 Windows 11 专业工作站版 25H2 x64（build 26200.9168）闭合无系统 `dotnet` 的自包含 GUI 目标机证据。
- VIEW-008、最大地图内存、跨块稳定、当前浏览器、Chrome/Firefox 前一主版本与无障碍自动/人工证据已闭合。COMPAT-001、PERF-001、PERF-002、PERF-010 仍为 blocked；Edge 150/151 最终有界 A/B 的失败跨版本与轮次漂移，不能归因于 Edge 150。仓库所有者已在 `manual/release-acceptance.json` 接受这四项证据延期的发布风险，不等于将其标为 covered。
- 可选 Civilization VI 提取器已由 GitHub Actions 运行 `32758198853` 发布为 `extractor-v0.1.0-preview.1`；受跟踪目录直接采用工作流输出的 URL、`51560434` 字节和 SHA-256 `e57bbd5fabe7971526057450a519e5f371325fea6041edeace919be199f30ad2`，正式门禁会再次只读下载并逐字节复核。
- 八项 P1（EDIT-002、LINK-007、MOD-008、LAYER-004、DATA-006、EXPORT-006、UX-006、UX-007）已有直接实现、自动化边界及 2026-08-24 人工视觉证据。
- A11Y-001～A11Y-004 已由 browser-safety-a11y 自动化和 2026-08-24 人工视觉层级、非纯颜色状态线索复核共同闭合。
- M4-C1 的内部修订 gzip Blob 持久化不在本候选范围。

## 制品边界

网站 Pages 制品不得包含测试 harness、本地工程、扩展包、游戏资源或提取器。提取器 Release 与网站静态制品独立发布；外层 Release ZIP 才记录 SHA-256，工程格式和模块内容不使用无意义内容哈希。

## 授权边界

根目录 `LICENSE` 采用官方未修改的 PolyForm Noncommercial License 1.0.0，并包含 `Required Notice: Copyright 2026 Yue0404`。

该许可证仅覆盖 Tessera Studio 自有代码和自有资产；第三方依赖、第三方资产、Civilization VI 游戏资产和用户在本地生成或导入的 `tessera.civ6` 模块不因此获得重新授权。

## 发布后动作

只有合并后的干净提交通过全部 CI，才可部署正式 Pages。提取器 Release 已与网站静态制品独立发布；`apps/web/public/extractor-releases.json` 的真实条目随本候选进入 Pages，并由 `pnpm release:ready` 在部署前重新下载核对体积和 SHA-256。
