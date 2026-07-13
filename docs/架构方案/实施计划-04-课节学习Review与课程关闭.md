# 课节学习、Review 与课程关闭 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan.

**Goal:** 交付四种课节生命周期、可恢复学习会话、放弃证据、不可变最终 Review、补充学习、可恢复课程关闭事务和不可逆课程永久删除。

**Architecture:** `LearningSession` 独占交互会话、消息、时间区间和写租约；`ReviewClosure` 独占 stage/final Review 与关闭事务。原始会话永不被 Review 或补充学习改写；事实仅在最终提交事件后产生。

**Tech Stack:** TypeScript 5.9.3、Fastify 5.10.0、React 19.2.7、Vitest 4.1.9、Playwright 1.61.1、LocalFile UnitOfWork、GenerationRuntime。

## Global Constraints

- 先完成《实施计划-03》Phase Gate。
- 用户可见课节生命周期固定为 `not_started|in_progress|abandoned|completed`；会话可 `active|paused|frozen|closed`。
- 原始消息 append-only；停止生成保留已到达 Markdown。
- stage Review 可重试和替换；final Review 提交后不可改写。
- 完成、放弃、恢复、关闭和课程永久删除必须有幂等与崩溃恢复测试。

---

## Task 1：实现课节与学习会话状态机

**Files:**

- Create: `apps/server/src/modules/learning-session/model/lesson-progress.ts`
- Create: `apps/server/src/modules/learning-session/interface.ts`
- Create: `apps/server/src/modules/learning-session/model/learning-session.ts`
- Create: `apps/server/src/modules/learning-session/model/commands.ts`
- Create: `apps/server/src/modules/learning-session/model/events.ts`
- Test: `apps/server/src/modules/learning-session/tests/learning-session.test.ts`

**Interface:** `LearningSession.execute(command, context)` 支持 start、pause、resume、appendUserMessage、startGeneration、stopGeneration；任何时刻每个 lesson 最多一个可写 session。

```ts
export type LessonProgressState = 'not_started' | 'in_progress' | 'abandoned' | 'completed';

export interface LearningSessionModule {
  execute(
    command: LearningSessionCommand,
    context: CommandContext,
  ): Promise<CommandResult<LearningSessionResult>>;
  query(query: LearningSessionQuery, context: QueryContext): Promise<LearningSessionView>;
}
```

- [ ] 写状态表测试，覆盖首次 start、pause/resume、有证据 abandoned 恢复并解冻同一原始 session、无证据 abandoned 删除空 session 后回到 `not_started`、completed 禁止恢复、双写 session 冲突和重复命令。
- [ ] 运行 domain 测试，预期失败。
- [ ] 用 `decide/evolve` 实现状态机；时间和 ID 从 context 注入。首次开始创建原始 session；有证据放弃只冻结该 session，恢复时解冻同一 session；无证据放弃删除空 session 与短暂停留时长，下一次开始才创建新 session。
- [ ] fast-check 生成 2,000 条命令序列，断言 completed 不可逆、同 lesson 活跃写者不超过 1。
- [ ] 提交：`git add apps/server/src/modules/learning-session/model && git commit -m "feat(domain): model lesson and session lifecycle"`。

## Task 2：实现消息流、时间区间与写租约

**Files:**

- Modify: `apps/server/package.json`
- Create: `apps/server/src/modules/learning-session/implementation/session-module.ts`
- Create: `apps/server/src/modules/learning-session/implementation/message-log.ts`
- Create: `apps/server/src/modules/learning-session/implementation/time-intervals.ts`
- Create: `apps/server/src/modules/learning-session/implementation/session-write-lease.ts`
- Create: `apps/server/src/persistence/learning-session-repositories.ts`
- Test: `apps/server/src/modules/learning-session/tests/session-module.test.ts`
- Test: `apps/server/src/persistence/learning-session-repositories.contract.test.ts`

**Interfaces:** 消息含稳定 messageId、role、createdAt、contentArtifactRef、generationTaskId；学习时长只累计前台可见、持有写入权且未暂停的闭合 active intervals，重启时未闭合 interval 按最后 visibility/lease heartbeat 截断并标记 recovered。

- [ ] 写失败测试：用户消息重复提交只追加一次；assistant delta 不进入消息 log，只有 artifact commit 才生成一条 assistant 消息；双 tab 第二个得到只读 lease；暂停不累计时间。
- [ ] 运行测试，预期失败。
- [ ] 为 LessonProgress、LessonSession、Review、LearningTime、WriteLease、ClosingIntent 编写 LocalFile/InMemory adapter 并复用 Repository 合同；message log 使用 checksum NDJSON，模块把 command、聚合、message append、lease 和 outbox 放入一致事务。lease 含 pageInstanceId、instanceId、generation、heartbeatAt、visibilityState，不能由另一页面静默夺取；后台、离页、断线和写入权转移立即闭合计时区间。
- [ ] 注入重启并推进 FakeClock，验证区间总和与 recovered 标记；原始输入和生成失败草稿仍可查询。
- [ ] 提交：`git add apps/server/src/modules/learning-session && git commit -m "feat(session): persist messages leases and learning time"`。

## Task 3：接入会话生成、停止与断线恢复

**Files:**

- Create: `apps/server/src/modules/learning-session/implementation/session-generation.ts`
- Create: `apps/server/src/http/routes/learning-sessions.ts`
- Test: `apps/server/src/modules/learning-session/tests/session-generation.test.ts`
- Test: `apps/server/src/http/routes/learning-sessions.test.ts`

**Interfaces:** `POST /api/v1/lessons/:lessonId/sessions`、`POST /api/v1/lesson-sessions/:sessionId/messages`、`POST /api/v1/lesson-sessions/:sessionId/pauses`、`POST /api/v1/lesson-sessions/:sessionId/lease-transfers`、`POST /api/v1/lesson-sessions/:sessionId/generation-stops`、`GET /api/v1/lesson-sessions/:sessionId`，生成流复用 `/api/v1/generation-tasks/:taskId/events`。

- [ ] 写测试：一条用户消息最多触发一个 task；停止后 task cancelled、已接收 draft 可见且输入可再次编辑；断线重连不重复 Markdown；session 关闭后不能发消息。
- [ ] 运行测试，预期失败。
- [ ] `SessionGenerationCoordinator` 构造显式 input manifest，包含固定 course/lesson/session/version refs、学习起点评估摘要、当时全部已完成课节的最终 Review refs 和当前会话消息 refs；其他课节原始对话与全局画像不得默认注入学习 Prompt。
- [ ] HTTP 校验 `If-Match`、Idempotency、pageInstanceId 和 lease token；只读 tab 的写请求返回 `write_lease_lost`。
- [ ] 运行 module/HTTP/SSE 测试，预期通过。
- [ ] 提交：`git add apps/server/src/modules/learning-session apps/server/src/http/routes && git commit -m "feat(session): stream and stop lesson generation"`。

## Task 4：实现放弃证据、恢复与 stage Review

**Files:**

- Create: `apps/server/src/modules/review-closure/model/review-state.ts`
- Create: `apps/server/src/modules/review-closure/interface.ts`
- Modify: `apps/server/package.json`
- Create: `apps/server/src/modules/learning-session/implementation/abandon-lesson.ts`
- Create: `apps/server/src/modules/review-closure/implementation/stage-review.ts`
- Test: `apps/server/src/modules/learning-session/tests/abandon-lesson.test.ts`
- Test: `apps/server/src/modules/review-closure/tests/stage-review.test.ts`

**Interfaces:** `abandonLesson` 关闭 active interval；无有效证据时删除空 session 并回到 `not_started`，有有效证据时冻结同一 source session 并提交 `LessonAbandoned`。stage Review 使用稳定 reviewId，可失败、可重试、在最终完成前原子替换，不保留版本时间线，也不可被当成最终事实。

- [ ] 写失败测试：无证据放弃不生成 Review 且清除短暂停留时长；有证据放弃同命令重复不生成第二个 task；生成失败仍保留 abandonment；恢复解冻同一 session；再次放弃可原子替换同一 reviewId 且没有版本时间线。
- [ ] 运行测试，预期失败。
- [ ] `LearningSession.AbandonLesson` 事务只提交 session freeze 与用户选择事实，不等待 AI；随后 outbox 驱动 `ReviewClosure.RequestStageReview` 提交 task。失败状态记录 task/error/draft ref，用户可显式 retry；成功由 ReviewClosure 调用 LearningSession 的 `CommitStageReview`，只替换稳定 reviewId 的正文/checksum。
- [ ] 恢复命令把 lesson 从 `abandoned` 迁移 `in_progress` 并解冻同一原始 session，保留 abandonment history 和现存 stage Review；不得复制旧消息或创建所谓续学会话。
- [ ] 运行崩溃注入和重试测试，预期通过。
- [ ] 提交：`git add apps/server/src/modules/review-closure apps/server/src/modules/learning-session && git commit -m "feat(review): preserve abandonment and stage reviews"`。

## Task 5：实现 final Review 关闭事务与补充学习

**Files:**

- Create: `apps/server/src/modules/review-closure/implementation/lesson-closure.ts`
- Create: `apps/server/src/modules/review-closure/implementation/final-review-validator.ts`
- Create: `apps/server/src/modules/learning-session/model/supplementary-session.ts`
- Test: `apps/server/src/modules/review-closure/tests/lesson-closure.test.ts`

**Interfaces:** 关闭状态 `open -> generating -> review-ready -> committing -> completed`；final Review 必须引用 source session IDs、message range checksum、用户发出的结束意图和生成任务。用户只确认“结束本课”，不需要再审核或确认 AI 生成的 Review 正文；补充学习是新 `SupplementarySession`，不能附加到原始会话。

```ts
export type LessonClosureState =
  'open' | 'generating' | 'generating-failed' | 'review-ready' | 'committing' | 'completed';
```

- [ ] 写失败测试：空会话不可完成；Review 生成失败保持 `generating-failed` 可重试；篡改 source checksum 拒绝提交；commit 崩溃可恢复；completed 后 retry/overwrite 均失败；补充学习不改变原 Review。
- [ ] 运行测试，预期失败。
- [ ] Review validator 校验结构、source refs、复合证据边界和 Markdown 安全；成功后基于已冻结的结束意图调用 `LearningSession.CommitFinalReview`，由数据所有者在一个 UnitOfWork 中提交 immutable review artifact、lesson completed、session closed、CompletionFact、idempotency receipt 和 outbox。ReviewClosure 不直接写 ReviewRepository。
- [ ] `committing` journal 由启动恢复器完成；生成成功但尚未确认的 review-ready 可跨重启继续。
- [ ] SupplementarySession 只引用 course/lesson/finalReview，拥有独立消息、时长和关闭事件。
- [ ] 运行全部测试与 final Review 篡改故障，预期通过。
- [ ] 提交：`git add apps/server/src/modules/review-closure apps/server/src/modules/learning-session && git commit -m "feat(review): commit immutable lesson reviews"`。

## Task 6：实现课程关闭和课程总 Review

**Files:**

- Create: `apps/server/src/modules/course-authoring/implementation/close-course.ts`
- Create: `apps/server/src/modules/review-closure/implementation/course-review.ts`
- Create: `apps/server/src/http/routes/review-closure.ts`
- Test: `apps/server/src/modules/course-authoring/tests/close-course.test.ts`
- Test: `apps/server/src/http/routes/review-closure.test.ts`

**Interfaces:** 最终大纲中 `not_started|in_progress` 阻止关闭；全部课节 completed 时自动关闭，存在 abandoned 时必须展示清单并由用户确认。课程先不可逆关闭并发出 `CourseClosed`，再异步生成课程总 Review；Review 首次成功后 immutable 并发出 `CourseReviewFinalized`。

- [ ] 写测试：`not_started|in_progress` 返回具体 blockers；abandoned 不阻止但缺用户确认时拒绝；全部 completed 自动关闭；重复 close 复用结果；课程 Review 失败时课程仍保持 closed 且可用固定快照重试；Review 成功提交崩溃可恢复；补充学习不阻塞已满足的关闭条件。
- [ ] 运行测试，预期失败。
- [ ] `CourseAuthoring.CloseCourse` 负责验证资格并原子提交不可逆 closed；随后 `ReviewClosure.CourseReviewWorkflow` 使用 `closed|generating-review|review-ready|review-failed|review-finalized` 阶段冻结最终大纲、已完成课节最终 Review、已放弃课节现存 stage Review 和无 Review 放弃事实到 input manifest。ReviewClosure 只能调用 CourseAuthoring 的公开内部命令提交 Review 引用，不能直接改 Course；生成失败不得回滚 closed。
- [ ] 路由暴露 `POST /api/v1/lessons/:lessonId/abandonments`、`POST /api/v1/lessons/:lessonId/restorations`、`POST /api/v1/lessons/:lessonId/closures`、`POST /api/v1/courses/:courseId/closures`、`GET /api/v1/closure-transactions/:transactionId`；重试通过原 closure resource 上带新 Idempotency-Key 的具体 retry action，不暴露通用 command 端点。
- [ ] 运行 module 与 HTTP 测试，预期通过。
- [ ] 提交：`git add apps/server/src/modules/course-authoring apps/server/src/modules/review-closure apps/server/src/http/routes && git commit -m "feat(review): close courses with recoverable review workflow"`。

## Task 7：实现学习与 Review React 流程和 E2E

**Files:**

- Create: `apps/web/src/routes/lesson-route.tsx`
- Create: `apps/web/src/features/learning/session-page.tsx`
- Create: `apps/web/src/features/learning/message-stream.tsx`
- Create: `apps/web/src/features/learning/session-controls.tsx`
- Create: `apps/web/src/features/review/review-dialog.tsx`
- Create: `apps/web/src/features/review/course-closure-panel.tsx`
- Test: `apps/web/src/features/learning/session-page.test.tsx`
- Test: `tests/e2e/learning-review-closure.spec.ts`

- [ ] 写 RTL 测试覆盖生成流、停止、刷新续传、双 tab 只读、有/无证据放弃分支、Review 失败重试、review-ready 确认、completed 只读和补充学习分离。
- [ ] 运行 web 测试，预期失败。
- [ ] 实现 reducer 驱动 UI；服务退出时保留编辑框和已显示 Markdown；“结束本课”操作先显示明确确认和生成失败不完成课节的提示；Review 成功后直接展示只读 Markdown 弹窗，不增加正文审核/确认步骤。
- [ ] Playwright 完整覆盖 start→messages→pause→resume→abandon→restore→final Review→complete→supplementary→close course；在 Review commit 中杀进程并重启，预期自动恢复为一个 final artifact。
- [ ] 运行 RTL、E2E 和 `pnpm verify`；更新对应 equivalence matrix 为 passing 并验证。
- [ ] 提交：`git add apps/web tests/e2e docs/架构方案/equivalence-matrix.yaml && git commit -m "feat(web): complete learning and review closure"`。

## Task 8：实现课程永久删除与统计/画像撤销

**Files:**

- Create: `apps/server/src/modules/course-authoring/implementation/delete-course.ts`
- Create: `apps/server/src/modules/course-authoring/implementation/course-deletion-reconciliation.ts`
- Create: `apps/web/src/features/course/DeleteCourseDialog.tsx`
- Test: `apps/server/src/modules/course-authoring/tests/delete-course.test.ts`
- Test: `apps/web/src/features/course/DeleteCourseDialog.test.tsx`

**Interfaces:** `DeleteCourse(courseId, idempotencyKey)` 是独立于关闭课程的风险命令；确认弹窗只要求点击“永久删除”，不接受软删除或恢复。命令先撤销会话写入权与计时，再以可恢复事务级联删除课程聚合、会话、Review、排期、计划流和材料引用；随后撤销该课程贡献的历史事实、日历条目、画像候选证据和来源组，重建统计投影并触发学习画像重算。

- [ ] 写测试：取消确认不产生写入；重复删除幂等；任何关联资源删除失败时不暴露稳定的部分删除状态；删除后课程、会话、Review、排期、计划流和历史列表均不可查询；统计与日历不再计入该课程；画像不再引用该课程来源；画像重算失败不回滚删除且页面正确显示更新失败。

## Phase Gate

- 四种课节生命周期、会话 pause/resume、放弃/恢复均通过状态性质测试。
- 双 tab 不产生双写；停止、断线和服务退出不丢原始输入或已到达 Markdown。
- stage Review 失败不回滚用户放弃事实；final Review 和课程总 Review 不可覆盖。
- 课节与课程关闭事务在全部崩溃点可恢复且无重复事实事件。
- 主 E2E 与 `pnpm verify` 通过，矩阵引用真实测试。
