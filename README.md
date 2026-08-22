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

## 使用与数据安全

- [用户手册](manual/USER_GUIDE.zh-CN.md)
- [备份与恢复](manual/BACKUP_AND_RECOVERY.zh-CN.md)
- [发布说明](manual/RELEASE_NOTES.md)
- [视觉证据台账](manual/VISUAL_EVIDENCE.md)
- [需求追踪矩阵](manual/REQUIREMENTS_TRACEABILITY.md)

最重要的备份步骤是：打开工程后选择“导出”→“数据导出”→“完整 Tessera Project”，并把 `.tessera-project.json` 文件保存在浏览器站点数据之外。载入或合并失败不会替换当前工程；详细恢复边界见备份与恢复说明。

## Civilization VI 可选包

`tessera.civ6` 不是网站必需组件。网站不会扫描游戏目录，也不包含游戏资产。用户可以在包设置中导入自己已有的 `tessera.civ6.tessera-module.zip`；提取器下载目录只有在真实 GitHub Release 发布并回填可验证的 HTTPS URL、体积和 SHA-256 后才会显示。

提取器当前基于 .NET 10。仓库尚未把普通 Windows 10 22H2 声明为受 Microsoft 支持的平台；正式系统支持范围需要在发布前依据 Microsoft 当前支持政策单独确认。自动化发布构建运行于 Windows Server 2022，本机 Windows 11 构建 26200 只作为开发机实测证据，两者不互相替代。

## 部署与授权边界

网站是纯静态应用，Pages 工作流在 Pull Request 中只构建和审计制品；仅正式目标分支的推送可以部署 GitHub Pages。

仓库当前没有根级项目许可证。`THIRD_PARTY_NOTICES.md` 仅记录依赖许可证事实，不构成 Tessera Studio 自身的授权；项目许可证必须由仓库所有者在正式发布前决定。
