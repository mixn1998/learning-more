# Learning MORE 前端最终验收与结构缺口报告

> 验收日期：2026-07-14
>
> 产品入口：`http://127.0.0.1:43119/`
>
> 验收范围：设计系统、29 个页面状态、全部纵向业务切片、前后端合同、Launcher、视觉、无障碍、E2E 和生产构建。

## 1. 验收结论

前端全阶段实施和当前后端一致性闭环已完成。`apps/web` 已从 UI 样稿实现迁移为真实 React/API/SSE 产品；29 个 HTML 页面只保留为冻结视觉基准。唯一产品地址由 Launcher 托管，内部后端故障不会使网站退出。运行中心已取消产品代码中的 Codex 模型硬编码，改为读取当前登录账号的 CLI 实时目录；Provider 选择、模型和推理强度会持久化，并在一键重连后恢复。

## 2. 通过证据

| 门禁 | 结果 |
| --- | --- |
| 全仓格式、Lint、类型、Schema/OpenAPI、架构、测试、构建 | 通过 |
| 单元/合同/集成测试 | 166 文件、579 项通过 |
| 架构数据键 | 237 个通过，0 个禁止依赖 |
| 功能等价矩阵 | 75/75 通过，0 未实现 |
| 核心业务 E2E | 4/4 通过 |
| Runtime E2E | 5/5 通过 |
| 样稿审计 | 29 页九组审计全部通过 |
| React 三视口视觉回归 | 87/87 通过；全页差异阈值 0.3% |
| React 无障碍 | 29/29 通过 |
| 产品 UI 隔离 | `real-react-api`，无样稿入口泄漏 |
| 供应链 | 54 个依赖，许可证通过，0 漏洞 |
| 单地址故障演练 | 网站 200 → 内部 API 502 → 自动恢复 200 → Launcher `healthy` |
| 运行中心真实验收 | Launcher `healthy`；一键重连后仍为 `codex-cli / gpt-5.6-sol / healthy` |
| Codex CLI 实时目录 | 当前账号返回 7 个可见模型；Sol 的档位为 `low/medium/high/xhigh/max/ultra`，页面选项与接口逐项一致 |
| Codex CLI 真实生成 | `codex exec` 最小烟测返回 `OK`；当前产品 Provider 已切换为 `codex-cli` |
| 运行状态实时性 | 初次读取与手动操作显示“连接中”；页面每 5 秒同步 Provider 状态和模型目录，并展示最近同步时间 |
| Provider 状态语义 | 只有当前 Provider 显示“已连接/当前使用”；其他健康接口显示“可用 · 未连接” |
| 主页空状态 | 只有存在正式课程时才显示“继续学习”；仅有未确认大纲时不显示 |
| AI 内容排版 | 标题使用黑体加粗；中文正文使用宋体、英文正文使用 Times New Roman，正文统一 700 字重；代码保持等宽常规字重 |
| 周历排版 | 规划区与上周回顾的日期标题统一加粗，星期与日期使用 5px 间距，卡片说明保持常规字重 |
| Portable 候选 | `Learning-MORE-0.1.0-win-x64.zip`，SHA256 `E577129BD6748FEE10AAAD448488A389870F56FFAAD9022150B804CC7869023E` |

## 3. 维护命令

```powershell
# 唯一产品启动命令；用户只访问 43119
corepack pnpm start

# 仓库级前端完整验收
corepack pnpm frontend:acceptance

# 单独门禁
corepack pnpm verify
corepack pnpm product-ui:check
corepack pnpm supply-chain:check
corepack pnpm ui-samples:verify
corepack pnpm visual:test
corepack pnpm playwright:test
corepack pnpm playwright:runtime
```

## 4. 仍影响整个项目结构的工作

### 必须在“无人值守常驻”发布目标前完成

1. **Windows 宿主生命周期**：当前 Launcher 在运行期间能保持网站常驻并自愈内部后端，但系统重启/用户登录后仍需启动它。若“始终可打开”包含重启后无人操作，需要新增签名安装器、登录自启动或 Windows Service/计划任务、单实例升级、崩溃拉起、升级回滚和卸载清理。这是当前唯一会改变整体部署结构的缺口。

### 不改变代码结构，但上线前仍需完成

1. API-compatible Provider 若要作为正式备用通道，仍需在目标环境配置真实凭据并执行生产烟测；当前 Codex CLI 通道已经用当前登录账号完成真实调用。
2. 触发新增的 Windows `visual-acceptance` CI 首次远程运行，确认托管 Runner 的 SimSun/SimHei/Times 字体与本地基线一致。
3. 对已生成的 0.1.0 Portable 候选执行代码签名；本地聚合 `release:drill` 因 600 秒外层时限且当前 43119 正在服务而未完成最新一轮 Unicode 离线启动，需在隔离的 Release CI 中完成。该命令此前已有 `release-ready` 报告，本轮各组成门禁与 Portable 构建均单独通过。

以上三项属于环境、发布和运维验收，不要求重写前端模块、数据流或后端业务闭环。
