# Learning MORE 安全运行时激活与一键自愈设计

## 1. 目标

让运行中心的“一键重连”真正完成从工作区版本核验、候选构建、失败自愈、release 激活、运行实例验证到 AI Provider 刷新的完整闭环。

成功的唯一标准是以下三者一致：

1. Host 已提交的活动 `buildId`；
2. `/api/v1/runtime/ready` 返回的运行实例 `buildId`；
3. `43119` 页面入口及其静态资源所属的 `buildId`。

旧实例能够响应不再等价于目标版本恢复成功。

## 2. 范围

本次修改覆盖：

- Host 工作区激活任务、状态持久化、候选清理和一次自动重试；
- Launcher 对激活最终状态的观察、状态收敛和安全 Host 修复入口；
- 控制接口返回的激活阶段与结构化错误；
- Web 运行恢复协调器和运行中心状态展示；
- “同步前端版本”从空操作改为复用统一激活能力；
- 单元、集成和运行入口版本验证测试。

本次不修改学习数据、AI 业务任务、Provider 配置、课程数据模型或用户事实存储。

### 2.1 当前服务端组合口径

`local-application` 组合根重构已经完成，安全激活功能以重构后的实际接口为准：

- `apps/server/src/bootstrap/local-application.ts` 只是合同导出和 assembly 委托门面；
- `apps/server/src/bootstrap/local-application/readiness.ts` 独立、无副作用地实现 `ServerDependencies['getRuntimeReadiness']`；
- `/api/v1/runtime/ready` 继续通过现有 `RuntimeReady` 合同暴露 `buildId`、`protocolVersion`、实例身份与各子系统状态；
- 激活后的 Server 验证只消费该既有只读合同，不进入课程、学习、画像、Provider 或其他本地应用内部 Module；
- 本次不修改 `apps/server/src/bootstrap/local-application.ts`、`apps/server/src/bootstrap/local-application/**` 和 `apps/server/src/bootstrap/main.ts`。现有服务端合同测试只作为非回归门禁运行。

因此本功能与组合根重构不存在实现文件重叠。Host、Launcher、Web 恢复协调器和 release 构建负责版本激活；Server 只提供已经稳定的运行身份事实。

## 3. 安全不变量

- 新候选通过全部验证前，旧活动 release 保持运行。
- 只清理当前 `requestId` 创建的临时目录和未提交候选，不删除活动或上一个可回滚 release。
- 自动构建最多两次：首次失败后安全清理并重试一次，第二次失败即停止。
- 只允许停止、启动或接管身份指纹与租约均匹配的 Learning MORE Host、Launcher 和 Server。
- 外部进程占用端口时停止恢复，不强杀、不接管。
- `.learning-more-data`、本地密钥目录和用户课程数据不属于恢复清理范围。
- 候选激活失败时必须恢复旧 release，并验证旧实例重新就绪。
- 页面只有在目标版本完成端到端验证后才刷新。

## 4. 统一激活状态

Host 持久化的激活状态扩展为：

```ts
type WorkspaceActivationStatus = Readonly<{
  schemaVersion: 2;
  requestId: string;
  phase:
    | 'queued'
    | 'verifying'
    | 'building'
    | 'cleaning'
    | 'retrying'
    | 'staging'
    | 'activating'
    | 'verifying-runtime'
    | 'activated'
    | 'failed';
  sourceBuildId?: string;
  activeBuildId?: string;
  targetBuildId?: string;
  attempt: 1 | 2;
  errorCode?: ActivationErrorCode;
  errorStage?: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
}>;
```

`ActivationErrorCode` 至少包含：

- `source_identity_unavailable`
- `workspace_identity_changed`
- `candidate_build_failed`
- `candidate_stage_failed`
- `candidate_verification_failed`
- `activation_rolled_back`
- `host_unavailable`
- `host_identity_mismatch`
- `external_port_owner`
- `runtime_ready_timeout`
- `served_web_build_mismatch`

错误对外只暴露稳定错误码和阶段，不暴露数据目录、密钥路径、命令行或原始堆栈。完整技术细节写入本地诊断制品。

状态读取器兼容现有 `schemaVersion: 1` 文件：旧 `activated`、`unchanged` 和 `failed` 会映射为只读终态；所有新请求只写版本 2。兼容读取只用于完成迁移，不允许把缺少目标身份的旧 `failed` 推断成成功。

## 5. 模块职责

### 5.1 Host：激活执行器

Host 是候选构建和 release 切换的唯一写入者。它负责：

- 按 `requestId` 串行处理激活请求；
- 保存每个阶段和最终错误；
- 构建候选并验证构建前后工作区身份一致；
- 首次构建失败后清理本次临时资产并重试一次；
- 暂存不可变候选；
- 调用 Supervisor 原子切换；
- 候选失败时恢复并验证旧 release；
- 保留可供 Launcher 查询的终态。

Host 不把失败异常吞成无原因的 `failed`。

### 5.2 Launcher：激活协调器

Launcher 不再在 Host 进入中间阶段时把激活视为完成。由于 Host 成功激活时会替换承载控制请求的旧 Launcher，控制 POST 不能阻塞等待终态；否则成功路径会随着旧进程退出而断开。Launcher 采用“接受请求 + 持久化终态恢复”协议：

- 创建激活请求并记录 `requestId`；
- 等待 Host 以同一 `requestId` 发布首个有效状态，随后返回 `rebuilding` 和目标身份；
- 每次读取控制状态时重新读取 Host 持久化状态；新 Launcher 启动后也能恢复同一请求的 `activated` 或 `failed` 终态；
- 将当前阶段、终态和错误码投影到控制接口；
- 根据终态设置 `healthy`、`degraded` 或 `activation-failed`；
- 在 Host 未发布首个有效状态且超过阈值时，执行一次受限 Host 修复。候选构建已经开始后不使用短停滞阈值误判长构建，由 Host 自身构建上限和 Web 总恢复上限负责收敛。

受限 Host 修复复用现有 `host repair`：只核对并修复固定的 Learning MORE 计划任务，启动任务后重新等待激活状态。执行前必须核验任务定义、Host 锁和进程身份；任何不匹配都返回 `host_identity_mismatch`，不继续处理。

Launcher 自身由 Host Supervisor 管理。候选激活时，Supervisor 只替换其拥有且身份匹配的 Launcher，并在新实例验证失败后回滚旧实例。

### 5.3 Web：恢复协调器

恢复协调器执行：

1. 读取 Launcher、Host 激活和 Runtime 就绪状态；
2. 判断是否已经一致；
3. 不一致时提交统一激活请求；
4. 按请求状态展示构建、清理、重试、激活和验证阶段；
5. `failed` 时立即停止轮询并展示稳定错误；
6. `activated` 后验证 Runtime 与页面资源版本；
7. 最后刷新 AI Provider 状态并重载页面。

`verify` 不再是空操作。`waitUntilReady` 同时轮询新 Launcher 的持久化激活终态与 Runtime readiness：Host `failed` 时立即结束；`activated` 后继续完成 Runtime 与页面 build 验证，不靠单一超时推断结果。

### 5.4 同步前端版本

“同步前端版本”与“一键重连”共享同一个激活模块：

- 同步前端版本：执行版本核验、候选构建和激活，不重连 AI Provider；
- 一键重连：在同一激活成功后继续重连 AI Provider。

不保留直接复制活动 release 静态文件的旁路，也不保留空实现。

### 5.5 页面构建身份

Web 构建在输出根目录生成不可变 `build-meta.json`，至少包含 `buildId` 和 `protocolVersion`。Launcher 从当前实际提供静态文件的 `webRoot` 返回该文件，并设置 `Cache-Control: no-store`。恢复协调器通过 `43119/build-meta.json` 验证浏览器入口所属版本；不从哈希文件名猜测版本，也不使用浏览器内旧 bundle 自报的常量代替服务端事实。

## 6. 一键自愈流程

```text
读取 source / active release / runtime / served web 身份
  ├─ 四者一致：验证服务并刷新 AI
  └─ 不一致：创建 activation request
       ↓
     Host attempt 1 构建候选
       ├─ 成功：暂存并激活
       └─ 失败：保留旧实例，清理 request 临时资产
                    ↓
                  attempt 2
                    ├─ 成功：暂存并激活
                    └─ 失败：发布结构化失败，旧实例继续运行
       ↓
     Supervisor 切换候选
       ├─ 新实例验证成功：提交 active build
       └─ 失败：回滚并验证旧实例
       ↓
     校验 runtime build + served web build
       ├─ 一致：刷新 AI，重载页面
       └─ 不一致：报告失败，不宣称完成
```

## 7. 超时与重试

- Host 状态首次响应超时：5 秒。
- 单次候选构建沿用发布构建自身超时；外层不无限延长。
- Host 状态无进展阈值：15 秒，触发一次受限 Host 修复。
- 激活后的 Runtime 就绪验证：60 秒。
- 自动候选构建次数：最多 2 次。
- Host 修复次数：最多 1 次。
- AI Provider 刷新失败不回滚已经成功的本地版本激活，但运行中心必须单独显示 AI 恢复失败。

所有上限均由单一配置模块定义，测试使用注入时钟，不依赖真实等待。

## 8. 运行中心呈现

运行中心显示以下可观察阶段：

- 核验版本
- 构建候选
- 清理并重试
- 激活版本
- 验证运行实例
- 验证页面资源
- 刷新 AI

失败信息包含“失败阶段、稳定错误说明、旧版本是否仍可用、是否可以再次重试”。不得把旧实例健康显示成目标版本恢复成功。

## 9. 测试策略

### 9.1 Host 单元测试

- 第一次构建失败，清理后第二次成功；
- 连续两次失败，活动 release 不变；
- 只清理当前请求的临时目录；
- 构建期间身份变化时拒绝激活；
- 候选验证失败时回滚并恢复旧实例；
- 错误码和失败阶段被持久化。

### 9.2 Launcher 单元测试

- 控制 POST 在 Host 接受 request 后返回，但不得把 `building` 表示为完成；
- Host `failed` 后退出 `rebuilding`；
- Host 首次响应不可用时只执行一次受限修复；
- 身份不匹配或外部端口占用时安全失败；
- Launcher 重启后能从持久化状态恢复正确终态。

### 9.3 Web 单元测试

- `verify` 比较 source、active、runtime 和 served web 身份；
- Host 失败时立即结束等待并展示对应错误；
- 激活成功但页面资源仍旧时不报告完成；
- 同步前端版本不触发 Provider 重连；
- 一键重连仅在本地激活成功后刷新 Provider。

### 9.4 跨层集成测试

至少覆盖两个完整场景：

1. 第一次候选构建失败、第二次成功，最终 Host active、Runtime ready、页面入口三者等于目标 `buildId`；
2. 两次构建均失败，旧页面和旧 Runtime 持续可用，运行中心收到结构化失败且允许再次重试。

测试不得仅使用永远成功的 mock 串联三个模块。

### 9.5 服务端组合根非回归

运行现有 `local-application-contract`、health route 和 app bootstrap 测试，确认自愈改动没有扩大 `LocalApplication`、`ServerDependencies` 或 `/api/v1/runtime/ready` 的接口，也没有给 readiness 引入恢复副作用。该组测试只验证稳定 seam，不要求修改服务端实现。

## 10. 验收标准

- 当前已复现的“Host `failed`、Launcher 长期 `rebuilding`、旧 Server 仍显示 `healthy`”无法再次出现。
- 新源码存在时，一键重连要么切换并显示新页面，要么明确报告失败原因并保留旧页面。
- 运行中心不再把空 `syncFrontend` 调用显示为成功。
- 激活成功后浏览器不需要用户手动强制刷新即可进入目标版本。
- 任何失败路径不删除学习数据、不破坏活动 release、不终止外部进程。
