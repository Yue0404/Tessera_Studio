# 需求追踪矩阵

机器可读事实位于 [requirements-traceability.json](requirements-traceability.json)，由 `pnpm release:check` 校验。

## 状态含义

- `covered`：已有实现和自动测试指针，但仍需以当前候选的完整门禁结果确认；
- `conditional`：只在安装可选包、具备外部软件或真实 Release 时验收，不阻塞无包核心网站；
- `blocked`：发布前仍有明确未闭合证据，必须关联 Issue 并说明原因。

`covered` 不等于“已发布”或“人工验收通过”。检查器保证权威 P0 快照中的每个 ID 恰好出现一次、引用的仓库路径存在、conditional/blocked 项具有原因和外部追踪入口。

## 当前汇总

| 范围                         | 状态        | 主要证据                                             |
| ---------------------------- | ----------- | ---------------------------------------------------- |
| 创建、几何、编辑、图层、历史 | covered     | core/renderer/web 单元测试与 vertical-slice E2E      |
| 保存、Project、Fragment      | covered     | formats/storage 测试与真实浏览器下载、载入、刷新恢复 |
| PNG/SVG                      | covered     | visual-export 单元测试及 Chromium/Edge 真 Blob 验证  |
| 通用模块包                   | covered     | module-runtime、OPFS、Worker、真实浏览器导入         |
| Civilization VI              | conditional | Issue #14；无包时核心网站必须独立通过                |
| VIEW-008 与发布性能          | blocked     | Issue #12；正式 P50/P95、缺帧、内存证据未闭合        |
| 当前及前一主要浏览器版本     | blocked     | Issue #12；当前版本有证据，前一主要版本不全          |
| 普通 Windows 10 22H2         | blocked     | Microsoft 支持口径与当前 build-only 守卫冲突         |
| 项目许可证                   | blocked     | 仓库所有者尚未作出授权决定                           |

## 更新规则

1. 权威本地需求文档增加或改变 P0 ID 时，同一提交更新机器快照和证据映射；
2. 不允许用一个不存在的路径、测试目录名或口头“已通过”作为证据；
3. 条件能力必须写明触发条件；延期必须写明 Issue；
4. GitHub Actions run、浏览器版本和人工截图记录在视觉台账或 PR 评论，不把易变 run ID 写成实现事实；
5. 正式 Release 前，所有 P0 必须是 covered/conditional，或由产品所有者明确接受 blocked 项。
