# Learning MORE

Learning MORE 是一个本地优先的 AI 教学应用。它覆盖课程建档、大纲生成、课节学习、课堂互动、Review、学习笔记、排期与历史记录，并通过明确的教学状态账本维持课程进度。

## 工作区结构

| 目录           | 职责                                         |
| -------------- | -------------------------------------------- |
| `apps/`        | 可运行产品：Web、Server、Launcher、Host      |
| `packages/`    | 产品共享能力：合同与 UI 组件                 |
| `operations/`  | 本地启动、数据维护、迁移、投影和发布         |
| `engineering/` | 架构校验、变更验证、跨应用测试和性能基准     |
| `docs/`        | 当前有效的安全与维护说明                     |
| `.local/`      | 可重建的缓存、测试报告和发布产物，不进入 Git |

产品代码和工程支持代码使用独立 pnpm workspace。程序会读取的等价矩阵、数据定义等工程契约放在 `engineering/architecture/fixtures/`，不作为普通文档维护。

## 环境要求

- Windows 10/11
- Node.js `24.17.x`
- pnpm `10.34.3`（由 Corepack 管理）

## 安装

```powershell
corepack enable
corepack pnpm install --frozen-lockfile
```

## 常用命令

```powershell
# 启动本地应用
corepack pnpm start

# 同时启动前后端开发服务
corepack pnpm dev

# 按变更范围执行验证
corepack pnpm verify

# 完整验证
corepack pnpm verify:full

# 检查本地宿主服务
corepack pnpm host:status
```

## 验证分层

- `pnpm test`：产品代码的日常单元测试。
- `pnpm test:all`：产品、运行维护和工程工具测试，不含容量与故障演练。
- `pnpm playwright:test`：真实产品页面的跨应用流程。
- `pnpm playwright:runtime`：本地运行时、自愈和版本同步流程。
- `pnpm a11y:test`：真实 React 页面的可访问性检查。
- `pnpm test:capacity`、`pnpm test:recovery`：发布前专项验证。

静态 HTML UI 样稿及其视觉审计链路已移除；产品 UI 以真实 React 页面为准。

## 本地状态与用户数据

以下目录不进入 Git：

- `.local/`：缓存、测试报告、构建和发布产物，可随时重建。
- `.learning-more-local/`：本地日志、诊断与密钥。
- `.learning-more-runtime/`：当前运行状态。
- `.learning-more-data/`：用户课程、学习记录和笔记。
- `.learning-more-backups/`：用户数据备份。

仓库清理和工程缓存生命周期不得删除用户数据与备份。进一步规则见 [安全与隐私](./docs/security-and-privacy.md)。

## 发布

```powershell
corepack pnpm release:portable
```

便携版输出至 `.local/generated/release/`，发布验证报告输出至 `.local/artifacts/release/`。

## 维护边界

- 业务功能优先在所属 `apps/` 或 `packages/` 内闭环。
- 运行、迁移和数据修复脚本进入 `operations/`。
- 只服务开发流程的校验、测试与基准进入 `engineering/`。
- 根目录只保留仓库入口、依赖清单和工具默认配置。
