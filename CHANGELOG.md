# Changelog

## 0.1.0 — 2026-07-13

Learning MORE 的首个本地优先 MVP 发布版本。

### 已实现

- React + Vite 前端、Node.js 模块化单体后端与共享 TypeScript 合同。
- 九种课程模式、课程创建与正式大纲、课节预览、学习会话、放弃/恢复、补充学习、课时 Review 和课程总 Review。
- 三态规划边界、手工排期与计划流、历史统计、学习日历、全局学习档案、候选证据和版本化学习画像。
- 多 AI Provider seam、运行时切换与健康状态、持久生成任务、并发/取消/超时、SSE 续传和刷新恢复。
- 课程档案永久删除：级联删除整套课程档案，并同步撤回事实与证据、重建统计、刷新画像；事务失败可恢复且重复命令幂等。
- 本地文件 Store、原子 Unit of Work、事件投影重建、schema migration、verify、doctor、quarantine、backup 与整库 restore。
- Windows x64 portable 发布、Launcher 进程身份与端口保护、DPAPI 密钥、SBOM、许可证/漏洞策略和可复现 ZIP。
- 75 条功能等价断言全部由实际执行且通过的自动化测试支撑。

### 数据与协议

- Store schema：`1`。
- HTTP/runtime protocol：`1`。
- 支持迁移来源：正式 Store schema `1`；不承诺旧原型数据的运行时兼容。
- 升级、迁移和整库恢复前必须保留至少一个已验证备份；权威聚合、消息、Review 或事件中段损坏时必须从已验证备份恢复，不得原位伪造。

### 已知限制

- 真实 API-compatible Provider 使用环境变量或运行中心配置；Codex CLI 模型与推理强度改为从当前 CLI/账号实时读取，不再维护静态型号清单。Provider 切换、一键重连和首个有效 delta 前的自动 fallback 已接入 GenerationRuntime。

- 单用户、本地优先、无云同步、无多用户登录体系。
- 通用附件、网页与外部资料抓取不在本版本范围内。
- 生产 Prompt、具体模型与 Provider 连接参数由运行环境配置；发布包不携带用户密钥。
- 推荐扩展课程提供 Review 建议，但完整的一键创建交互仍不在本版本范围内。
