# Learning MORE 详细实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 从零构建 Learning MORE 的 Windows 本地优先 MVP，形成课程创建、渐进式学习、Review 闭环、规划历史、画像证据、运行自愈、备份发布和 73 条回归验收的完整纵向系统。

**Architecture:** 使用 React Web + Node.js 模块化单体。当前聚合由 Repository 管理，本地文件 Adapter 使用可恢复事务、幂等结果与 outbox；追加事件驱动读模型、候选证据和画像版本。AI 通过持久化 GenerationRuntime 和可切换 Provider Adapter 运行，领域 Module 是最终结果的唯一提交者。

**Tech Stack:** Node.js 24.17.0、pnpm 10.34.3、TypeScript 5.9.3、React/React DOM 19.2.7、Vite 8.1.3、Fastify 5.10.0、Zod 4.4.3、Vitest 4.1.9、Playwright 1.61.1、React Router 7.18.0、React Testing Library 16.3.2、fast-check 4.8.0。

## Global Constraints

- 正式平台：Windows 11 x64；正式浏览器：当前及上一主版本 Chromium/Edge。
- MVP：单用户、仅本机、127.0.0.1、无登录、无云同步、无旧数据运行时兼容。
- 控制面默认 127.0.0.1:43119；应用后端默认 127.0.0.1:43120；Vite 开发默认 127.0.0.1:5173。
- 发布版前后端同源；不注册 Service Worker；file:// 不猜端口。
- 所有写命令必须有 Idempotency-Key；版本化写入必须有 expectedVersion/If-Match。
- 当前领域状态强一致；分析型读模型按事件游标最终一致。
- 最终课时 Review 和课程总 Review 首次成功后永久不可变。
- Repository 和 AI Provider 是正式 seam；内部事件分发不建立可替换事件总线。
- 原始对话全文不得进入全局学习档案；画像洞察至少由两个独立来源组支持。
- Provider、延迟、错误、页面访问、网络和写入权遥测不得进入画像。
- API Key 只进入 SecretStore；不得进入源码、普通配置、数据目录、浏览器持久化、日志、任务快照或备份。
- 所有网络、AI、文件和迁移数据必须经过 Zod runtime schema。
- TypeScript 启用 strict、noUncheckedIndexedAccess 和 exactOptionalPropertyTypes。
- 直接依赖使用精确版本；提交 pnpm-lock.yaml；安装使用 --frozen-lockfile。
- 单元/集成测试使用 Vitest 4.1.9，不使用 Vitest 5 beta。
- 测试不得读取真实用户数据；Mock Provider 是自动化测试默认 Provider。
- 73 个唯一 EQ 编号必须全部映射到 domain、repository、backend、react、e2e_main、e2e_recovery 六类证据。
- 全仓 lines/statements ≥ 90%，branches ≥ 85%；关键不变量 mutation score ≥ 90%。
- 强一致查询 p95 ≤ 200 ms；非 AI 写命令 p95 ≤ 350 ms；SSE 转发 p95 ≤ 100 ms。
- outbox 发布 p95 ≤ 2 秒；空闲投影延迟 p95 ≤ 5 秒；正常冷启动 p95 ≤ 5 秒。
- 容量目标：2,000 门课程、50,000 个课节、1,000,000 条消息、2,000,000 条事件、20 GiB 结构化数据。
- 每个任务使用 TDD：先失败测试，再最小实现，再全量相关测试，再提交。
- 不创建通用 shared、helpers、Repository<T>、Attachment 框架、微服务、消息队列或完整事件溯源。

---

## 1. 权威输入

- [程序架构设计](<./Learning MORE 程序架构设计.md>)
- [项目上下文](../../PROJECT_CONTEXT.md)
- [领域词汇](../../CONTEXT.md)
- [基础模块功能等价与回归基线](../基础模块功能等价清单与回归基线.md)
- [历史统计与学习画像数据源](../历史统计与学习画像数据源定义清单.md)
- [学习画像抓取与分析规则](../学习画像数据抓取与分析策略规则.md)
- [课程创建规则](../课程创建通用流程与功能逻辑规则.md)
- [课程学习与 Review 规则](<../课程学习与 Review 功能逻辑规则.md>)

实现者若发现输入冲突，应停止该任务并更新规格，不得在代码中自行选择新业务语义。

## 2. 计划拆分

架构包含多个可独立验收的子系统。详细步骤拆成八份阶段计划；本文件锁定顺序、公共约束、交付门禁和跨阶段接口。

| 阶段 | 详细计划 | 可独立验收的结果 |
| --- | --- | --- |
| 01 | [工程基座与共享合同](<./实施计划-01-工程基座与共享合同.md>) | 可构建 Monorepo、健康页、合同/架构检查和 73-ID 审计骨架 |
| 02 | [文件持久化与生成运行时](<./实施计划-02-文件持久化与生成运行时.md>) | 可崩溃恢复的 LocalFile、outbox/event/projection、任务与 Mock Provider/SSE |
| 03 | [课程创建纵向切片](<./实施计划-03-课程创建纵向切片.md>) | 主题→评估→候选→确认→正式课程的完整 Web/API/文件路径 |
| 04 | [课节学习、Review 与课程关闭](<./实施计划-04-课节学习Review与课程关闭.md>) | 学习会话→放弃恢复→最终 Review→完成事实→课程关闭 |
| 05 | [规划、历史与学习事实](<./实施计划-05-规划历史与学习事实.md>) | 排期/计划流、历史、统计、日历和周报 |
| 06 | [画像证据与画像生成](<./实施计划-06-画像证据与画像生成.md>) | 候选证据、全局档案、Evidence Packer 和版本化画像 |
| 07 | [React 全域界面与运行自愈](<./实施计划-07-React界面与运行自愈.md>) | 完整页面、Launcher、运行中心、Provider 切换和版本同步 |
| 08 | [备份、发布与全量验收](<./实施计划-08-备份发布与全量验收.md>) | migration、备份恢复、portable ZIP、73 条矩阵和发布门禁 |

## 3. 跨阶段依赖

~~~mermaid
flowchart LR
    P1["01 基座/合同"] --> P2["02 持久化/任务"]
    P2 --> P3["03 课程创建"]
    P3 --> P4["04 学习/Review"]
    P4 --> P5["05 规划/事实"]
    P5 --> P6["06 证据/画像"]
    P3 --> P7["07 Web/运行"]
    P4 --> P7
    P5 --> P7
    P6 --> P7
    P7 --> P8["08 备份/发布/验收"]
~~~

阶段不得跳过。后续计划可以消费前序 Interface，但不得导入前序 Module 的 implementation/model/ports。

## 4. 顶层文件地图

~~~text
Learning MORE/
├─ package.json
├─ pnpm-workspace.yaml
├─ pnpm-lock.yaml
├─ .nvmrc
├─ .gitignore
├─ tsconfig.base.json
├─ vitest.config.ts
├─ playwright.config.ts
├─ apps/
│  ├─ web/
│  ├─ server/
│  └─ launcher/
├─ packages/
│  ├─ contracts/
│  ├─ ui/
│  └─ test-kit/
├─ tools/
│  ├─ architecture/
│  ├─ benchmarks/
│  ├─ cli/
│  ├─ release/
│  └─ test-processes/
├─ tests/
│  ├─ acceptance/
│  ├─ e2e/
│  ├─ recovery/
│  ├─ performance/
│  └─ fixtures/
└─ docs/
   └─ 架构方案/
~~~

每个阶段计划列出更细文件职责。没有对应失败测试的生产文件不得先创建。

## 5. 公共 Interface 冻结点

阶段 01 必须输出并在后续保持名称一致：

~~~ts
export type CommandContext = {
  commandId: string;
  correlationId: string;
  idempotencyKey: string;
  expectedVersion?: number;
  pageInstanceId?: string;
  actor: "local-user";
  requestedAt: string;
  receivedAt: string;
};

export type CommandResult<T> = {
  commandId: string;
  outcome: "completed" | "accepted";
  value: T;
  resourceVersion?: number;
  task?: GenerationTaskHandle;
  projectionCursor?: string;
};

export type ApplicationProblem = {
  type: string;
  status: number;
  code: string;
  messageKey: string;
  retryable: boolean;
  correlationId: string;
  fieldErrors?: Record<string, string>;
  currentVersion?: number;
  recovery?: RecoveryInstruction;
};
~~~

阶段 02 必须输出并在后续保持名称一致：

~~~ts
export interface UnitOfWork {
  execute<T>(
    request: TransactionRequest,
    work: (tx: TransactionContext) => Promise<T>
  ): Promise<T>;
}

export interface GenerationRuntime {
  submit(request: GenerationRequest): Promise<GenerationTaskHandle>;
  cancel(command: CancelGenerationTask): Promise<GenerationTaskState>;
  get(query: GetGenerationTask): Promise<GenerationTaskView>;
  observe(query: ObserveGenerationTask): AsyncIterable<GenerationStreamEvent>;
}

export interface AiProvider {
  describe(): ProviderCapabilities;
  validateConfig(
    config: ProviderPublicConfig,
    secrets: SecretResolver
  ): Promise<ProviderValidation>;
  healthCheck(): Promise<ProviderHealth>;
  generate(
    request: NormalizedGenerationRequest,
    signal: AbortSignal
  ): AsyncIterable<ProviderDelta>;
}
~~~

阶段 03–06 的 Module 必须使用 execute(command, context) 和 query(query, context)，不能给 HTTP 层暴露聚合或 Repository。

## 6. 阶段门禁

每个阶段完成前必须：

1. 运行该阶段文档列出的精确命令；
2. 所有新测试先观察到预期失败，再观察到通过；
3. 运行 pnpm typecheck 和 pnpm check:architecture；
4. 更新 equivalence-matrix.yaml 中该阶段已覆盖的 EQ 证据；
5. 运行受影响的 E2E 主路径和恢复路径；
6. 检查日志、fixture、snapshot 中没有真实用户内容或密钥；
7. 独立 commit，commit message 使用阶段计划指定文本；
8. Reviewer 可以单独拒绝该任务而不破坏已批准的前序任务。

## 7. 统一测试命令

~~~powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm check:architecture
pnpm check:contracts
pnpm test:unit
pnpm test:repository
pnpm test:integration
pnpm test:e2e
pnpm test:recovery
pnpm test:performance
pnpm build
pnpm verify
~~~

Windows PowerShell 是计划中的命令环境。测试代码不得使用固定 D:\workspace 路径，应从临时目录和 process.cwd() 解析。

## 8. 纵向交付检查点

### Checkpoint A：工程能跑

阶段 01 完成后：

- pnpm install --frozen-lockfile 可复现；
- web、server、launcher、contracts、ui、test-kit 均能 typecheck/build；
- GET /api/v1/runtime/live 返回确定合同；
- React 显示本地服务状态；
- 依赖违规和缺失 EQ 编号会让 CI 失败。

### Checkpoint B：基础设施可恢复

阶段 02 完成后：

- LocalFile 事务崩溃可前滚；
- 幂等结果、聚合和 outbox 同事务；
- event log 可追加、校验和重放；
- projection 可重建；
- GenerationTask 可排队、join/reject、恢复；
- Mock Provider 经 SSE 逐 delta 输出。

### Checkpoint C：第一条业务闭环

阶段 03–04 完成后：

- 用户从主题输入到创建正式课程；
- 用户从开始课节到最终 Review 和 CompletionFact；
- 失败/断线/重启不破坏会话或 Review；
- 课程满足条件后关闭并生成课程总 Review。

### Checkpoint D：事实与画像闭环

阶段 05–06 完成后：

- 排期、历史、统计、日历使用同一事实投影；
- 全部学习统计同步进入全局档案；
- 候选证据去重、净化并保留来源组；
- 画像版本通过复合证据验证后提交。

### Checkpoint E：可发布

阶段 07–08 完成后：

- Launcher、自愈、密钥、版本同步可用；
- portable ZIP 可在干净 Windows 11 启动；
- backup/restore/migration drill 通过；
- 73 个 EQ 编号均有六类证据；
- 容量、性能、安全和发布检查全部通过。

## 9. 不进入本计划的范围

- 登录、多用户、云同步；
- 旧数据运行时兼容；
- 通用附件/网页/知识库；
- 跨机器可移植加密备份；
- 数据库 Adapter 的生产实现；
- 微服务和外部消息队列；
- 最终 Review 或课程总 Review 的编辑、纠错、成功后重生成；
- 画像候选反馈/拒绝组件；
- Service Worker 和 PWA 离线写入。

这些能力未来必须先更新规格和架构，不能在当前任务中顺手加入。

## 10. 完成定义

全部八份阶段计划完成且满足：

- 五部分架构的每条显式要求有代码和测试证据；
- 73 条 EQ 矩阵无缺项；
- 191 个 dataKey 注册表可验证且语义版本一致；
- 所有构建、测试、恢复和发布命令在干净 Windows 11 环境成功；
- 可从 portable ZIP 启动；
- 可从已验证快照恢复；
- 没有未解释的 skipped/flaky 测试；
- PROJECT_CONTEXT.md 更新为“实现基线已建立”。

只有上述条件全部成立，项目程序架构目标才可视为完成。
