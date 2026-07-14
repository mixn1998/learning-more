# Learning MORE Windows 常驻宿主与运行状态真实性设计规格

日期：2026-07-14

状态：待用户书面复核

决策：采用当前用户登录计划任务（方案 A）+ Host Supervisor

## 1. 背景与结论

Learning MORE 当前已经具备 Launcher 控制面、Server 进程身份核验、单实例锁、Server 崩溃退避重启、一键重连、Provider 配置持久化和 portable 发布产物。现存缺口不是重新搭建这些能力，而是补齐最外层宿主生命周期，并让运行中心只展示后端能够证明的真实状态。

本轮诊断确认了三个独立问题：

1. `tools/start-learning-more.mjs` 在前台运行 Launcher，并在父进程收到 `SIGINT`/`SIGTERM` 时主动关闭 Launcher。由 Codex 临时执行单元启动时，临时父进程结束会同时带走站点入口，因此无法保证网站始终可打开。
2. Provider 配置文件已经保存 `gpt-5.6-sol` 和 `reasoningEffort: high`，但 `/api/v1/ai-runtime/status` 没有返回当前有效推理强度。运行中心重开时从模型目录读取 `defaultReasoningEffort: low` 并覆盖显示，所以页面显示并不能证明实际配置。
3. 一键重连期间 Server 会受控退出并重新就绪。100ms 采样确认约 2 秒操作中出现 7 次暂时性 502，而 Launcher 最终返回 `healthy`。AppShell 把恢复窗口内的任何一次探测失败立即映射为红色 `offline`，造成健康服务执行自愈时短暂显示“需处理”。

本设计保留现有 43119/43120 固定拓扑，不新增用户需要记忆的地址或端口。

## 2. 目标与非目标

### 2.1 目标

- Windows 用户登录后自动启动 Learning MORE，启动行为不依附 Codex、终端或开发工具的生命周期。
- Host、Launcher、Server 三层各有单一职责和明确的崩溃恢复边界。
- Windows 任务、Host 和 Launcher 共同保证单实例，且不误杀未知进程或外部端口所有者。
- 支持候选版本校验、健康门禁、原子启用和失败自动回滚到上一健康版本。
- 运行中心重开、刷新或重连后，展示持久化且已经应用的真实 Provider、模型与推理强度。
- 一键重连期间显示“重连中”，只有超过恢复期限、身份不匹配或最终健康检查失败才显示红色故障。
- 本地服务健康与 AI Provider 健康独立，不互相污染状态。
- 通过可替换端口和确定性状态机进行测试优先开发，并完成真实 Windows 计划任务验收。

### 2.2 非目标

- 不改为 Windows Service。Codex CLI 登录和浏览器授权需要当前用户交互会话，Session 0 服务会增加凭据和授权窗口复杂度。
- 不改变用户访问地址，不做动态端口扫描或静默端口漂移。
- 不允许 Web 控制面执行任意命令、任意文件路径或任意计划任务操作。
- 不把 Provider 密钥、Secret handle、指纹或任意敏感配置返回浏览器。
- 不用 Service Worker 掩盖服务离线，也不把静态页面可见误报为业务 Server 健康。

## 3. 方案比较与最终选择

### 3.1 方案 A1：登录计划任务 + Host Supervisor（采用）

计划任务只启动稳定的 Host Supervisor。Supervisor 解析当前启用版本、持有宿主锁、启动 Launcher、监控异常退出并处理版本回滚；Launcher 继续负责 Server。

优点：生命周期层次清晰；能实现 Launcher 自身崩溃拉起；升级事务和回滚有稳定执行者；适合现有 portable 发布结构。缺点：增加一个很小的常驻进程和宿主状态清单。

### 3.2 方案 A2：登录计划任务直接启动 Launcher（不采用）

实现较少，任务计划程序可以在 Launcher 退出后重启。但是升级时任务动作路径和当前版本强耦合，无法可靠承担候选版本健康门禁与入口回滚；任务计划程序也无法表达产品级回滚状态。

### 3.3 方案 A3：启动目录快捷方式或批处理（不采用）

登录启动简单，但崩溃恢复、单实例、状态查询和升级回滚不足，不能满足“网站始终可打开”。

## 4. 目标运行拓扑

```text
Windows Task Scheduler（当前用户登录触发）
  └─ Learning MORE Host Supervisor
       ├─ host lease / release state / recovery journal
       └─ Launcher（127.0.0.1:43119，静态站点与控制面）
            └─ Server（127.0.0.1:43120，业务与 AI runtime）
```

职责边界：

- Task Scheduler：登录启动、Supervisor 进程级失败重启、`IgnoreNew` 多实例策略。
- Host Supervisor：选择版本、持有 Host lease、启动和监控 Launcher、候选版本提交或回滚。
- Launcher：持有现有 Launcher lease、验证 Server 身份、启动/停止/自愈 Server、提供固定站点入口和受限控制面。
- Server：业务状态、数据恢复、Provider 配置与真实 AI 健康。
- Web：只消费上述权威状态，不自行推断“已连接”。

## 5. Windows 登录宿主设计

### 5.1 深模块接口

新增 Windows Host 深模块，对外只暴露以下操作：

```ts
interface WindowsHostManager {
  install(input: InstallHostInput): Promise<HostInstallationStatus>;
  status(): Promise<HostInstallationStatus>;
  repair(): Promise<HostInstallationStatus>;
  uninstall(): Promise<void>;
}

interface HostSupervisor {
  run(): Promise<never>;
  activateCandidate(candidate: ReleaseCandidate): Promise<ActivationResult>;
}
```

应用代码不直接依赖 PowerShell、`schtasks.exe` 或注册表。Windows Task Scheduler adapter 负责系统调用；测试使用 InMemory adapter。

`repair()` 是幂等对账，不是盲目重建：检查任务名称、当前用户、动作路径、参数、登录触发器、失败重启和单实例策略，仅修复与产品固定定义不一致的字段。

### 5.2 计划任务合同

- 固定任务名：`Learning MORE`。
- 仅在当前用户登录时运行，使用交互式用户令牌，不存储用户密码。
- 登录触发并设置 `StartWhenAvailable`。
- `MultipleInstancesPolicy = IgnoreNew`。
- 失败后 1 分钟重试，提供足够重试次数；Supervisor 内部仍负责快速、有界退避。
- 不设置会中断长期运行的执行时限。
- 动作使用固定的绝对 `node.exe` 和固定 Host 入口参数；不通过 shell 拼接用户输入。
- 隐藏控制台窗口；需要 Codex CLI 授权时仍可由当前用户会话打开浏览器。

### 5.3 单实例和身份

采用三层防护：

1. Task Scheduler `IgnoreNew` 阻止同一任务并发。
2. Host lease 阻止手动入口与任务入口并发。Lease 包含 schemaVersion、instanceId、PID、executablePath、releaseRoot、startedAt；复用 PID 前必须验证可执行文件和 release root，不能只凭 PID。
3. 保留 Launcher 已有 lease、manifest、端口所有者和完整运行身份验证。

发现未知进程占用锁或端口时，系统进入可诊断的 blocked 状态，不执行强杀。

### 5.4 崩溃恢复

- Server 异常退出：由现有 Launcher 按 0.5/1/2/4/8 秒退避处理。
- Launcher 异常退出：由 Supervisor 按同类有界策略重启 Launcher。
- Supervisor 异常退出：由 Task Scheduler 在 1 分钟后重新启动。
- 明确关闭或卸载：写入受控停止意图，避免 Task Scheduler/Supervisor 把正常退出当成崩溃。
- 重启风暴：达到阈值后保持固定 43119 控制入口（若 Launcher 可用）或由 Host 状态命令输出明确 blocked 原因，禁止无限高频拉起。

## 6. 发布、升级与回滚

### 6.1 宿主状态目录

宿主状态和用户业务数据分离：

```text
%LOCALAPPDATA%\Learning MORE\host\
├─ host-state.json
├─ host.lock
├─ activation-journal.json
└─ releases\
   ├─ <buildId-a>\
   └─ <buildId-b>\
```

`host-state.json` 只记录 `activeBuildId`、`previousBuildId`、`candidateBuildId`、状态版本和更新时间。写入采用临时文件、fsync 能力允许时落盘、原子 rename；不保存密钥。

### 6.2 激活事务

1. 将 release 解压到新的 buildId 目录，不覆盖 active 目录。
2. 校验 release manifest、SHA-256、布局、平台、protocolVersion 和可读 store format 范围。
3. 执行 migration dry-run；如存在写入型迁移，先创建并验证数据备份。
4. 写 `activation-journal: prepared`，记录 active、previous 和 candidate。
5. 受控停止当前 Launcher；启动 candidate Launcher。
6. 同时验证 43119 控制面身份、43120 readiness、自检、buildId 和 protocolVersion。
7. 健康门禁通过后原子提交 candidate 为 active，将旧 active 记为 previous。
8. 失败时停止经过身份验证的 candidate，恢复 previous 入口并等待健康；若数据格式已改变且旧程序不能读取，则恢复迁移前备份。
9. 回滚成功后保留失败诊断和 journal；不自动反复尝试同一 candidate。

Host 入口本身必须位于稳定路径，不能放在被切换的 release 目录内。portable 构建会包含 Host runtime 和安装/修复命令；工作区开发模式可以把当前工程登记为 development release，但正式升级仍使用版本化目录。

## 7. Provider 当前有效配置

### 7.1 权威来源

Provider 配置 repository 是模型与推理强度的持久化来源，GenerationRuntime 当前已应用的 Provider 是运行来源。状态接口必须在同一次读取中返回经过脱敏的当前有效配置：

```ts
type ProviderRuntimeStatus = {
  providerId: ProviderId;
  model?: string;
  reasoningEffort?: string;
  health: ProviderHealth;
  configurationState: 'applied' | 'connecting' | 'failed';
  checkedAt: string;
};
```

`reasoningEffort` 只对支持该字段的 Provider 返回。API-compatible 的 `baseUrl` 若未来需要展示，只能返回经过规范化且不含凭据的公开地址；本轮不扩张该范围。

### 7.2 不变量

- 状态为 `applied` 时，`model` 和 `reasoningEffort` 必须来自已经成功切换并持久化的配置。
- Provider 切换必须先验证目标、应用到 runtime、健康检查通过，再原子持久化；失败恢复上一运行配置和持久化配置。
- 服务启动和 AI 重连必须从 repository 重新应用完整 publicConfig，包括 `reasoningEffort`。
- 运行中心初始化先读当前状态，再读模型目录；目录的 `defaultReasoningEffort` 只用于用户首次选择新模型。
- 刷新、关闭重开和浏览器重新加载不得把 active 配置重置为目录默认值。
- “可用”表示 Provider 能力探测通过；“已连接”只用于当前 active 配置健康且 `configurationState = applied`。
- 前端绝不根据卡片被选中、目录有模型或 CLI 已发现来推断已连接。

### 7.3 Codex CLI 生成验证

Adapter 合同测试必须捕获实际传给 Codex CLI 的参数，证明 `gpt-5.6-sol/high` 在切换后、Server 重启后和 AI 重连后都仍以 `high` 执行。界面测试不能替代这一生成链路证据。

## 8. 本地服务重连状态机

### 8.1 单一协调者

新增 Web `RuntimeRecoveryCoordinator`，AppShell 顶部状态、运行中心步骤和错误横幅共享同一状态：

```text
loading
  → ready
  → recovering.verifying
  → recovering.reconnecting
  → recovering.waiting
  → recovering.refreshing
  → ready

任一阶段超过时限或最终验证失败 → degraded
身份不匹配/外部端口 → blocked
```

恢复状态为橙色并显示明确阶段。红色只对应 `degraded`/`blocked`，不对应恢复窗口中的暂时 502。

### 8.2 重连流程

1. 用户点击“一键重连”，协调者先进入 `recovering.verifying`，再调用 Launcher。
2. Launcher 验证当前实例、受控 drain/terminate 并启动 Server。
3. AppShell 周期探测仍运行，但恢复 token 有效期间的网络失败只更新内部观测，不覆盖 `recovering`。
4. Launcher 返回后，协调者持续等待 `/runtime/ready`，并校验实例身份和版本。
5. readiness 成功后显式 `await refreshRuntime()`；该方法返回已验证状态，不再是只触发一次 render 的 `void`。
6. 本地状态确认 ready 后独立刷新 AI 状态。AI 刷新失败仅使 AI 区域显示需处理，本地服务保持健康。
7. 所有异步结果携带 operationId；旧轮询或旧重连结果不能覆盖较新的状态。

### 8.3 超时和错误

- 受控恢复总时限与 Launcher readiness 合同一致，测试使用可注入时钟。
- 超时后显示可操作的原因和诊断入口，不显示未经验证的“已恢复”。
- `blocked_identity_mismatch`、`blocked_external_port` 等稳定错误直接映射到 blocked，不被后续普通轮询静默覆盖。
- 关闭运行中心不会取消 Launcher 已经开始的恢复，但重新打开会从协调者读取当前 operation，而不是回到默认健康显示。

## 9. 测试优先边界

实现前先在以下公开 seam 写失败测试，避免针对内部实现堆 mock：

### 9.1 Windows Host seam

- InMemory Task Scheduler adapter 验证 install/status/repair/uninstall 幂等合同。
- Host lease 验证正常复用、陈旧 PID、PID 复用、未知所有者和并发启动。
- Supervisor 验证 Launcher 异常退出退避、正常退出不重启、重启风暴阻断。
- Activation repository 验证 prepared/commit/rollback 和任一步崩溃后的确定性恢复。
- Fake release roots 验证 candidate 健康成功提交、身份不匹配回滚、迁移后按备份回滚。

### 9.2 Provider 配置 seam

- Contract schema 接受脱敏的 model/reasoningEffort/configurationState，拒绝未知字段和 secret。
- Provider config service 验证切换、失败回滚、Server 启动恢复和 reconnect 保留 high。
- Codex adapter 验证实际命令参数使用 high。
- RuntimeCenter 组件验证首次打开、关闭重开和刷新继续显示 high；只有改选新模型才使用目录默认 low。

### 9.3 Runtime recovery seam

- 输入 `ready → reconnect → 7 次 502 → ready`，全程不得出现 red/offline。
- 最终 readiness 超时必须进入 degraded。
- 身份不匹配必须进入 blocked。
- AI 刷新失败不得污染本地 ready。
- 旧 polling response 不得覆盖新 operationId。
- AppShell 和 RuntimeCenter 必须渲染同一协调者快照。

### 9.4 系统级验收

- 安装计划任务后结束启动终端/Codex 临时进程，43119 仍可访问。
- 杀死经过身份确认的 Launcher，Task/Supervisor 自动恢复站点。
- 杀死 Server，Launcher 自动恢复业务 readiness。
- 重复运行安装和启动命令不产生第二实例。
- 当前用户注销再登录后自动启动；Codex CLI 需要授权时能打开浏览器。
- 实际应用 `gpt-5.6-sol/high`，刷新页面、关闭重开运行中心、重启 Server 后仍显示并执行 high。
- 点击一键重连时顶部和运行中心显示“重连中”，恢复成功后回绿，中间不跳红。
- 安装一个故意无法通过 readiness 的 candidate，自动恢复上一版本和原访问地址。
- 卸载只移除计划任务和 Host 运行状态，不删除课程数据、Provider 配置、密钥或备份。

## 10. 文件与依赖方向

建议新增或调整以下边界，最终文件名可在实施计划中按现有 package 结构微调：

```text
apps/host/
  src/host-manager.ts
  src/supervisor.ts
  src/activation-repository.ts
  src/windows-task-scheduler.ts
  src/main.ts

packages/contracts/src/ai-runtime.ts
apps/server/src/runtime/provider-config-service.ts
apps/server/src/bootstrap/local-application.ts
apps/web/src/state/runtime-recovery-coordinator.ts
apps/web/src/layouts/app-shell.tsx
apps/web/src/features/runtime/runtime-center.tsx
tools/release/src/build-portable.ts
```

依赖方向为 Host application → Host ports，Windows adapter → Host ports；Host 不导入 Web/Server 领域模块。Web 协调者只依赖 runtime client 接口。Contract package 不依赖任何应用层。

## 11. 实施切片

1. Provider 状态真实值：先补 contract/service/adapter 测试，再修改接口和 RuntimeCenter hydration。
2. 重连状态协调：先写确定性状态机测试，再让 AppShell 和 RuntimeCenter 共用协调者。
3. Host 核心：先完成 Task Scheduler port、lease、Supervisor 和 activation journal 的纯测试。
4. Windows adapter：实现 install/status/repair/uninstall，接入 package scripts。
5. Portable 集成：将稳定 Host、内置 Node、安装入口和版本化 release 结构加入发布产物。
6. 真实安装：注册当前用户登录任务，核验动作、触发器、单实例和失败重启。
7. 破坏性验收：依次验证 Server 崩溃、Launcher 崩溃、登录启动、重连瞬态和 candidate 回滚。
8. 全量回归：typecheck、架构检查、相关 unit/integration、runtime Playwright、现有 81 张视觉基线与 0.3% 全页阈值、build/release drill。

每一切片保持可运行，并且不得重做已经存在的 Launcher Server 自愈、Provider 原子配置或 portable 校验能力。

## 12. 完成定义

只有同时具备以下证据才可宣布完成：

- 正式设计和实施计划已提交。
- 三个测试 seam 的失败测试先出现、实现后全部转绿。
- `ProviderRuntimeStatus` 能证明当前 active 的 model/reasoningEffort，且真实 CLI 参数证据一致。
- 一键重连采样期间没有错误红灯，最终状态由 await 后的权威 refresh 决定。
- Windows 计划任务真实存在并与固定合同完全一致。
- Launcher 脱离 Codex/终端父进程后仍持续运行，崩溃可自动恢复且保持单实例。
- candidate 健康失败的自动回滚演练通过。
- 用户数据和密钥未进入 release/host 状态或诊断输出。
- 全量回归和视觉门禁通过，网站仍使用唯一公开地址 `http://127.0.0.1:43119/`。
