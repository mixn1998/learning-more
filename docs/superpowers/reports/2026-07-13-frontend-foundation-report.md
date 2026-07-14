# Learning MORE 当前前端工作基础报告

> 基准日期：2026-07-14
>
> 结论：正式 React 前端、共享设计系统、现有后端业务闭环和 Launcher 单地址运行基础均已建立；HTML 仅保留为视觉参照。

## 1. 当前施工环境

- pnpm monorepo，React 19、React Router 7、TypeScript 5.9、Vite 8；
- `apps/web` 是唯一产品 UI，`packages/ui` 是共享组件、token、无障碍和 AI 排版来源；
- `packages/contracts` 提供 Zod/OpenAPI/跨层响应合同；
- `apps/server` 提供权威 HTTP/SSE、领域状态、文件持久化、投影与恢复；
- `apps/launcher` 在 `http://127.0.0.1:43119/` 托管网站、控制面和同源 API 代理；
- 43120 仅为内部后端端口，5173 仅为开发热更新端口，均不是用户地址；
- 项目内运行命令为 `corepack pnpm start`，发布包使用同一 43119 单入口。

## 2. 已有并继续复用的基础

### 2.1 前端架构

- Route 负责 URL、页面数据装载、分包和页面级恢复；
- Feature 保留既有 reducer、ViewModel、SSE、幂等重试和窗口生命周期；
- Client 统一处理 Schema、Problem、ETag、If-Match、CSRF、page instance 和 command attempt；
- Launcher 控制通道虽独立于产品 API，响应同样经过共享 Schema 校验；
- 业务路由使用 React lazy/Suspense 分包，并提供分包失败后的重载/返首页恢复页；
- 产品构建不包含 HTML 样稿、iframe、demoMode 或内联业务 Fixture。

### 2.2 共享设计系统

- 页面、布局、Card、Panel、Button、Badge、Tabs、Dialog、Toast、Field 和内容状态已共享；
- Tabs 支持 ARIA 关联、方向键、Home/End 和 roving tabindex；
- Dialog 支持焦点陷阱、Escape、关闭后焦点恢复和自定义视觉壳；
- 九种玩法的 accent/accent-dark/tint/motif 与样稿一致，并贯穿完整页面；
- AI 标题使用 SimHei/黑体，正文使用 Times New Roman → SimSun/宋体回退，代码使用等宽字体；
- 长篇 AI 正文为 16px/1.8，对话正文为 14px/1.9，均由共享 token 管理。

### 2.3 已闭环业务切片

| 业务域 | 当前真实闭环 |
| --- | --- |
| 主页 | 聚合草稿、课程、活动会话、推荐课节和周计划；继续学习使用权威优先级 |
| AI 建档 | 九模式、起点评估、SSE 候选、失败草稿、重生成、材料上传/摄取、确认与冲突恢复 |
| 正式课程 | 大纲、课节、修订、版本、关闭态、课程 Review 和生命周期确认 |
| 学习 | 未开始/已放弃导航、完整消息 hydration、生成/停止、暂停/恢复、租约转移和刷新恢复 |
| 结课与 Review | 服务端权威关闭输入、事务状态、重试、最终 Review 和补充学习 |
| 课节记录 | 学习对话/课时 Review 双页签、原始/补充会话、日历与历史深链 |
| 规划 | 排期、改期、时长、锁定、移除，计划流预览/确认/暂停/恢复/重排/结束 |
| 历史 | 分页、统计、月历、本地日期、课程摘要、折叠周报和 Review 深链 |
| 画像 | 画像/证据并行读取、生成轮询、失败回收、旧版保留和复合证据抽屉 |
| 运行中心 | Provider 状态/切换、凭据安全、诊断、四阶段重连、版本阻断和 Launcher 自愈 |

## 3. 视觉和质量基础

- 29 个 HTML 样稿 × 3 视口 = 87 张权威 HTML 基线；
- 29 个 React 状态 × 3 视口 = 87 张正式 React 基线；
- 八种非默认模式 × 3 视口 × HTML/React = 48 张派生模式基线；
- 设计系统关键组件基线 30 张；合计现行视觉检查 252 张；
- 全页差异阈值 0.3%，关键组件差异阈值 0.1%；
- 29 项 React 可访问性门禁覆盖键盘、ARIA、焦点、200% 缩放、reduced motion 和横向溢出；
- 29 页样稿的加载、控件接线、交互、几何、排版和视觉完整性九组审计全部通过；
- 4 条业务 E2E、5 条 Runtime E2E、75 条等价断言均通过。

## 4. 单地址与故障恢复

正式运行只有 `http://127.0.0.1:43119/`。Launcher 先监听并托管静态站点，再启动内部后端。内部后端失败不会关闭网站；运行中心仍可访问并执行诊断、重连和同步。真实故障演练中，终止已核验后端进程后：站点始终返回 200，API 短暂 502，随后自动恢复 200，控制状态回到 `healthy`。

## 5. 当前增量结论

前端工程、跨层接口和主要业务闭环没有需要重新施工的结构性缺口。后续工作应以保护性迭代为主：新增功能必须沿用 Route → Feature → Client/State → Contract → Server 的边界，并通过 `corepack pnpm frontend:acceptance`。

整个项目仍可能需要的结构工作集中在发布宿主生命周期，而不是前端页面本身：若要求 Windows 登录或重启后无需用户操作仍保持可访问，需要补签名安装器、自动启动/守护注册、升级回滚和卸载清理。当前 Portable 包与 Workspace 启动命令都需要用户启动 Launcher。
