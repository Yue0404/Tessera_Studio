# M4-C 浏览器真实性能与稳定性证据

本文记录可复跑的候选证据。普通运行把 benchmark JSON 写入 Git 忽略目录，不把非参考机器结果冒充 PERF-010 参考档；只有严格匹配冻结环境的正式候选才可作为受跟踪的 `manual/benchmark-profile-v1.json` 进入发布门禁。

## 复跑入口

```powershell
pnpm benchmark:browser --output local-modules/.review/browser-benchmark.json
pnpm e2e --workers=1 tests/e2e/runtime-viewport-performance.spec.ts
pnpm support:matrix -- --output=local-modules/.review/browser-support.json
```

基准输出必须通过 [benchmark-profile-v1 schema](../tests/benchmarks/benchmark-profile-v1.schema.json)。性能 runner 使用生产构建、生产工程导入/恢复、生产 renderer 和真实填充 Worker；Windows 环境通过只读 CIM/PowerShell 采集 OS build、架构、物理/逻辑核心、机型与可用内存。runner 还以无 shell 的只读 Git 子进程记录 40 位被测提交和工作树清洁状态；正式门禁要求被测提交是当前 HEAD 的祖先，且两者之间没有整个 web 应用、core、renderer、storage、formats、module-runtime、benchmark/release runner 配置脚本及依赖锁文件变化。后续只提交 profile、追踪文档、许可证或 catalog 不会造成自引用阻塞。Schema 与正式发布语义门禁共同冻结 100×100/2,000 内容格、20 次冷启动、场景身份、样本和统计结果。

## 2026-08-23 实机环境

- OS：Windows `10.0.26200 x64`；
- CPU：Intel Core i9-12900H，20 个逻辑处理器；
- 可用内存：约 39.6 GB；
- 浏览器：系统 Microsoft Edge `151.0.4129.101`（`browserChannel=msedge`）；
- 视口：`1440×900`，DPR=1；
- headless 会话未提供可识别的硬件 GPU renderer，`hardwareAccelerated=false`；
- 与 PERF-010 的 4 核/8 线程、8 GiB 可用内存、硬件加速参考档不等价，因此 `comparable=false`。

## 正式 20 次冷启动

| 场景                                       |         P50 |         P95 | 门禁           |
| ------------------------------------------ | ----------: | ----------: | -------------- |
| 100×100、2,000 内容格 Project 导入至可交互 | 1,866.89 ms | 1,907.59 ms | P95 ≤ 3,000 ms |
| 同工程本地保存后刷新恢复至可交互           |   944.09 ms |   952.17 ms | P95 ≤ 3,000 ms |

这些数值证明当前实机路径通过，但不替代 PERF-001/010 的冻结参考硬件结果。

## 交互、分块与内存

- 25%、100%、400% 的平移/缩放样本 P05 FPS 均不低于 116.28，最长停顿 41.60 ms；
- 连续画刷 PointerEvent 至下一次 rAF 的 P95 为 19.00 ms；
- 40,000×40,000 稀疏工程长距离平移 P95 为 0.80 ms，缺帧 0；
- 运行时 LRU 在第 190 次长距离访问达到 256 个分块，继续 64 次后仍为 256；
- GPU batch 在饱和点为 83，后续 64 次最大仍为 83；
- Chromium CDP `HeapProfiler.collectGarbage` 在首次饱和与后续 64 次后分别采样。修复子 `GraphicsContext` 未释放后，三轮饱和后驻留堆增量为 19,286,248、19,771,229、19,803,402 字节；相对饱和前单位访问线性外推比为 0.07896、0.08103、0.08114，均低于 0.25 门禁；
- DPR=1 的真实 canvas 像素测量连续两轮均检测 194/194 个无遮挡、非水平交点采样行；半设备像素描边对齐后，Edge 的最大误差为 0 CSS px，Firefox 的最大误差为 0.05 CSS px，均不超过 0.5 CSS px；
- PERF-006 回归在跨 64×64 分块边界创建标记、线和箭头，访问至 LRU 淘汰后返回；连续两轮均发生原区域批次重建，领域计数不变，前后 canvas 解码 RGBA 逐像素精确一致，不比较可能受编码器影响的 PNG 压缩字节。

强制 GC 指标只适用于 Chromium/Edge；Firefox 通过缓存数量、状态和视觉回归验证，不宣称拥有等价 CDP 堆采样。

## 250,000 后台任务

生产 500×500 连通填充创建真实同源 Worker。测试保留真实进度消息、在最终结果发布前由生产 UI 取消并调用真实 `terminate`：

- 正式运行观测进度 29%；
- 取消可观察耗时 31.09 ms；
- 取消后工程对象数不变，没有部分提交。

## 当前浏览器与无障碍

支持矩阵的产品浏览器与 Playwright engine 分开记录；最终候选为 Edge 151 与 Firefox 153 增加到 40 项，其余已记录版本保留此前 39 项证据：

- 系统 Microsoft Edge `151.0.4129.101`：40/40；
- Google 官方 Chrome for Testing Stable `152.0.7977.54`：39/39；
- Google 官方 Chrome for Testing 上一主版本 `151.0.7922.138`：39/39；
- Playwright Firefox `153.0`：40/40；
- 与 Playwright 1.62.1 匹配的官方 Firefox Beta `152.0b1`（revision `1526`）：39/39；
- Playwright Chromium `151.0.7922.34`：39/39，仅作为 Chromium engine 补充证据，不冒充 Chrome 产品。

Chrome 版本来自 Google Chrome for Testing 的 `last-known-good-versions-with-downloads.json` 与 `known-good-versions-with-downloads.json`；Firefox 152 来自 Playwright 1.62.1 `browsers.json` 指向的官方 CDN 构建。Firefox 品牌版不能直接由 Playwright 的 patched Firefox 协议驱动，因此不把 Mozilla branded binary 冒充 Playwright Firefox 结果。最终复验环境没有可启动的系统 Chrome，属于浏览器能力在测试启动前不可用，不记为网页失败，也不把既有 Chrome for Testing 证据冒充为本轮系统 Chrome 结果。

矩阵覆盖新建、绘制、撤销、保存/刷新、Project/Fragment、包安装、Worker 填充、CSP、WebGL context lost/restored、axe WCAG 2.2 AA、键盘焦点、tooltip 与 reduced-motion。

Microsoft 官方 Edge Enterprise API 提供上一主版本 `150.0.4078.144` 的 x64 MSI。该 MSI 下载成功，`msiexec /a` 返回成功，但行政映像只生成重新打包的 MSI，没有可并行启动的 `msedge.exe`；内嵌载荷是 Edge Update Setup。为避免覆盖系统 Edge 或改变默认浏览器，本轮没有执行安装器，因此 Edge 150 保持 blocked。这一结论只说明当前安全自动化边界，不代表 Edge 150 产品不兼容。

首次隔离 Actions run [32693990026](https://github.com/Yue0404/Tessera_Studio/actions/runs/32693990026) 已在 GitHub-hosted `windows-2022` 一次性 VM 中按 Microsoft Enterprise API、冻结 SHA256 与 Authenticode 微软签名校验官方 MSI，并以 `ALLOWDOWNGRADE=1` 得到真实 `browser.version()=150.0.4078.144`。该轮完整矩阵为 21/40 通过、19 项超时；超时同时出现在 locator click、mouse、page.evaluate、download 与 teardown，且 Playwright 1.62.1 的官方测试范围是 Edge 151，因此这轮结果不足以把 Edge 150 标为 covered。

仓库现将 `.github/workflows/edge-previous-major.yml` 收窄为可复跑的同 runner A/B 诊断：先在原始 Edge 151、再在回滚后的 Edge 150 上逐进程运行相同六个代表场景，并以短的长生命周期 trace 哨兵区分浏览器版本、进程复用与 trace 因素。工作流记录精确文件版本、`browser.version()`、WebGL vendor/renderer、renderer 状态与页面错误，不上传 artifact；首次 A/B 结果仍待运行，COMPAT-001 阻塞保持不变。

首次 A/B run [32700237225](https://github.com/Yue0404/Tessera_Studio/actions/runs/32700237225) 的 Edge 151 独立用例为 5/6 通过，长生命周期哨兵 3/3 通过；`data-workflow` 在 Windows Server 2022 + SwiftShader 上耗尽 90 秒测试总时限，`setInputFiles` 因 test ended 被取消，期间 pageerror、console error 与 unhandled rejection 均为空。旧工作流随后错误继承 pnpm 非零退出码并跳过 Edge 150，汇总又因跨行 `>>` 触发 PowerShell `Missing file specification`；因此该 run 只证明 Edge 151 的其余代表路径，不构成版本 A/B 结论。诊断现将每用例测试总时限提高到 180 秒、单动作与导航仍限制为 30 秒，并确保两阶段完成身份检查后由最终汇总统一裁决；修订后的首次 A/B run 仍待执行，COMPAT-001 阻塞不变。

第二次 A/B run [32702840670](https://github.com/Yue0404/Tessera_Studio/actions/runs/32702840670) 已完整执行两个版本：Edge 151 与 Edge 150 的其余独立用例均为 5/5 通过，长生命周期哨兵均为 3/3 通过；两者唯一失败仍是 `data-workflow`。Edge 151 在 112.66 秒后失败于等待 `input[accept=".tessera-project.json"]` 的 30 秒动作上限，Edge 150 在 152.62 秒后失败于导入后等待地图画布可见的 30 秒上限；两侧 pageerror、console error 与 unhandled rejection 均为空。最后一次有界复测仅把该用例总时限设为 300 秒：设计隐藏的导入 input 只等待附着最多 90 秒，导入后的 loading 隐藏与地图画布可见各等待最多 90 秒；全局动作/导航 30 秒与 job 45 分钟门禁保持不变。若该次仍失败，则判定 GitHub-hosted Windows Server 2022 + SwiftShader 不适合作为此流程的验收环境，不再继续加时；COMPAT-001 仍不据此关闭。

可选 Civ6 提取器已在 Windows 11 专业工作站版 25H2 x64（build 26200.9168）完成无系统 `dotnet` 的自包含 GUI、ZIP 闭包和禁止资产审计；该结果满足 24H2+（build 26100+）目标机下限，完整记录见 [Civ6 Windows 目标机证据](./CIV6_WINDOWS_EVIDENCE.zh-CN.md)。它不替代仍未发布的正式 Release/catalog。

## 仍未闭合

- PERF-001、PERF-002、PERF-010 的冻结参考硬件/硬件加速档；
- 当前单一正式 profile 固定为系统 Microsoft Edge（`msedge`）；是否扩展为多浏览器性能档仍待 Issue #12 的产品决定；
- Microsoft Edge 前一个主要版本的安全并行运行证据；
- 核心静态网站继续面向 Windows 10+ 的支持矩阵内现代浏览器；它不包含需要单独操作系统发布的可执行程序；
- 项目许可证决策。
