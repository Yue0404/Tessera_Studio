# 需求追踪矩阵

机器可读事实位于 [requirements-traceability.json](requirements-traceability.json)，由 `pnpm release:check` 校验。

## 状态含义

- `covered`：已有实现和自动测试指针，但仍需以当前候选的完整门禁结果确认；
- `conditional`：只在安装可选包、具备外部软件或真实 Release 时验收，不阻塞无包核心网站；
- `blocked`：发布前仍有明确未闭合证据，必须关联 Issue 并说明原因。

`covered` 不等于“已发布”或“人工验收通过”。检查器保证权威 P0 快照中的每个 ID 恰好出现一次、引用的仓库路径存在、conditional/blocked 项具有原因和外部追踪入口。

## 当前汇总

| 范围                                                                             | 状态        | 主要证据                                                                                                                                                          |
| -------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 创建、几何、编辑、图层、历史                                                     | covered     | core/renderer/web 单元测试与 vertical-slice E2E                                                                                                                   |
| 保存、Project、Fragment                                                          | covered     | formats/storage 测试与真实浏览器下载、载入、刷新恢复                                                                                                              |
| PNG/SVG                                                                          | covered     | visual-export 单元测试及 Chromium/Edge 真 Blob 验证                                                                                                               |
| 通用模块包                                                                       | covered     | module-runtime、OPFS、Worker、真实浏览器导入                                                                                                                      |
| Civilization VI                                                                  | conditional | 真实安装已验证 209 元素/114 资源；CIV-009 有 DomainGroup 直接实现、测试和生产 E2E；Win11 25H2 x64 自包含 GUI 实机已闭合；Issue #14 仅继续跟踪正式 Release/catalog |
| VIEW-008                                                                         | covered     | 真实分块 P95、缺帧、接缝与跨块淘汰回归                                                                                                                            |
| 最大地图内存与跨块稳定                                                           | covered     | 强制 GC、LRU 饱和及线/箭头/覆盖物往返                                                                                                                             |
| PERF-010 参考档性能                                                              | blocked     | Issue #12；当前实机不等同冻结参考硬件                                                                                                                             |
| PERF-002 视口操作延迟                                                            | blocked     | 当前 1440×900、DPR=1 数据通过，但仍须在 PERF-010 冻结参考硬件闭合                                                                                                 |
| 当前及前一主要浏览器版本                                                         | blocked     | Issue #12；Chrome/Firefox 已闭合，Edge 前一版缺少安全并行运行证据                                                                                                 |
| 可选 Civ6 提取器 Windows 11 24H2+ x64 实机                                       | covered     | Win11 专业工作站版 25H2 x64 build 26200.9168、无系统 dotnet、自包含 GUI 与 ZIP 闭包审计；见 Windows 目标机证据                                                    |
| P1：EDIT-002、LINK-007、MOD-008、LAYER-004、DATA-006、EXPORT-006、UX-006、UX-007 | covered     | 直接实现、模型/格式边界测试、浏览器 E2E 与 2026-08-24 人工视觉证据                                                                                                |
| A11Y-001～A11Y-004                                                               | covered     | browser-safety-a11y 自动化与 2026-08-24 人工视觉层级、非纯颜色状态线索证据                                                                                        |
| 项目许可证                                                                       | blocked     | 仓库所有者尚未作出授权决定                                                                                                                                        |

## 更新规则

1. 权威本地需求文档增加或改变 P0 ID 时，同一提交更新机器快照和证据映射；
2. 不允许用一个不存在的路径、测试目录名或口头“已通过”作为证据；
3. 条件能力必须写明触发条件；延期必须写明 Issue；
4. GitHub Actions run、浏览器版本和人工截图记录在视觉台账或 PR 评论，不把易变 run ID 写成实现事实；
5. 正式 Release 前，所有 P0 必须是 covered/conditional，或由产品所有者明确接受 blocked 项。
