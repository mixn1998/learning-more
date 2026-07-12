# Learning MORE 程序架构设计

> 状态：正式批准稿  
> 日期：2026-07-13  
> 适用阶段：绿地 MVP 实现  
> 权威工作目录：D:\workspace\Growth OS\Learning MORE\docs\架构方案
> 配套执行文档：[Learning MORE 详细实施计划](<./Learning MORE 详细实施计划.md>)

## 1. 文档目标

本文把已经确认的产品规则转化为可实施、可测试、可恢复的程序架构，覆盖：

1. 系统架构和 Monorepo；
2. Module 与 Interface；
3. 命令、查询、事件、错误、HTTP 和流式 Markdown 合同；
4. 文件数据、schema、索引、迁移、投影和一致性恢复；
5. AI 任务调度、Provider adapter、全局学习档案与证据管线；
6. 本地启动、端口、进程身份、自愈和密钥；
7. 测试、构建、发布、备份和损坏恢复。

详细产品不变量仍以以下文档为准：

- [PROJECT_CONTEXT.md](../../PROJECT_CONTEXT.md)
- [CONTEXT.md](../../CONTEXT.md)
- [基础模块功能等价清单与回归基线](../基础模块功能等价清单与回归基线.md)
- [历史统计与学习画像数据源定义清单](../历史统计与学习画像数据源定义清单.md)
- [学习画像数据抓取与分析策略规则](../学习画像数据抓取与分析策略规则.md)
- [课程创建通用流程与功能逻辑规则](../课程创建通用流程与功能逻辑规则.md)
- [课程学习与 Review 功能逻辑规则](<../课程学习与 Review 功能逻辑规则.md>)

若本文与最新专项产品规格冲突，应先修改专项规格和领域词汇，再修改本文；不得仅在代码中改变语义。

## 2. 已冻结假设

MVP 正式冻结为：

- 单用户；
- 仅本机访问；
- 本地优先；
- 无登录；
- 无云同步；
- 不兼容旧项目数据目录；
- 前后端统一 TypeScript；
- React + Vite 前端；
- Node.js 后端；
- Windows 11 x64 为正式发布平台；
- 当前及上一主版本 Chromium/Edge 为正式浏览器目标。

未来多用户、登录或云同步不得以隐含字段提前进入 MVP。未来扩展时，应替换应用身份解析和持久化分区策略，而不是改写课程、课节、Review 和画像证据语义。

## 3. 核心架构决策

### 3.1 选择事务优先的模块化单体

采用：

- 单个 Node.js 模块化后端；
- 领域聚合文件作为当前状态权威来源；
- 追加事实事件用于投影、审计和增量处理；
- 持久化 outbox 连接领域事务与事件日志；
- Repository 和 AI Provider 作为正式 seam；
- 进程内事件分发只有一种实现，不建立通用事件总线 seam。

### 3.2 未选择完整事件溯源

事件日志不是唯一事实源。完整事件溯源会把事件演进、快照、迁移和调试复杂度提前引入 MVP。当前架构只要求：

- 当前聚合可以直接、强一致读取；
- 历史事实可以追加审计；
- 分析型读模型可以重放；
- outbox 失败可以恢复。

### 3.3 未选择传统通用 CRUD 分层

HTTP 路由不得直接操作 Repository。课程状态机、幂等、Review 不可变、任务恢复、投影和证据去重必须隐藏在深 Module 内，而不是分散在路由和页面。

### 3.4 一致性分层

| 数据 | 一致性 |
| --- | --- |
| 当前 Course、Lesson、Session、Review、Schedule | 强一致 |
| 命令幂等结果和 outbox | 与领域写入同事务 |
| CourseSummary 等操作型投影 | 随主事务同步更新 |
| 历史、统计、日历、全局学习档案 | 按事件游标最终一致 |
| 画像候选证据和画像版本 | 按稳定检查点与冻结输入异步生成 |

## 4. 系统架构

~~~mermaid
flowchart TD
    UI["React Web"] --> CT["共享传输合同"]
    CT --> HTTP["HTTP / SSE Adapter"]
    HTTP --> NODE["Node.js 模块化单体"]

    NODE --> CA["CourseAuthoring"]
    NODE --> LS["LearningSession"]
    NODE --> RC["ReviewClosure"]
    NODE --> PL["Planning"]
    NODE --> LF["LearningFacts"]
    NODE --> PE["ProfileEvidence"]
    NODE --> LP["LearningPortrait"]
    NODE --> GR["GenerationRuntime"]

    CA & LS & RC & PL & LF & PE & LP & GR --> RP["Repository Interface"]
    GR --> AP["AI Provider Interface"]

    RP --> FILE["LocalFile Adapter"]
    RP -.未来.-> DB["Database Adapter"]
    AP --> MOCK["Mock"]
    AP --> API["API-compatible"]
    AP --> CLI["Codex CLI"]

    LAUNCH["Launcher / Watcher"] --> NODE
~~~

### 4.1 Monorepo

~~~text
Learning MORE/
├─ apps/
│  ├─ web/
│  │  └─ src/
│  │     ├─ app/
│  │     ├─ features/
│  │     ├─ client/
│  │     └─ assets/
│  ├─ server/
│  │  └─ src/
│  │     ├─ bootstrap/
│  │     ├─ http/
│  │     ├─ modules/
│  │     ├─ persistence/
│  │     ├─ ai-providers/
│  │     ├─ workers/
│  │     └─ runtime/
│  └─ launcher/
├─ packages/
│  ├─ contracts/
│  ├─ ui/
│  └─ test-kit/
├─ tools/
├─ docs/
│  └─ 架构方案/
├─ package.json
├─ pnpm-workspace.yaml
└─ tsconfig.base.json
~~~

不创建通用 shared、helpers 或前后端共用 domain 杂物包。前端共享的是网络传输合同，不是后端聚合实现。

### 4.2 后端 Module 目录

~~~text
modules/learning-session/
├─ interface.ts
├─ model/
├─ implementation/
├─ ports/
└─ tests/
~~~

调用者只能导入 interface.ts 和公开 DTO。Module 内部聚合、Repository port、Prompt 和文件布局均不可跨 Module 导入。

### 4.3 依赖规则

- apps/web 只能依赖 contracts、ui 和自身 feature；
- packages/ui 不依赖业务 DTO；
- 前端不得导入 Repository、聚合、Provider 或文件 schema；
- Module 之间不得导入彼此 implementation、model 或 ports；
- 跨 Module 协作只调用对方公开 Interface；
- Adapter 依赖 Interface，领域 Module 不依赖 Adapter；
- 只有 bootstrap 可以同时看见 Interface 与 Adapter；
- contracts 中 runtime schema 是网络数据的权威校验，TypeScript 类型从 schema 推导；
- GenerationRuntime 不依赖任何领域 Module；
- LearningFacts 只消费已提交事件，不反向修改聚合。

### 4.4 写命令路径

~~~text
HTTP Adapter
  → runtime schema 校验
  → 构造 CommandContext
  → 调用 Module Interface
  → 校验状态机、权限租约、幂等和 expectedVersion
  → Repository UnitOfWork
  → 原子提交聚合、幂等结果、outbox、操作型索引
  → 返回 CommandResult
  → Outbox Pump 追加事件
  → 投影器与后台任务按游标消费
~~~

AI 任务只返回持久化任务句柄。Provider 结束不等于领域提交成功；所属 Module 必须重新校验并提交结果。

## 5. Module 与 Interface

### 5.1 统一 Interface 形态

~~~ts
interface ModuleInterface<Command, Query, Result, View> {
  execute(command: Command, context: CommandContext): Promise<Result>;
  query(query: Query, context: QueryContext): Promise<View>;
}
~~~

这只是统一调用约定，不是通用 CRUD 基类。每个 Module 拥有自己的命令联合、查询联合、结果、不变量、错误和性能承诺。

### 5.2 CourseAuthoring

拥有：

- OutlineSession、OutlineMessage、OutlineCandidate；
- Course、OutlineVersion、LessonDefinition；
- 阅读材料引用和解析快照；
- 大纲发布、课程关闭状态和课程总 Review 引用。

用户命令：

- CreateOutlineSession
- SendOutlineMessage
- PauseOutlineSession
- AbandonOutlineSession
- GenerateOutlineCandidate
- ConfirmOutlineCandidate
- CreateOutlineAdjustmentSession
- PublishOutlineRevision
- CloseCourse

内部命令：

- EvaluateAutomaticCourseClosure
- CommitCourseReview
- MarkCourseReviewFailed

查询：

- GetOutlineSession
- ListResumableOutlineSessions
- GetCourseStructure
- GetOutlineVersion
- ListOutlineVersions
- GetCourseArchive

它隐藏候选替代、Markdown 编译、原子确认、旧课节版本保护、关闭资格、课程总 Review 不可变和材料解析分流。

### 5.3 LearningSession

拥有：

- LessonProgress；
- 原始和补充 LessonSession；
- 只追加消息；
- 写入权租约；
- 学习计时区间；
- evidenceCheckpoint；
- LessonReview 正文及引用；
- LessonClosingIntent；
- CompletionFact。

用户命令：

- StartLesson
- SendLessonMessage
- PauseLessonSession
- ResumeLessonSession
- TakeOverLessonSession
- StopGeneration
- AbandonLesson
- RestoreAbandonedLesson
- StartSupplementarySession
- ArchiveSupplementarySession

供 ReviewClosure 使用的内部命令：

- BeginLessonClosure
- CommitStageReview
- CommitFinalReview
- AbortLessonClosure

查询：

- GetLessonEntry
- GetLessonSession
- GetLessonArchive
- GetLessonProgress
- GetWriteLease
- ListPendingClosures

CommitFinalReview 必须在一个事务内写入最终 Review、完成课节、关闭计时和结束意图、产生 CompletionFact 并写 outbox。

补充学习始终创建独立 SupplementarySession，只追加自身消息。它不得修改原始会话、最终课时 Review、CompletionFact 或课程总 Review，也不得成为其他课节默认继承上下文。

### 5.4 ReviewClosure

ReviewClosure 是持久化工作流 Module，不是第二个 Lesson 或 Course 聚合所有者。

命令：

- FinalizeLesson
- RetryFinalReview
- ResumeClosingLesson
- RequestStageReview
- RequestCourseReview
- RetryCourseReview
- RecoverPendingClosures

查询：

- GetLessonClosureStatus
- GetCourseReviewStatus

它负责冻结输入快照、稳定任务键、重启恢复、生成任务、结果校验和调用数据所有者提交。它不能直接把 Provider 输出写入 Review 文件。

### 5.5 Planning

拥有 ScheduleAssignment、排期变更历史、PlanFlow、预览快照、锁定、超目标和取消原因。

命令：

- PreviewPlanFlow
- ConfirmPlanFlow
- AssignLesson
- ChangeSchedule
- CancelSchedule
- PausePlanFlow
- ResumePlanFlow
- ReplanFlow
- DeletePlanFlow

查询：

- GetLearningSchedule
- GetPlanningPool
- GetPlanFlow
- ListPlanFlows

它隐藏课程内顺序、不拆课、学习日搜索、超目标、锁定保护、放弃取消和批量原子性。

### 5.6 LearningFacts

拥有：

- 追加学习事件日志；
- 投影游标和完整性；
- CourseSummary、历史、统计、日历和全局事实层读模型；
- 统计口径版本；
- 周报事实快照和周键。

内部命令：

- AppendOutboxBatch
- AdvanceProjection
- RebuildReadModel
- ReconcileProjection
- GenerateWeeklyReport
- RetryWeeklyReport

查询：

- GetCourseSummary
- GetLearningHistory
- GetLearningHistoryStats
- GetLearningCalendar
- GetGlobalProfileFacts
- GetWeeklyReport
- GetProjectionHealth

历史统计、日历和全局学习档案必须复用同一事实公式。

### 5.7 ProfileEvidence

拥有证据检查点、PortraitEvidence、sourceGroup、去重、supersede、安全状态、evidence backlog 和 Evidence Packer 临时工作区。

内部命令：

- CaptureEvidenceCheckpoint
- ExtractEvidenceCandidates
- RetryEvidenceExtraction
- SupersedeEvidence
- RevalidateEvidenceSafety
- PackPortraitEvidence

查询：

- GetEvidenceBacklog
- GetEvidenceCompleteness
- GetPortraitEvidenceManifest

检查点允许产生零条候选。来源独立性和派生产物去重由程序校验，不只依赖 Prompt。

### 5.8 LearningPortrait

拥有 PortraitInputManifest、画像任务、成功版本、当前版本指针和消费游标。

命令：

- RequestPortraitRefresh
- CancelPortraitRefresh
- RetryPortraitRefresh
- CommitPortraitVersion

查询：

- GetCurrentPortrait
- GetPortraitGenerationStatus
- ListPortraitVersions

成功写入新画像版本后才推进消费游标；失败、取消和超时保留上一成功版本。

### 5.9 GenerationRuntime

~~~ts
interface GenerationRuntime {
  submit(request: GenerationRequest): Promise<GenerationTaskHandle>;
  cancel(command: CancelGenerationTask): Promise<GenerationTaskState>;
  get(query: GetGenerationTask): Promise<GenerationTaskView>;
  observe(query: ObserveGenerationTask): AsyncIterable<GenerationStreamEvent>;
  validateProvider(command: ValidateProvider): Promise<ProviderValidation>;
  switchProvider(command: SwitchProvider): Promise<ProviderStatus>;
  getProviderStatus(): Promise<AiRuntimeStatusReadModel>;
}
~~~

GenerationRuntime 只生成规范化输出，不提交课程、课节、Review、证据或画像。

### 5.10 RuntimeControl

RuntimeControl 是平台 Module，拥有运行配置解析、进程身份、健康、自愈状态和安全诊断，不拥有学习领域数据。

~~~ts
interface RuntimeControl {
  getStatus(): Promise<RuntimeStatus>;
  reconnect(command: ReconnectRuntime): Promise<RecoveryRun>;
  syncFrontend(command: SyncFrontendVersion): Promise<VersionSyncResult>;
  diagnose(command: DiagnoseRuntime): Promise<SanitizedDiagnostic>;
}
~~~

它只能启动、停止或诊断经过完整身份验证的 Learning MORE 进程，不能提供任意命令执行或文件浏览。

### 5.11 Repository Interface

MVP 至少定义：

- CourseRepository
- OutlineSessionRepository
- LessonDefinitionRepository
- LessonSessionRepository
- ReviewRepository
- CourseReviewRepository
- LearningTimeRepository
- WriteLeaseRepository
- ClosingIntentRepository
- LearningEventRepository
- ScheduleRepository
- PlanFlowRepository
- MaterialRepository
- PortraitEvidenceRepository
- GlobalLearningProfileRepository
- PortraitRepository
- GenerationTaskRepository
- WeeklyReportRepository
- RuntimeManifestRepository
- IdempotencyRepository

不使用通用 Repository<T> 暴露 CRUD。每个 Repository Interface 必须写明聚合粒度、expectedVersion、幂等、事务参与方式、不可变规则、错误和性能承诺。

UnitOfWork 协调同一命令需要的多个 Repository。InMemory Adapter 和 LocalFile Adapter 从第一阶段共同运行合同测试，因此 Repository 是已存在两种 Adapter 的真实 seam；未来 Database Adapter 必须通过相同合同套件。

CourseAuthoring 内部使用 MaterialParser port 分流 PDF、TXT 和 Markdown 解析，但在第二种通用资料来源真正出现前，不抽象通用附件框架。

### 5.12 Module 依赖

~~~mermaid
flowchart LR
    RC["ReviewClosure"] --> LS["LearningSession"]
    RC --> CA["CourseAuthoring"]
    RC --> GR["GenerationRuntime"]
    CA --> GR
    LS --> GR
    PL["Planning"] --> EL["Course/Lesson eligibility read ports"]
    LF["LearningFacts"] --> EV["Committed learning events"]
    PE["ProfileEvidence"] --> LF
    PE --> GR
    LP["LearningPortrait"] --> LF
    LP --> PE
    LP --> GR
~~~

LearningSession 不调用 ReviewClosure。放弃和结束事实通过事务/outbox 驱动关闭工作流，从而避免循环依赖。

## 6. 共享合同

### 6.1 命令

~~~ts
type CommandMetadata = {
  idempotencyKey: string;
  expectedVersion?: number;
  pageInstanceId?: string;
  requestedAt: string;
};

type CommandContext = CommandMetadata & {
  commandId: string;
  correlationId: string;
  actor: "local-user";
  receivedAt: string;
};

type CommandResult<T> = {
  commandId: string;
  outcome: "completed" | "accepted";
  value: T;
  resourceVersion?: number;
  task?: GenerationTaskHandle;
  projectionCursor?: string;
};
~~~

同一幂等键和相同输入返回原结果；相同幂等键配不同输入返回 idempotency_conflict。accepted 只表示任务已持久化。

### 6.2 查询

~~~ts
type ReadModelMetadata = {
  schemaVersion: number;
  resourceVersion?: number;
  projectedThrough?: string;
  completeness: "complete" | "degraded" | "rebuilding";
  generatedAt: string;
};
~~~

degraded 必须携带缺失范围，重建期间可以返回上一完整快照，但不得伪装为当前完整数据。

### 6.3 事件

~~~ts
type LearningEventEnvelope<T> = {
  id: string;
  schema_version: number;
  type: string;
  occurred_at: string;
  recorded_at: string;
  source: string;
  target_refs: Record<string, string>;
  payload: T;
  idempotency_key: string;
  correlation_id: string;
};
~~~

事件名称使用过去式；长 Markdown 只写 Artifact 引用和哈希；历史事件不原地改义。

核心学习事实事件：

- OutlineSessionCreated
- CourseCreated
- OutlineVersionConfirmed
- LessonSessionStarted
- LessonSessionPaused
- LessonAbandoned
- LessonRestored
- LessonClosingRequested
- ReviewCreated
- ReviewFinalized
- LessonSessionCompleted
- InteractionPrompted
- InteractionResponded
- InteractionSkipped
- RecommendedLessonChanged
- SupplementarySessionArchived
- CourseClosed
- CourseReviewFinalized
- SchedulePlanned
- ScheduleChanged
- ScheduleCancelled
- PlanFlowCreated
- PlanFlowPaused
- PlanFlowResumed
- PlanFlowReplanned
- PlanFlowDeleted

PortraitEvidenceExtracted 和 PortraitVersionCommitted 属于数据管线事件。Provider、延迟、错误、网络、页面访问和写入权竞争属于运行遥测。二者均不得冒充学习事实进入画像。

### 6.4 错误

~~~ts
type ApplicationProblem = {
  type: string;
  status: number;
  code: string;
  messageKey: string;
  retryable: boolean;
  correlationId: string;
  fieldErrors?: Record<string, string>;
  currentVersion?: number;
  recovery?: {
    action:
      | "retry"
      | "refresh"
      | "reconnect_ai"
      | "take_over_lease"
      | "resume_learning"
      | "return_home";
    resourceRef?: string;
  };
};
~~~

HTTP 映射：

| HTTP | 语义 |
| --- | --- |
| 400 | schema 或字段错误 |
| 404 | 资源不存在 |
| 409 | 状态机、幂等或任务键冲突 |
| 412 | expectedVersion 不匹配 |
| 423 | 会话写入权不在当前窗口 |
| 429 | 生成容量达到上限 |
| 503 | AI Provider 或本地依赖不可用 |
| 500 | 无法安全恢复的存储或内部错误 |

必须稳定的错误码包括：

- topic_required
- message_required
- session_not_found
- session_closed
- candidate_invalid
- candidate_stale
- confirmation_in_progress
- confirmation_failed
- version_conflict
- idempotency_conflict
- lesson_not_startable
- lesson_not_restorable
- lesson_not_closable
- write_lease_lost
- final_review_immutable
- course_not_closable
- course_closed
- generation_in_progress
- generation_capacity_exceeded
- generation_cancelled
- generation_timeout
- ai_unavailable
- provider_validation_failed
- projection_incomplete
- storage_corrupted

错误码不直接显示；前端通过 messageKey 获取本地化文案。

## 7. HTTP 与流式 Markdown

### 7.1 HTTP

基础路径为 /api/v1，发布版前后端同源。不提供通用 command 或 query 端点。

~~~text
POST /api/v1/outline-sessions
GET  /api/v1/outline-sessions/{sessionId}
POST /api/v1/outline-sessions/{sessionId}/messages
POST /api/v1/outline-sessions/{sessionId}/candidate-generations
POST /api/v1/outline-sessions/{sessionId}/confirmations

GET  /api/v1/courses/{courseId}
POST /api/v1/courses/{courseId}/outline-revisions
POST /api/v1/courses/{courseId}/closures

POST /api/v1/lessons/{lessonId}/sessions
GET  /api/v1/lesson-sessions/{sessionId}
POST /api/v1/lesson-sessions/{sessionId}/messages
POST /api/v1/lesson-sessions/{sessionId}/pauses
POST /api/v1/lesson-sessions/{sessionId}/lease-transfers
POST /api/v1/lessons/{lessonId}/abandonments
POST /api/v1/lessons/{lessonId}/restorations
POST /api/v1/lessons/{lessonId}/closures

POST /api/v1/plan-flow-previews
POST /api/v1/plan-flows
GET  /api/v1/schedule

GET  /api/v1/history/stats
GET  /api/v1/history/calendar
GET  /api/v1/portrait
~~~

写命令要求：

- Idempotency-Key；
- 版本化写入要求 If-Match；
- 会话写入权操作要求 X-Page-Instance-Id；
- X-Correlation-Id 可选，缺失时服务端生成。

### 7.2 SSE

采用 POST 命令 + SSE 下行流，不使用 WebSocket。

~~~text
GET /api/v1/generation-tasks/{taskId}/events
Last-Event-ID: {taskId}:{sequence}
~~~

事件：

- task.snapshot
- message.started
- message.delta
- message.completed
- artifact.ready
- task.progress
- task.completed
- task.failed
- task.cancelled
- heartbeat

~~~ts
type GenerationStreamEvent = {
  taskId: string;
  sequence: number;
  emittedAt: string;
  type: string;
  data: unknown;
};
~~~

保证：

- sequence 单任务严格递增；
- Last-Event-ID 可补发；
- 重复事件可安全去重；
- message.delta 只能追加；
- delta 不保证完整 Markdown 边界；
- message.completed 后重新获取权威消息；
- artifact.ready 只在领域提交完成后发出；
- 断线不取消任务；
- 显式停止保存 interrupted；
- 技术失败保存 failed_recoverable；
- 心跳间隔 15 秒；
- 未完成任务 journal 持久化，终态后压缩。

## 8. 文件数据架构

### 8.1 权威数据层次

~~~text
领域聚合状态
  ↓ 原子事务 + outbox
追加学习事件
  ↓ 确定性投影
统计事实与读模型
  ↓ 稳定语义检查点
画像候选证据
  ↓ 冻结输入清单
不可变画像版本
~~~

聚合是当前业务状态；事件是历史事实；读模型可重建；候选证据是局部观察；画像版本是冻结输入的不可变分析结果。

### 8.2 数据根

正式数据不放在源码仓库中。

~~~text
data-root/
├─ store.json
├─ locks/
├─ transactions/
│  ├─ prepared/
│  └─ committed/
├─ idempotency/
├─ entities/
│  ├─ outline-sessions/
│  ├─ courses/
│  ├─ lesson-progress/
│  ├─ lesson-sessions/
│  ├─ reviews/
│  ├─ course-reviews/
│  ├─ schedules/
│  ├─ plan-flows/
│  ├─ materials/
│  └─ weekly-reports/
├─ outbox/
│  ├─ pending/
│  └─ receipts/
├─ events/
│  ├─ segments/
│  └─ event-log.json
├─ tasks/
│  ├─ queued/
│  ├─ active/
│  ├─ terminal/
│  └─ journals/
├─ indexes/
├─ read-models/
├─ global-profile/
│  ├─ fact-metrics/
│  ├─ time-series/
│  ├─ artifact-index/
│  └─ cursors/
├─ portrait-evidence/
├─ portraits/
├─ work/
└─ quarantine/
~~~

ID 使用类型前缀 UUIDv7。实体目录从第一版按 SHA-256(id) 前两位分片。文件名不得包含课程名、标签或用户文本。

### 8.3 StoreManifest

~~~ts
type StoreManifest = {
  storeId: string;
  formatVersion: number;
  minimumReaderVersion: number;
  createdAt: string;
  lastCommittedTransactionId: string;
  lastCommittedSequence: number;
  timezone: string;
  checksumAlgorithm: "sha256";
};
~~~

### 8.4 聚合文档

~~~ts
type AggregateDocument<T> = {
  schema: string;
  schemaVersion: number;
  entityType: string;
  entityId: string;
  resourceVersion: number;
  createdAt: string;
  updatedAt: string;
  contentSha256: string;
  data: T;
};
~~~

读取依次验证 JSON、runtime schema、路径与 ID、checksum、resourceVersion 和引用合法性。

### 8.5 Markdown Artifact

对话消息、候选大纲、确认版大纲、Review、课程总 Review、周报和画像正文使用元数据 JSON + Markdown。

~~~ts
type MarkdownArtifact = {
  schemaVersion: number;
  artifactId: string;
  kind:
    | "outline-candidate"
    | "outline-version"
    | "conversation-message"
    | "lesson-review"
    | "course-review"
    | "weekly-report"
    | "portrait-summary"
    | "portrait-insight";
  ownerRefs: Record<string, string>;
  contentFile: "content.md";
  contentSha256: string;
  sourceSnapshotHash?: string;
  completionStatus:
    | "complete"
    | "interrupted"
    | "failed_recoverable";
  immutable: boolean;
  createdAt: string;
  finalizedAt?: string;
};
~~~

正文先写 staging，checksum 验证后替换。阶段 Review 可原子替换同一 reviewId；最终 Review 和课程总 Review 一旦 immutable=true，Repository 永久拒绝覆盖。

### 8.6 会话消息

~~~text
lesson-sessions/{sessionId}/
├─ session.json
├─ messages/
│  ├─ 000001_{messageId}/artifact.json
│  ├─ 000001_{messageId}/content.md
│  └─ 000002_{messageId}/...
└─ stream-state.json
~~~

流式回复每累计 4 KiB 或 250 ms 原子刷新工作副本。会话顺序由持久化 sequence 决定。完成消息不可修改；技术续接只能更新同一 failed_recoverable 消息。

### 8.7 文件事务

1. 获取进程内写锁和数据目录 OS 锁；
2. 校验 expectedVersion；
3. 在 prepared 事务目录写入新文件；
4. 写操作清单和 checksum；
5. fsync staging 和事务清单；
6. 逐个执行同目录原子替换；
7. 最后更新 store.json 的提交事务和 sequence；
8. 写 committed marker；
9. 释放锁；
10. 异步清理 staging。

事务清单包含聚合、Artifact、幂等结果、outbox 和操作型索引。服务在事务恢复完成前不接受业务请求。崩溃后幂等向前完成，不猜测回滚。

### 8.8 索引

权威辅助索引包括幂等键、当前任务键和唯一会话引用，随主事务提交。课程课节关系、排期日期、活跃大纲会话、Artifact 来源和读模型索引均可重建。

~~~ts
type IndexManifest = {
  indexName: string;
  schemaVersion: number;
  sourceCursor?: string;
  entryCount: number;
  contentSha256: string;
  rebuiltAt: string;
};
~~~

损坏的可重建索引直接隔离并重建，不能用索引覆盖聚合。

### 8.9 Schema 与迁移

- JSON、事件、索引和读模型各自版本化；
- formatVersion 表示整套数据目录格式；
- 应用低于 minimumReaderVersion 时拒绝写入；
- 历史事件通过 upcaster 兼容读取，不原地重写；
- dataKey 不兼容变更创建新键；
- 不可变 Markdown 不因元数据升级而改写；
- 写入型迁移前创建并验证备份；
- 迁移在 staging 完成后切换；
- 迁移日志记录输入/输出版本、文件数量和 checksum；
- 提供 migrate --dry-run、migrate、verify-store；
- 迁移失败继续使用旧数据根。

## 9. 事件、投影与一致性恢复

### 9.1 Outbox

~~~text
领域事务
  ├─ 聚合状态
  ├─ 幂等结果
  └─ outbox 事件意图
        ↓
Outbox Pump
        ↓
追加事件日志并 fsync
        ↓
receipt
        ↓
投影器消费
~~~

事件日志采用带全局 offset 和 record checksum 的分段 JSONL。单段最大 32 MiB；完成段永久只读；当前段只有一个写入者。活动段尾部损坏时截断至最后有效记录，并从 outbox 重放。

### 9.2 ProjectionCheckpoint

~~~ts
type ProjectionCheckpoint = {
  projectionName: string;
  projectionVersion: number;
  status: "ready" | "catching_up" | "rebuilding" | "degraded";
  lastEventOffset: number;
  lastEventId?: string;
  outputSha256: string;
  updatedAt: string;
};
~~~

投影器必须是确定性的：旧读模型 + 已排序事件批次 → 新读模型 + 新游标。

### 9.3 重建

1. 记录当前事件高水位；
2. 在独立 rebuild 目录从 offset 0 重放；
3. 校验公式、样本量、排除项和 checksum；
4. 消费高水位后的事件；
5. 追平后原子切换 current pointer；
6. 新快照验证完成前保留旧快照。

一致性检查器核对 outbox/receipt、event offset、resourceVersion、最终 Review/completed、CompletionFact、投影游标和画像游标。

不得自动修复不可变领域正文。自动修复仅限 outbox 补写、索引重建、投影重放和任务恢复。

### 9.4 损坏分级

| 损坏对象 | 恢复 |
| --- | --- |
| 索引 | 从聚合重建 |
| 读模型 | 从事件日志重放 |
| outbox receipt | 对照事件 ID 重建 |
| 活动事件段尾部 | 截断并重放 outbox |
| 任务 journal | 从任务和领域快照恢复 |
| 聚合 JSON | 从已验证备份恢复 |
| 不可变 Markdown | 按 checksum 从备份恢复 |
| 历史事件段 | 必须从备份恢复 |

历史事件无法恢复时，当前聚合仍可只读，但受影响统计和全局档案标记 degraded，禁止生成声称完整的画像，也不得根据当前状态伪造历史。

## 10. AI 任务架构

### 10.1 GenerationTask

~~~ts
type GenerationTaskKind =
  | "outline_reply"
  | "outline_candidate"
  | "lesson_reply"
  | "stage_review"
  | "final_review"
  | "course_review"
  | "evidence_extract"
  | "portrait"
  | "weekly_report";

type GenerationAttempt = {
  attemptNumber: number;
  providerId: string;
  model: string;
  promptId: string;
  promptVersion: string;
  state: "running" | "completed" | "failed" | "cancelled" | "timeout";
  startedAt: string;
  firstDeltaAt?: string;
  endedAt?: string;
  outputRef?: string;
  errorCode?: string;
};

type GenerationTask = {
  taskId: string;
  taskKey: string;
  taskKind: GenerationTaskKind;
  taskGroup: string;
  ownerRef: string;
  inputSnapshotRef: string;
  inputSnapshotHash: string;
  state:
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "cancelled"
    | "timeout";
  priority: number;
  attempts: GenerationAttempt[];
  providerPolicyRef: string;
  resultRef?: string;
  errorCode?: string;
  createdAt: string;
  updatedAt: string;
};
~~~

稳定任务键：

~~~text
outline-reply:{sessionId}:{messageHeadId}
outline-candidate:{sessionId}:{snapshotHash}
lesson-reply:{sessionId}:{messageHeadId}
stage-review:{reviewId}:{snapshotHash}
final-review:{reviewId}:{closingSnapshotHash}
course-review:{courseReviewId}:{closingSnapshotHash}
evidence-extract:{sourceGroupId}:{snapshotHash}:{extractorVersion}
portrait:{profileId}:{inputManifestHash}
weekly-report:{localWeekKey}:{factSnapshotHash}
~~~

相同任务键和输入 join；已成功返回原结果；显式重试在同一逻辑任务追加 attempt。相同幂等键配不同快照返回冲突。

### 10.2 并发

- 真实 Provider 全局最多两个并发调用；
- 至少保留一个槽给交互式任务；
- 后台任务最多占用一个槽；
- 同一 OutlineSession/LessonSession 最多一个交互任务；
- 同一 Review、课程总 Review或画像最多一个任务；
- Mock Provider 最多八个并发；
- 实际上限取系统与 Provider capability 的较小值。

优先级：

| 等级 | 任务 |
| --- | --- |
| 100 | 学习和建档对话 |
| 80 | 阶段/最终/课程总 Review |
| 60 | 用户手动画像、周报重试 |
| 40 | 候选证据、计划任务 |
| 20 | 自动画像、维护 |

每排队一分钟增加一个 aging point，最高 95。

Worker 租约为 30 秒，每 10 秒续约。无输出任务在租约过期后回到 queued；有部分输出的交互任务转 failed_recoverable；Review 和画像继续使用原输入快照。

### 10.3 超时和重试

- 首个 Provider 字节：45 秒；
- 流空闲：90 秒；
- 交互任务最大 20 分钟；
- Review、画像、证据任务最大 30 分钟。

自动重试只允许在无有效 delta 前、最多一次、且错误明确为临时传输失败。产生内容后不得静默切换 Provider 续写。

### 10.4 Provider seam

~~~ts
interface AiProvider {
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

正式 Adapter：

- MockProviderAdapter
- ApiCompatibleProviderAdapter
- CodexCliProviderAdapter

运行 attempt 固定实际 Provider、模型和 Prompt 版本。运行中任务不受 Provider 切换影响；新 Provider 验证成功后才切换；fallback 只允许在首个有效 delta 前。

### 10.5 Prompt 隔离

Prompt Registry 使用 promptId + promptVersion + safetyRuleVersion。具体 Prompt、模型参数和厂商协议不得进入领域对象、HTTP 业务 DTO、学习事件、全局学习档案或前端。

## 11. 全局学习档案与画像证据

~~~mermaid
flowchart TD
    E["已提交学习事件"] --> F["LearningFacts"]
    F --> M["统计快照与时间序列"]
    S["稳定来源检查点"] --> SS["SourceSnapshot"]
    SS --> SAN["净化与范围裁剪"]
    SAN --> EX["候选证据提炼"]
    EX --> V["来源校验、来源组、去重、安全"]
    V --> CE["候选证据层"]
    M --> PM["PortraitInputManifest"]
    CE --> PM
    PM --> PACK["Evidence Packer"]
    PACK --> AI["画像生成"]
    AI --> CHECK["复合证据链校验"]
    CHECK --> PV["不可变 PortraitVersion"]
~~~

### 11.1 候选证据检查点

1. 冻结新增消息、Review 或事实范围；
2. 计算 sourceSnapshotHash；
3. 排除 interrupted、技术失败和无证据空会话；
4. 净化无关私人实体；
5. 提交候选提炼任务；
6. 允许零条结果；
7. 验证 sourceRefs；
8. 绑定 sourceGroup；
9. 按快照、提炼器版本和规范化摘要去重；
10. 原子追加候选并推进来源游标。

课程总 Review、课时 Review 和原对话的依赖关系显式保存在 sourceGroup 图中。补充学习拥有独立会话来源，但必须记录对原课节来源组的依赖，不能被误当成完全独立课程证据。

### 11.2 PortraitInputManifest

每次画像生成冻结：

- metricKey 和 definitionVersion；
- 累计、日/周/月序列；
- 近期、中期、长期窗口；
- 事实投影游标；
- 有效候选证据；
- sourceGroup 依赖；
- Artifact 引用；
- 完整性、样本量和排除项；
- evidence backlog；
- 上一画像版本；
- Prompt、模型和安全规则版本；
- 临时原文引用和净化版本。

冻结后新数据留给下一次画像刷新。

### 11.3 Evidence Packer

先读取统计和候选摘要，再按清单精确读取少量原文。单条、来源组和总输入均有限额；默认只在内存存在；必须落盘时使用受限 work 目录；任务结束或启动恢复时删除。

洞察提交前确定性验证：

- 至少两个独立来源组；
- 跨课节、课程或明确时间窗口；
- evidence ID 属于 manifest；
- 限制性和反向证据检查已执行；
- 不含敏感身份、健康、心理、政治或宗教推断；
- 不由单项统计或单次行为直接升级。

## 12. 本地运行架构

### 12.1 运行拓扑

一键重连要求应用后端失效时仍有控制进程，因此包含 Launcher 和 Server 两个本地进程。

~~~mermaid
flowchart LR
    B["浏览器"] --> APP["应用后端 127.0.0.1:43120"]
    B --> CTRL["Launcher 控制面 127.0.0.1:43119"]
    CTRL --> APP
    APP --> DATA["本地数据"]
    APP --> AI["AI Provider"]
~~~

Launcher 失效时，浏览器不能凭空创建本机进程，必须提示重新运行启动入口。

### 12.2 端口

| 用途 | 默认地址 |
| --- | --- |
| Launcher 控制面 | 127.0.0.1:43119 |
| 应用后端 | 127.0.0.1:43120 |
| Vite 开发 | 127.0.0.1:5173 |
| 自动化测试 | OS 临时端口 |

只监听 127.0.0.1；不扫描、不静默漂移、不强杀外部端口所有者。file:// 页面只显示启动说明。

### 12.3 应用目录

~~~text
%LOCALAPPDATA%\Learning MORE\
├─ config/runtime.json
├─ runtime/
├─ data/
├─ secrets/
├─ logs/
└─ backups/
~~~

源码/安装目录、数据目录和运行目录分离。

### 12.4 配置

配置优先级为命令行 > 环境变量 > runtime.json > 构建默认。唯一 RuntimeConfigResolver 解析配置；未知字段或非法值报错；fingerprint 不含密钥；无效新配置不得替换旧健康实例。

~~~ts
type RuntimeConfig = {
  host: "127.0.0.1";
  controlPort: number;
  serverPort: number;
  dataRoot: string;
  backupRoot: string;
  logLevel: "error" | "warn" | "info" | "debug";
  projectionConcurrency: number;
  providerConfigRefs: string[];
  activeProviderId: string;
};
~~~

### 12.5 进程身份

~~~ts
type RuntimeManifest = {
  schemaVersion: number;
  manifestGeneration: number;
  instanceId: string;
  pid: number;
  parentPid: number;
  host: "127.0.0.1";
  port: number;
  controlPort: number;
  projectRoot: string;
  dataRootHash: string;
  executablePath: string;
  executableSha256: string;
  configFingerprint: string;
  buildId: string;
  protocolVersion: number;
  phase: "listening" | "recovering" | "ready" | "draining";
  startedAt: string;
  updatedAt: string;
};
~~~

健康检查必须同时匹配 instanceId、PID/端口所有者、executable、projectRoot、dataRootHash、configFingerprint、buildId 和 protocolVersion。旧实例只能删除与自身 instanceId + generation 匹配的 manifest。

### 12.6 启动

1. Launcher 解析配置并获取单实例锁；
2. 校验已有 manifest、PID、端口和健康身份；
3. 复用完全匹配的健康实例；
4. 隔离已确认失效的 manifest；
5. 未知端口占用则停止；
6. 隐藏窗口启动 Server；
7. Server 监听后写 listening；
8. 获取数据锁并恢复事务/outbox/任务；
9. 校验关键索引和 schema；
10. 写 ready；
11. 打开正确 URL。

ready 前只响应健康和诊断，业务请求返回 runtime_not_ready。

### 12.7 健康与自愈

~~~text
GET /api/v1/runtime/live
GET /api/v1/runtime/ready
GET /api/v1/runtime/identity
GET /api/v1/runtime/data-health
GET /api/v1/ai-runtime/status
~~~

本地服务健康与 AI 健康分开。

Launcher 状态：

~~~text
stopped → starting → healthy → degraded → restarting → backoff → healthy

异常：
blocked_external_port
blocked_invalid_config
blocked_restart_storm
blocked_data_recovery
~~~

意外退出退避为 0.5、1、2、4、8 秒；十分钟最多自动重启五次。配置变化 750 ms debounce，同批只重启一次。

受控重启停止新命令/任务、持久化游标、关闭计时区间、等待最多 10 秒、恢复未完成任务并只终止经过完整身份验证的子进程。

### 12.8 一键重连控制面

~~~text
GET  /control/v1/status
POST /control/v1/reconnect
POST /control/v1/sync-frontend
POST /control/v1/diagnose
~~~

控制面不提供任意命令、文件浏览、密钥读取、领域数据或自定义启动参数。

浏览器固定显示核验实例、重连服务、等待健康、刷新 AI 四阶段。控制面严格检查 Host、精确 Origin、自定义 header 和 Launcher 短期 capability。

### 12.9 前端版本

构建产生 buildId；前端 bootstrap、Server manifest 和协议版本必须匹配。index.html 使用 no-store，内容哈希资源使用 immutable cache，MVP 不注册 Service Worker。版本不一致时禁止写入并执行同步前端版本。

### 12.10 密钥

~~~ts
interface SecretStore {
  put(handle: string, secret: Uint8Array): Promise<void>;
  get(handle: string): Promise<Uint8Array>;
  delete(handle: string): Promise<void>;
  describe(handle: string): Promise<{
    configured: boolean;
    updatedAt?: string;
    fingerprint?: string;
  }>;
}
~~~

Windows 正式 Adapter 使用 DPAPI CurrentUser。开发/CI 提供只读 EnvironmentSecretStoreAdapter。DPAPI 的 CurrentUser 范围和完整性保护依据 [Microsoft CryptProtectData 文档](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata)。

密钥不得进入源码、runtime.json、manifest、数据目录、浏览器存储、URL、任务快照、Prompt、日志、遥测、诊断包或默认备份。新密钥先验证，再加密临时写入并原子替换；失败保留旧密钥和 Provider。

### 12.11 本地安全

- 严格 Host、Origin 和 CSRF；
- 业务端不开放通用 CORS；
- 控制面只允许精确 app origin；
- Content Security Policy；
- AI Markdown 净化；
- 禁止脚本、事件属性和危险 URL；
- 上传按实际内容识别类型；
- Repository 路径只由系统 ID 构造；
- 请求正文日志全局禁用。

### 12.12 日志

runtime、application、generation、projection 和 security 分流为 JSONL；保留 30 天，总量 200 MiB；不记录消息正文、Review、Prompt、候选证据或密钥。运行遥测不进入全局学习档案。

### 12.13 非功能目标

结构化数据容量，不含原始材料和备份：

- 2,000 门课程；
- 50,000 个课节；
- 1,000,000 条消息；
- 2,000,000 条事件；
- 20 GiB 数据。

| 项目 | 目标 |
| --- | --- |
| 强一致查询 p95 | ≤ 200 ms |
| 非 AI 写命令 p95 | ≤ 350 ms |
| Provider delta 到 SSE p95 | ≤ 100 ms |
| outbox 发布 p95 | ≤ 2 秒 |
| 空闲分析投影延迟 p95 | ≤ 5 秒 |
| 正常冷启动 ready p95 | ≤ 5 秒 |
| 单事务崩溃恢复 ready p95 | ≤ 15 秒 |
| 简单 Server 崩溃自动恢复 | ≤ 15 秒 |
| Server 空闲 RSS | ≤ 300 MiB |
| Launcher 空闲 RSS | ≤ 80 MiB |

启动不得扫描全部正文。已向客户端确认成功的命令必须在崩溃后恢复。

## 13. 测试架构

### 13.1 工具链

| 能力 | 基线 |
| --- | --- |
| 运行时 | Node.js 24 LTS |
| 语言 | TypeScript 5.9.3，严格 ESM |
| 前端 | React 19.2 |
| 构建 | Vite 8.1 |
| 单元/集成 | Vitest 4.1.9 |
| E2E | Playwright |
| 包管理 | pnpm 10 workspace |

package.json 固定直接依赖的精确版本，提交 pnpm-lock.yaml，安装使用 frozen-lockfile。不引入 Turborepo/Nx。

版本基线依据：

- [Node.js 发布状态](https://nodejs.org/en/about/previous-releases)
- [Vite 8 发布说明](https://vite.dev/blog/announcing-vite8)
- [React 版本](https://react.dev/versions)
- [TypeScript 5.9](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html)
- [Vitest Releases](https://main.vitest.dev/releases)
- [Playwright 系统要求](https://playwright.dev/docs/intro)

### 13.2 分层

~~~mermaid
flowchart TD
    S["静态与架构检查"]
    D["纯领域与属性测试"]
    R["Repository 合同与故障注入"]
    M["Module 集成"]
    H["HTTP / SSE 合同"]
    U["React 交互"]
    E["Playwright E2E"]
    C["崩溃、恢复、容量"]
    S --> D --> R --> M --> H --> U --> E --> C
~~~

#### 静态与架构

验证 TypeScript strict、noUncheckedIndexedAccess、exactOptionalPropertyTypes、联合穷尽、依赖方向、dataKey/事件/错误码唯一、runtime schema、禁止 any 绕过和禁止用户文本拼文件路径。

#### 纯领域

使用确定性时钟/ID、InMemory Adapter、Scripted Mock Provider 和 fast-check。重点覆盖课节状态机、Review 不可变、课程关闭、多窗口租约、计时、排期、来源组、证据链和任务调度。

#### Repository 合同

同一套测试运行于 InMemory、LocalFile 和未来 Database Adapter，覆盖 expectedVersion、幂等、原子事务、outbox、immutable Artifact、checksum、锁和崩溃恢复。

#### 故障注入

FaultInjectingFileSystem 可在 staging、fsync、prepared manifest、第 N 个替换、store manifest、outbox、event receipt、projection checkpoint、backup 和 restore 切换处失败。每个故障点必须得到“未提交”或“重启后完整提交”，不允许半状态。

#### Module 集成

真实 Module + LocalFile + Mock Provider + Fake Clock + 临时数据根，通过公开 Interface 测试。覆盖幂等、并发、outbox 延迟、重启任务、非法 AI 输出、半途失败、Review 崩溃和画像失败保留。

#### HTTP/SSE

验证 schema、HTTP/错误码、Idempotency-Key、If-Match、pageInstanceId、Host/Origin/CSRF、路径/Prompt/密钥不泄露、SSE sequence、补发、去重、心跳、断线、停止和恢复。

#### React

Vitest + React Testing Library 覆盖路由、空/加载/失败/degraded/rebuilding、重复提交、SSE、Markdown 净化、Review 弹窗、双 Tab、只读接管、运行中心和输入保留。禁止大面积 DOM snapshot。

#### Playwright

使用构建后的真实 web/server、临时数据根和 Mock Provider。覆盖课程创建→学习→Review→完成事实→历史/日历→课程关闭→画像的主路径，以及刷新、多窗口、Review 失败、服务退出、版本不一致、Provider 失败、投影重建、恢复放弃和端口占用。

### 13.3 73 条回归矩阵

新增 tests/acceptance/equivalence-matrix.yaml。权威文档当前恰好有 73 个唯一 EQ 编号。

~~~yaml
id: EQ-LESSON-12
requirement: 关闭事务恢复
evidence:
  domain:
    - apps/server/src/modules/learning-session/tests/lesson-closing.test.ts
  repository:
    - apps/server/src/persistence/tests/closing-transaction.contract.test.ts
  backend:
    - apps/server/src/http/tests/final-review-recovery.test.ts
  react:
    - apps/web/src/features/lesson/tests/review-failure-actions.test.tsx
  e2e_main:
    - tests/e2e/lesson-final-review.spec.ts
  e2e_recovery:
    - tests/e2e/lesson-final-review-restart.spec.ts
~~~

CI 要求：

- 恰好覆盖 73 个权威 ID；
- 无未知、重复或缺失 ID；
- 六类证据均非空；
- 测试名携带 EQ 编号；
- 删除测试或新增规则未补证据时失败；
- 一个测试可以支撑多个相关 ID；
- 覆盖率不能替代矩阵。

### 13.4 AI 评估

三层：

1. 确定性 Mock 验证流程和不变量；
2. 协议模拟器验证 API-compatible/Codex CLI 的限流、超时、非法 delta 和半途退出；
3. 合成课程和对话语料验证大纲、教学、Review、证据和画像。

硬门禁包括 schema、核心知识点覆盖、Review 输入边界、两个独立来源组、敏感推断禁令和遥测隔离。测试不得使用真实用户数据。

### 13.5 覆盖率

- 全仓 lines/statements ≥ 90%；
- 全仓 branches ≥ 85%；
- 状态机、UnitOfWork、ReviewClosure、投影、ProfileEvidence、LearningPortrait 和 GenerationRuntime 的关键不变量分支全部覆盖；
- 关键模块定期 mutation testing，mutation score ≥ 90%；
- CI 不通过重试掩盖 flaky 测试。

## 14. 构建与发布

### 14.1 构建

~~~text
contracts
  → test-kit
  → server / launcher
  → web
  → release staging
~~~

~~~text
dist/
├─ web/
├─ server/
├─ launcher/
├─ schemas/
├─ prompts/
├─ migrations/
└─ build-manifest.json
~~~

build-manifest 包含产品版本、buildId、Git commit、构建时间、Node/pnpm/TypeScript、protocolVersion、可读 store format 范围以及所有关键 hash。

核心脚本：

~~~text
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

### 14.2 CI

每次提交：frozen install、格式、lint、类型、架构、schema、unit、Repository、Module integration、build。

主分支增加 HTTP/SSE、React、Playwright、73 条矩阵和 backup/restore smoke。

夜间增加全量故障注入、崩溃点枚举、mutation、容量性能、长任务、投影重建和完整恢复演练。

发布候选还需全新 Windows 11、Unicode/空格路径、无网络启动、外部端口、升级回滚、SBOM、许可证、依赖漏洞和 release checksum。

### 14.3 发布格式

MVP 为 Windows x64 portable ZIP：

~~~text
Learning MORE/
├─ runtime/node.exe
├─ app/server/
├─ app/web/
├─ app/launcher/
├─ schemas/
├─ migrations/
├─ START.cmd
├─ release-manifest.json
└─ THIRD-PARTY-NOTICES.txt
~~~

内置官方 Node 24 LTS，不依赖全局 Node；不包含数据、密钥或个人配置；安装目录可只读；release manifest 为每个文件提供 SHA-256，并生成 SBOM。

### 14.4 升级和回滚

升级先校验发布包、检查格式、生成已验证备份、停旧服务、并排放新版本、执行 migration dry-run/正式迁移、启动 readiness/self-test 后切换入口。

未发生格式变化可切回旧程序；旧程序不能读取新格式时必须恢复迁移前整库备份。禁止旧版本试写新数据。

## 15. 备份

### 15.1 范围

包括：

- StoreManifest；
- 所有领域聚合；
- 会话和 Markdown Artifact；
- 材料与解析快照；
- outbox、事件、幂等结果；
- GenerationTask；
- PortraitEvidence、画像版本、周报；
- 公开运行配置。

不包括：

- SecretStore；
- work；
- 日志和遥测；
- 可重建索引和读模型；
- 构建产物。

### 15.2 一致性快照

1. 获取短期 snapshot barrier；
2. 完成当前事务并阻止新事务开始；
3. checkpoint 流式工作副本；
4. 旋转当前事件段；
5. 复制可变权威 JSON/Artifact；
6. 写 store sequence 和 event high-water manifest；
7. 释放 barrier；
8. 后台复制其余不可变文件；
9. 验证 checksum；
10. 成功后发布 backup manifest。

不可变内容按 SHA-256 写入内容寻址对象库：

~~~text
backups/
├─ objects/{sha256}
└─ snapshots/{snapshotId}/manifest.json
~~~

### 15.3 触发与保留

触发：

- 距上次成功备份超过 24 小时后的首次运行；
- schema migration 前；
- 应用升级前；
- 用户手动；
- 可疑损坏发生且尚未修改数据时的诊断快照。

保留：

- 7 个每日；
- 4 个每周；
- 6 个每月；
- 所有未完成升级的升级前快照；
- 永不自动删除最后一个已验证快照。

磁盘剩余低于 10% 时暂停自动备份并告警。默认备份解决本机损坏和升级失败，不承诺跨机器恢复；backupRoot 可配置到另一磁盘，但仍受当前 Windows 用户权限保护。

### 15.4 验证

备份完成必须验证 manifest、store sequence、event high-water、所有对象 checksum、Artifact 引用、最终 Review immutable、CompletionFact、event offset 和 restore dry-run。

## 16. 损坏恢复

### 16.1 层级

Level 1 自动重建：索引、读模型、ProjectionCheckpoint、receipt。

Level 2 日志尾部恢复：活动事件段、未完成事务、过期任务租约、流式工作副本。

Level 3 单 Artifact：只恢复 checksum 明确对应当前引用的不可变 Artifact。

Level 4 整库快照：聚合、历史事件或多对象引用损坏时使用，不拼接不同时间点文件。

### 16.2 整库恢复

1. 停止 Server 并获取 store lock；
2. 验证备份 manifest 和全部对象；
3. 解包到新 staging 根；
4. 执行需要的 migration；
5. 校验领域不变量、事件连续性和 Artifact；
6. 当前根重命名为只读故障副本；
7. 原子切换 staging；
8. 启动安全模式；
9. 重建索引和读模型；
10. 完整一致性检查后解除安全模式。

恢复前数据不自动删除。

### 16.3 故障测试

自动注入 JSON 截断、checksum 错、schema 不支持、引用缺失、最终 Review 篡改、event 缺口/半行、outbox/receipt 不一致、迁移崩溃、备份对象缺失、restore 切换崩溃、错误 instanceId 和外部端口。

验收：

- 不静默删除；
- 不把损坏数据当完整统计或画像；
- 不根据当前状态伪造历史；
- 不覆盖唯一故障副本；
- 展示损坏范围和恢复结果；
- 恢复动作幂等。

## 17. 未决产品项的隔离

| 未决项 | MVP 隔离方式 |
| --- | --- |
| 通用附件、网页、外部资料 | 仅实现阅读材料专用 MaterialRepository；第二种实际来源出现后再抽象通用 Artifact seam |
| 推荐扩展课程完整交互 | 只保存 sourceCourseId；创建交互不进入当前课程关闭事务 |
| 生产 Prompt、具体模型 | Prompt Registry 和 Provider Adapter 隔离；领域合同不含正文或厂商字段 |
| 云同步、多用户、登录 | MVP 不实现；未来替换身份解析和 Repository 分区 |
| 跨机器备份 | 不属于自动备份承诺；未来单独设计可移植加密导出 |

未决项不得反向改变四状态课节生命周期、Review 不可变、课程关闭和证据独立性规则。

## 18. 需求覆盖

| 明确要求 | 本文位置 |
| --- | --- |
| Monorepo、前后端和共享包 | 4.1–4.3 |
| Module 划分与 Interface | 第 5 章 |
| 命令、查询、事件、错误 | 第 6 章 |
| HTTP 与流式 Markdown | 第 7 章 |
| 文件目录、JSON/Markdown schema | 第 8 章 |
| 索引和迁移 | 8.8–8.9 |
| 事件投影、重建、一致性恢复 | 第 9 章 |
| AI 调度、并发、Provider | 第 10 章 |
| 全局档案与候选证据 | 第 11 章 |
| 启动、端口、身份、自愈、密钥 | 第 12 章 |
| 性能与容量 | 12.13 |
| 测试分层与 73 条断言 | 第 13 章 |
| 构建与发布 | 第 14 章 |
| 备份与损坏恢复 | 第 15–16 章 |
| 未决产品项隔离 | 第 17 章 |

## 19. 架构验收条件

### 19.1 依赖和 seam

- 静态检查阻止跨 Module implementation 导入；
- 前端不能访问文件、Repository 或 Provider；
- Repository 和 AI Provider 有合同测试；
- 内部事件分发不成为公共 seam。

### 19.2 事务和恢复

- 所有写命令有幂等键和 expectedVersion；
- 聚合、幂等结果和 outbox 不会部分提交；
- 服务重启恢复事务、outbox、投影和生成任务；
- 最终 Review/课程总 Review 成功后物理不可覆盖；
- 损坏数据不会被解释为完整画像。

### 19.3 数据和画像

- 191 个 dataKey 保持唯一语义和 definitionVersion；
- 历史统计与全局档案使用同一事实投影；
- 运行遥测永久隔离；
- 候选允许零条；
- 洞察至少两个独立来源组；
- 临时原文包不持久化。

### 19.4 运行

- 发布版只监听 loopback；
- 错实例、错端口、错根目录或错 fingerprint 不判健康；
- 外部端口占用不强杀；
- 本地服务和 AI 状态分离；
- 密钥不进入普通文件或浏览器持久化；
- 已确认成功命令崩溃后可恢复。

### 19.5 测试和发布

- 73 个 EQ 编号全部映射到六类测试证据；
- build/release 可在干净 Windows 11 环境复现；
- migration 前有已验证备份；
- backup restore drill 通过；
- 容量和性能目标有自动化证据。

## 20. 实施顺序约束

详细实施计划必须遵守以下纵向顺序：

1. Monorepo、contracts、测试基线和架构检查；
2. LocalFile UnitOfWork、Repository 合同、outbox；
3. CourseAuthoring 创建到正式课程；
4. LearningSession 到最终 Review 的第一条闭环；
5. 课程关闭与课程总 Review；
6. Planning；
7. LearningFacts、历史和日历；
8. ProfileEvidence 和 LearningPortrait；
9. Launcher、自愈、备份和发布；
10. 完整 73 条回归矩阵、容量和恢复验收。

每个阶段必须形成可运行、可测试的纵向切片，不能先搭建大量空 Interface 或只通过编译的壳。
