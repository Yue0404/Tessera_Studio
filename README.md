# 密铺地图工坊（Tessera Studio）

密铺地图工坊是一款面向 PC 桌面浏览器的本地优先密铺地图编辑器。当前版本支持正方形与尖顶正六边形有限地图，提供图层、共享边、连接线、文字与标记、撤销/重做、本地自动保存，以及 Project、Fragment、PNG、SVG 导入导出。

网站没有账号和云端存储。工程默认保存在当前浏览器站点数据中；需要跨设备、长期保存或防止浏览器数据被清理时，请定期下载完整 Tessera Project 文件。

## 本地开发

要求：

- Node.js 24.x；
- pnpm 11.4.0；
- PC 桌面端 Chrome、Edge 或 Firefox；当前版和前一个主要版本是发布测试目标，实时证据与未闭合项见[需求追踪矩阵](manual/REQUIREMENTS_TRACEABILITY.md)；
- 运行浏览器端到端测试前，按 Playwright 提示安装对应浏览器。

安装锁定依赖并启动开发服务器：

```shell
pnpm install --frozen-lockfile
pnpm dev
```

开发服务器默认地址为 `http://127.0.0.1:4173/`。

## 测试与生产构建

提交前运行完整门禁：

```shell
pnpm schema:check
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm e2e --workers=1
pnpm e2e:production
pnpm e2e:pages
pnpm release:check
```

Schema 生成文件由 `scripts/generate-project-validator.mjs` 维护；修改 Schema 后先运行 `pnpm schema:generate`，再运行 `pnpm schema:check`。

生产构建输出位于 `apps/web/dist/`。在 Windows PowerShell 或其他受支持终端中，可使用以下命令进行本地静态预览：

```shell
pnpm --filter @tessera/web exec vite preview --host 127.0.0.1 --port 4174
```

随后访问 `http://127.0.0.1:4174/`。该预览用于验证生产构建，不应作为公网服务器。

`pnpm release:verify` 会在依赖已锁定安装后串行执行发布候选门禁；它不会修改 GitHub Release、Pages 或本地工程数据。

`pnpm release:check` 只校验候选证据的结构与一致性，允许保留有明确原因的 `conditional`/`blocked`。显式接受 blocker 时，必须在 `manual/release-acceptance.json` 记录需求 ID、理由、接受人和 UTC 时间。

`pnpm release:ready` 是正式部署门禁：它拒绝未接受的 P0/P1 blocker、根级许可证缺失或空的提取器正式目录，并只读下载目录中的 GitHub Release 资产核对体积和 SHA-256；不会写盘或执行提取器。若 PERF-001、PERF-002 或 PERF-010 标为 `covered`，门禁还要求受跟踪的 `manual/benchmark-profile-v1.json` 严格匹配冻结硬件、固定场景及全部通过结果，并验证被测提交是当前 HEAD 的祖先且其后没有性能敏感源码变化。Pages 的 Pull Request 只运行候选检查，只有主分支正式上传前运行就绪检查。

`pnpm benchmark:browser --output local-modules/.review/browser-benchmark.json` 可在安装系统 Edge 的受支持 Windows 机器生成补充 profile；Windows CIM 采集失败、硬件不匹配或测试时工作树不干净时不能称为正式参考档。正式单一 profile 固定使用系统 Microsoft Edge（`browserChannel=msedge`），浏览器版本记录真实 `browser.version()`；是否扩展为多浏览器性能档仍由 Issue #12 的产品决定，工具不会擅自放宽或扩大范围。

## 使用与数据安全

- [用户手册](manual/USER_GUIDE.zh-CN.md)
- [备份与恢复](manual/BACKUP_AND_RECOVERY.zh-CN.md)
- [发布说明](manual/RELEASE_NOTES.md)
- [视觉证据台账](manual/VISUAL_EVIDENCE.md)
- [需求追踪矩阵](manual/REQUIREMENTS_TRACEABILITY.md)

最重要的备份步骤是：打开工程后选择“导出”→“数据导出”→“完整 Tessera Project”，并把 `.tessera-project.json` 文件保存在浏览器站点数据之外。载入或合并失败不会替换当前工程；详细恢复边界见备份与恢复说明。

## Civilization VI 可选包

`tessera.civ6` 不是网站必需组件。网站不会扫描游戏目录，也不包含游戏资产。用户可以在包设置中导入自己已有的 `tessera.civ6.tessera-module.zip`；提取器下载目录只有在真实 GitHub Release 发布并回填可验证的 HTTPS URL、体积和 SHA-256 后才会显示。

核心静态网站仍可在 Windows 10+ 部署并由支持矩阵内的现代浏览器使用。可选提取器当前基于 .NET 10，正式支持目标固定为 Windows 11 24H2+ x64；普通 Windows 10 22H2 不再是提取器产品支持目标。当前提交已在 Windows 11 专业工作站版 25H2 x64（build 26200.9168）完成无系统 `dotnet` 的自包含 GUI 实机复验，详见 [Windows 目标机证据](manual/CIV6_WINDOWS_EVIDENCE.zh-CN.md)；正式 Release 与真实下载 catalog 仍未闭合。

## 部署与授权边界

网站是纯静态应用，Pages 工作流在 Pull Request 中只构建和审计制品；仅正式目标分支的推送可以部署 GitHub Pages。

除另有说明外，Tessera Studio 自有代码和自有资产依据根目录的 [PolyForm Noncommercial License 1.0.0](LICENSE) 提供，并附带 `Required Notice: Copyright 2026 Yue0404`。该许可证不覆盖第三方依赖或第三方资产，也不对用户在本地生成或导入的 `tessera.civ6` 游戏资产重新授权；相关权利仍由各自权利人和适用条款决定，详见 [第三方组件说明](THIRD_PARTY_NOTICES.md)。
