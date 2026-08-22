# 第三方组件说明

本文件记录当前锁文件中用于生产运行的主要第三方组件及其上游许可证类型。它不替代各组件随包提供的完整许可证文本，也不构成 Tessera Studio 自身的授权。发布审计应以 `pnpm-lock.yaml`、`packages.lock.json`、`pnpm licenses list --prod --json` 和实际制品为准。

| 组件                       | 用途              | 上游许可证   |
| -------------------------- | ----------------- | ------------ |
| React、React DOM           | Web UI            | MIT          |
| i18next、react-i18next     | 国际化            | MIT          |
| PixiJS                     | WebGL/Canvas 渲染 | MIT          |
| Radix Tooltip、Floating UI | 可访问提示与定位  | MIT          |
| Zustand                    | UI 状态           | MIT          |
| Ajv、ajv-formats           | JSON Schema 验证  | MIT          |
| Dexie                      | IndexedDB 存储    | Apache-2.0   |
| zip.js                     | 扩展包 ZIP 读取   | BSD-3-Clause |
| semver                     | 模块版本范围      | ISC          |
| lucide-react               | 图标              | ISC          |

文明 6 提取器的自包含发布物会另外附带所捆绑 .NET runtime 的许可证和第三方通知。提取器不捆绑游戏 DLL、SDK、游戏资产或生成的 `tessera.civ6` 包。

仓库当前没有根级项目许可证；项目许可证必须由仓库所有者在正式发布前决定。
