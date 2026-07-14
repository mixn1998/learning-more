# 互动教学观察账本纵向切片 Implementation Plan

> **For implementers:** Execute this plan task-by-task in the current session. Only delegate work when the user explicitly authorizes parallel agents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现“教学智能体 → 逐回合教学观察 → 教学状态账本 → Review / 思维行为 Episode → 全局用户档案 → 教学个性化与学习画像消费”的完整原始课节纵向切片。

**Architecture:** 新建 `interactive-teaching` 深模块，内部封装上下文装配、教学智能体适配、观察调度、观察校验、账本 Reducer 和检查点冻结；`learning-session` 继续拥有原始消息与生命周期。把现有 `profile-evidence` 收敛为 `global-user-profile` 深模块，长期维护统计快照、候选证据、来源和消费视图；`learning-portrait` 只读档案快照。

**Tech Stack:** TypeScript 5.9、Node.js 24、Zod 4、Vitest 4、Fastify 5、现有 GenerationRuntime、UnitOfWork 与本地文件 Repository。

## Global Constraints

- 教学智能体只输出用户可见 Markdown；不得输出隐藏状态或直接写业务数据。
- 不使用 `lesson-response@vN` 等场景 Prompt 模板；只允许稳定、短小的能力合同和已经物化的真实上下文。
- 不设计 `TeachingScopeEnvelope`、允许主题清单、前置知识白名单或玩法专属教学管线。
- `direct | supporting | adjacent | unclear | off_scope` 是回复完成后的观察关系，不是生成前许可。
- `adjacent` 是课程邻接探索：允许自然展开、单独记录教学支线、不更新当前核心知识点覆盖、不自动完成未来课节。
- 标准模式与八种玩法共用同一 `interactive-teaching` Interface、观察 Schema、账本、Review 和档案管线；`courseMode` 是第二层课程身份事实，`playIntent` 是第二层中的条件性择优信号，不设置数值权重、回合配额或方法命中率。
- `standard` 不携带 `playIntent`；八种玩法只在多个教学动作均能满足当前问题、本课责任和账本开放项时，优先选择更符合玩法意图的下一步。没有自然机会时允许不显式体现玩法。
- `evidenceCheckpoint` 只能由校验通过的语义观察建立；禁止字数、正则、消息数、时长、点击或页面行为启发式。
- 教学观察和状态账本是会话级短期派生数据，整份观察不直接复制进全局用户档案；只有有效 `learner_reasoning_behavior` 条目可经专用 Port 幂等投影为局部 Episode，普通候选证据仍走检查点。
- Review 只消费服务器冻结的教学检查点；不得重新全量扫描对话建立私有状态。
- 全局用户档案是长期权威数据域；学习画像和教学个性化只是消费者，均不得反向写档案结论。
- 用户档案候选证据不包含固定 `claimDimension`、固定 `strength.score` 或脱离具体洞察的永久 `polarity`。
- AI 观察、Review、档案证据和画像都必须保留精确来源、快照哈希、版本、完整性和失效状态。
- 任何无法确认观察完整性的放弃操作优先保留会话；不得用保留策略伪造证据已经成立。
- 原始对话、已完成 Review 和用户已有工作区改动不可被静默重写。

## 2026-07-14 实施状态快照

| 纵向环节 | 状态 | 已落地的后端证据 |
| --- | --- | --- |
| 教学合同、自由教学 Agent、八玩法软意图、adjacent | 已落地 | `packages/contracts/src/teaching.ts`、`interactive-teaching/implementation/*` |
| 逐回合 Observer、Validator、Ledger、检查点 | 已落地 | 内存/LocalFile Repository、幂等冻结、观察失败与启动补写测试 |
| 课时与课程总 Review | 已落地 | 服务器冻结物化证据包、自由 Markdown writer、无场景模板、不可变 Artifact |
| 思维行为数据链 | 已落地 | Episode、动态维度、多标签分类、确定性统计、过滤 API、默认无过滤消费 |
| 学习画像与全局用户档案分离 | 已落地本切片消费边界 | 画像只读附加 reasoning snapshot；教学只读 PersonalizationView；无反向写入 |
| 删除和恢复 | 已落地 | 删除 ledger/Episode/全部 analysis，剩余来源重建；组合根启动恢复 |
| 数据治理与架构同步 | 已落地 | 数据键清单、策略规则、领域词汇、Review/玩法规则、程序架构和架构门 |
| 雷达图 UI | 不在本切片 | 数据可供未来调用，但不固定轴、不提前设计展示 |

本表只表示本纵向切片的实现状态，不把更大范围的 `profile-evidence` 全量目录迁移、补充学习逐回合账本或画像 UI 重做声明为完成。后续任务清单中的未勾选项仍用于记录这些扩展工作。

---

## File Map

### 新建

- `packages/contracts/src/teaching.ts`：教学观察、账本和检查点共享 Schema。
- `packages/contracts/src/global-user-profile.ts`：用户档案候选证据、消费快照和个性化视图 Schema。
- `apps/server/src/modules/interactive-teaching/interface.ts`：深模块唯一公开 Interface。
- `apps/server/src/modules/interactive-teaching/model/teaching-state.ts`：初始账本状态。
- `apps/server/src/modules/interactive-teaching/implementation/teaching-observation-validator.ts`：来源和语义效果校验。
- `apps/server/src/modules/interactive-teaching/implementation/teaching-state-reducer.ts`：确定性账本 Reducer。
- `apps/server/src/modules/interactive-teaching/implementation/context-assembler.ts`：上下文物化、排序和裁剪。
- `apps/server/src/modules/interactive-teaching/implementation/generation-teaching-agent.ts`：GenerationRuntime 教学智能体 Adapter。
- `apps/server/src/modules/interactive-teaching/implementation/generation-teaching-observer.ts`：结构化观察 Adapter。
- `apps/server/src/modules/interactive-teaching/implementation/observation-queue.ts`：会话级串行观察与恢复。
- `apps/server/src/modules/interactive-teaching/implementation/interactive-teaching.ts`：回合编排和检查点冻结。
- `apps/server/src/modules/interactive-teaching/ports/teaching-agent.ts`：教学生成 Port。
- `apps/server/src/modules/interactive-teaching/ports/teaching-observer.ts`：观察器 Port。
- `apps/server/src/modules/interactive-teaching/ports/teaching-context-sources.ts`：课程、材料、Review、消息和个性化来源 Port。
- `apps/server/src/modules/interactive-teaching/ports/teaching-ledger-repository.ts`：观察与账本原子持久化 Port。
- `apps/server/src/persistence/teaching-ledger-repositories.ts`：内存与本地文件 Adapter。
- `apps/server/src/persistence/teaching-ledger-repositories.contract.test.ts`：Repository 合同测试。
- `apps/server/src/modules/global-user-profile/`：由现有 `profile-evidence` 迁移后的长期档案深模块。
- `apps/server/src/modules/global-user-profile/implementation/reasoning-behavior-module.ts`：Episode 投影、动态分析校验与确定性统计。
- `apps/server/src/modules/global-user-profile/implementation/generation-reasoning-behavior-analyzer.ts`：无预设类型表的维度归纳 Adapter。
- `apps/server/src/persistence/reasoning-behavior-repositories.ts`：Episode 与分析快照的内存/LocalFile Adapter。
- `apps/server/src/http/routes/profile.ts`：Episode、过滤分析和 snapshot 查询。
- `tools/architecture/src/teaching-data-boundaries.test.ts`：跨模块消费与禁止回写边界测试。
- `apps/server/src/modules/interactive-teaching/tests/vertical-slice.test.ts`：完整纵向测试。

### 重点修改

- `apps/server/src/modules/learning-session/**`：移除语义启发式，记录消息完成状态，接受观察效果。
- `apps/server/src/modules/review-closure/**`：改为消费教学检查点快照。
- `apps/server/src/modules/learning-portrait/**`：改为消费全局用户档案快照。
- `apps/server/src/bootstrap/local-application.ts`：组合两个深模块和各 Port Adapter。
- `apps/server/src/http/routes/learning-sessions.ts`：只转发用户输入给 `interactive-teaching`。
- `apps/server/src/persistence/course-archive-store.ts`：删除时撤销教学账本和档案来源。

---

### Task 1: 建立教学与全局用户档案共享合同

**Files:**
- Create: `packages/contracts/src/teaching.ts`
- Create: `packages/contracts/src/teaching.test.ts`
- Create: `packages/contracts/src/global-user-profile.ts`
- Create: `packages/contracts/src/global-user-profile.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Produces: `TeachingObservationSchema`, `TeachingStateSnapshotSchema`, `TeachingCheckpointSnapshotSchema`。
- Produces: `UserProfileEvidenceSchema`, `GlobalUserProfileSnapshotSchema`, `PersonalizationViewSchema`。
- Consumed by: Tasks 3–10。

- [ ] **Step 1: 写教学合同失败测试**

```ts
it('accepts adjacent exploration without treating it as current lesson coverage', () => {
  expect(
    TeachingObservationSchema.parse({
      observationId: 'observation_1',
      schemaVersion: 1,
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      turnSequence: 1,
      sourceMessageIds: ['message_user_1', 'message_ai_1'],
      sourceSnapshotHash: 'a'.repeat(64),
      scope: {
        alignment: 'adjacent',
        relationRefs: ['course-topic:causal-inference', 'message:message_user_1'],
        rationale: 'The learner opened a course-related branch outside this lesson.',
      },
      entries: [{
        entryId: 'entry_1',
        kind: 'adjacent_exploration',
        summary: 'The learner explored a related causal-inference question.',
        knowledgePointRefs: [],
        sourceRefs: ['message:message_user_1'],
        explicitness: 'user_declared',
        resolvesEntryRefs: [],
        qualityFlags: ['direct', 'complete'],
      }],
      observerVersion: 'teaching-observer@1',
      observedAt: '2026-07-13T00:00:00.000Z',
      status: 'active',
    }),
  ).toMatchObject({ scope: { alignment: 'adjacent' } });
});
```

- [ ] **Step 2: 运行合同测试并确认失败**

Run: `corepack pnpm vitest run packages/contracts/src/teaching.test.ts packages/contracts/src/global-user-profile.test.ts`

Expected: FAIL，因为两个合同文件尚不存在。

- [ ] **Step 3: 实现严格 Schema 与只读类型**

```ts
export const TeachingScopeRelationSchema = z.strictObject({
  alignment: z.enum(['direct', 'supporting', 'adjacent', 'unclear', 'off_scope']),
  relationRefs: z.array(z.string().min(1)),
  rationale: z.string().min(1),
});

export const TeachingObservationKindSchema = z.enum([
  'teaching_delivery',
  'learner_demonstration',
  'learner_misconception',
  'learner_question',
  'learner_intent',
  'adjacent_exploration',
  'open_loop',
]);
```

`TeachingStateSnapshotSchema` 必须包含 `observationStatus`、`scopeStatus`、逐知识点 delivery/verification、`openLoops`、`explorationBranches`、`recentLearnerSignals` 和 `evidenceCheckpoint`。

`UserProfileEvidenceSchema` 必须包含 `explicitness`、`sourceType`、`sourceRefs`、`sourceGroupId`、`dependentSourceGroupIds`、`sourceSnapshotHash`、`qualityFlags`、`safetyStatus`、`supersedes`、版本和状态；不得添加 `claimDimension`、`strength` 或 `polarity`。

- [ ] **Step 4: 增加拒绝非法引用和固定维度字段的测试**

```ts
expect(() => UserProfileEvidenceSchema.parse({
  ...validEvidence,
  claimDimension: 'learning.style',
})).toThrow();

expect(() => TeachingObservationSchema.parse({
  ...validObservation,
  scope: { alignment: 'adjacent', relationRefs: [], rationale: 'related' },
})).toThrow();
```

- [ ] **Step 5: 运行合同构建与测试**

Run: `corepack pnpm --filter @learning-more/contracts test && corepack pnpm --filter @learning-more/contracts build`

Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/teaching.ts packages/contracts/src/teaching.test.ts packages/contracts/src/global-user-profile.ts packages/contracts/src/global-user-profile.test.ts packages/contracts/src/index.ts
git commit -m "feat: define teaching and user profile contracts"
```

---

### Task 2: 移除消息级语义启发式并记录来源质量

**Files:**
- Modify: `apps/server/src/modules/learning-session/interface.ts`
- Modify: `apps/server/src/modules/learning-session/model/commands.ts`
- Modify: `apps/server/src/modules/learning-session/model/events.ts`
- Modify: `apps/server/src/modules/learning-session/model/learning-session.ts`
- Modify: `apps/server/src/modules/learning-session/implementation/message-log.ts`
- Modify: `apps/server/src/modules/learning-session/implementation/session-module.ts`
- Modify: `apps/server/src/modules/learning-session/implementation/session-generation.ts`
- Delete: `apps/server/src/modules/learning-session/implementation/evidence-checkpoint.ts`
- Modify: `apps/server/src/modules/learning-session/tests/evidence-checkpoint.test.ts`
- Modify: `apps/server/src/modules/learning-session/tests/learning-session.test.ts`
- Modify: `apps/server/src/modules/learning-session/tests/session-generation.test.ts`
- Modify: `apps/server/src/http/routes/learning-sessions.ts`
- Modify: `packages/contracts/src/learning-session.ts`

**Interfaces:**
- Produces: `EstablishEvidenceCheckpoint` command, observer-only effect入口。
- Produces: `LearningMessage.completionStatus` and `contentSha256`。
- Consumed by: Task 6 observation commit and Task 7 Review snapshot。

- [ ] **Step 1: 写失败测试，证明普通消息不能自动建立证据**

```ts
const afterUser = evolveAll(
  started,
  decide(started, { type: 'appendUserMessage', messageId: 'm1' }, 'append'),
);
expect(afterUser.session?.evidenceCheckpoint).toBe(false);

const afterAssistant = evolveAll(
  afterUser,
  decide(afterUser, {
    type: 'recordAssistantMessage',
    messageId: 'm2',
    generationTaskId: 'task_1',
    completionStatus: 'complete',
  }, 'assistant'),
);
expect(afterAssistant.session?.evidenceCheckpoint).toBe(false);
```

- [ ] **Step 2: 运行测试并确认现有默认 `true` 失败**

Run: `corepack pnpm vitest run apps/server/src/modules/learning-session/tests/learning-session.test.ts apps/server/src/modules/learning-session/tests/session-generation.test.ts`

Expected: FAIL，现实现仍从命令输入或默认值建立证据。

- [ ] **Step 3: 改造命令与事件**

```ts
export type LearningSessionCommand =
  | Readonly<{ type: 'appendUserMessage'; messageId: string }>
  | Readonly<{
      type: 'recordAssistantMessage';
      messageId: string;
      generationTaskId: string;
      completionStatus: 'complete' | 'interrupted' | 'failed_recoverable';
    }>
  | Readonly<{
      type: 'establishEvidenceCheckpoint';
      observationId: string;
      sourceSnapshotHash: string;
    }>
  | Readonly<{
      type: 'abandon';
      retentionDecision: 'discardable' | 'preserve';
    }>;
```

`AssistantMessageRecorded` 必须清除匹配的 `activeGenerationTaskId`。`EvidenceCheckpointEstablished` 只把布尔值从 false 变为 true 并保存观察引用；不接受任意文本或分数。

- [ ] **Step 4: 扩展不可变消息日志**

```ts
export type LearningMessage = Readonly<{
  id: string;
  role: 'user' | 'assistant';
  createdAt: string;
  contentArtifactRef: string;
  contentSha256: string;
  completionStatus: 'complete' | 'interrupted' | 'failed_recoverable';
  generationTaskId?: string;
}>;
```

用户消息固定为 `complete`。停止生成时保存已经产生的草稿为 `interrupted`；失败可恢复草稿保存为 `failed_recoverable`。非 complete 助手消息永远不能成为教学或掌握证据。

- [ ] **Step 5: 删除长度/正则分类和路由调用**

删除 `classifyUserLearningMessage`、`establishesEvidenceCheckpoint` 及所有调用。路由不再理解消息语义；Task 6 完成后路由改为调用 `interactiveTeaching.advanceTurn`。

- [ ] **Step 6: 测试观察效果与保留决策**

覆盖：观察建立 checkpoint；重复观察幂等；`retentionDecision = preserve` 保留待观察会话但不伪造 checkpoint；`discardable` 只在观察 current 且无证据时删除会话。

- [ ] **Step 7: 运行聚焦测试**

Run: `corepack pnpm vitest run apps/server/src/modules/learning-session apps/server/src/http/routes/learning-sessions.test.ts`

Expected: PASS，且仓库搜索不存在 `classifyUserLearningMessage` 或 `content.length >=` 证据逻辑。

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/modules/learning-session apps/server/src/http/routes/learning-sessions.ts packages/contracts/src/learning-session.ts
git commit -m "refactor: make teaching evidence observer-owned"
```

---

### Task 3: 实现教学观察校验与确定性状态 Reducer

**Files:**
- Create: `apps/server/src/modules/interactive-teaching/interface.ts`
- Create: `apps/server/src/modules/interactive-teaching/model/teaching-state.ts`
- Create: `apps/server/src/modules/interactive-teaching/implementation/teaching-observation-validator.ts`
- Create: `apps/server/src/modules/interactive-teaching/implementation/teaching-state-reducer.ts`
- Create: `apps/server/src/modules/interactive-teaching/tests/teaching-observation-validator.test.ts`
- Create: `apps/server/src/modules/interactive-teaching/tests/teaching-state-reducer.test.ts`

**Interfaces:**
- Produces: `createInitialTeachingState(lesson)`。
- Produces: `validateTeachingObservation(input)`。
- Produces: `reduceTeachingState(state, observation)`。
- Consumed by: Tasks 4 and 6。

- [ ] **Step 1: 写 Reducer 失败测试**

覆盖四条最小规则：

```ts
expect(reduce(initial, directExplanation).knowledgePoints[0]?.delivery).toBe('explained');
expect(reduce(initial, adjacentBranch).knowledgePoints[0]?.delivery).toBe('not_addressed');
expect(reduce(initial, adjacentBranch).explorationBranches).toHaveLength(1);
expect(reduce(initial, offScope).scopeStatus).toBe('needs_return');
```

另覆盖 `supporting/limiting/mixed`、开放项解决、同一观察幂等和乱序拒绝。

- [ ] **Step 2: 运行测试并确认失败**

Run: `corepack pnpm vitest run apps/server/src/modules/interactive-teaching/tests/teaching-state-reducer.test.ts`

Expected: FAIL，因为模块尚不存在。

- [ ] **Step 3: 实现初始状态和 Reducer**

```ts
export function reduceTeachingState(
  current: TeachingStateSnapshot,
  observation: TeachingObservation,
): TeachingStateSnapshot {
  if (observation.turnSequence !== current.ledgerVersion + 1) {
    throw new Error('teaching_observation_out_of_order');
  }
  // Apply only validated business effects; never call AI here.
  // adjacent adds an exploration branch and leaves current lesson coverage unchanged.
  // unclear/off_scope cannot establish delivery or mastery evidence.
  return next;
}
```

`evidenceCheckpoint` 可由完整、非 off-scope 的实质教学、学习者展示、具体问题或 adjacent 学习探索建立；`learner_intent` 单独出现不自动建立。

- [ ] **Step 4: 实现来源校验**

Validator 输入必须含当前课节知识点引用集合、允许的消息 ID/完成状态、当前有效开放项和来源哈希。拒绝：未知消息、非 complete 助手证据、未知知识点、越界解决引用、空摘要、哈希不匹配和 `direct/supporting/adjacent` 无关系引用。

- [ ] **Step 5: 加入课程邻接与保守 off-scope 测试**

测试跨领域类比可为 `supporting`，课程相关脑洞可为 `adjacent`，未映射到大纲不自动变成 `off_scope`，且 adjacent 不完成未来课节。

- [ ] **Step 6: 运行模块测试与类型检查**

Run: `corepack pnpm vitest run apps/server/src/modules/interactive-teaching/tests/teaching-observation-validator.test.ts apps/server/src/modules/interactive-teaching/tests/teaching-state-reducer.test.ts && corepack pnpm --filter @learning-more/server typecheck`

Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/modules/interactive-teaching
git commit -m "feat: add validated teaching state reducer"
```

---

### Task 4: 持久化教学观察、账本和检查点

**Files:**
- Create: `apps/server/src/modules/interactive-teaching/ports/teaching-ledger-repository.ts`
- Create: `apps/server/src/persistence/teaching-ledger-repositories.ts`
- Create: `apps/server/src/persistence/teaching-ledger-repositories.contract.test.ts`
- Modify: `apps/server/src/persistence/paths.ts`
- Modify: `apps/server/src/persistence/course-archive-store.ts`
- Modify: `apps/server/src/persistence/course-archive-store.contract.test.ts`

**Interfaces:**
- Produces: `TeachingLedgerRepository.get(sessionId)` and `save(tx, record, expectedVersion)`。
- Record atomically contains: ordered observations, current state, frozen checkpoints, resourceVersion。
- Consumed by: Task 6 and deletion recovery in Task 10。

- [ ] **Step 1: 写 Repository 合同失败测试**

```ts
await repository.save(tx, {
  sessionId: 'session_1',
  lessonId: 'lesson_1',
  observations: [observation],
  state,
  checkpoints: [],
  resourceVersion: 0,
}, 0);

expect((await repository.get('session_1'))?.state.ledgerVersion).toBe(1);
await expect(repository.save(tx, staleRecord, 0)).rejects.toMatchObject({
  code: 'repository_version_conflict',
});
```

- [ ] **Step 2: 实现内存和本地文件 Adapter**

本地文件使用 `work/teaching-ledgers/<sha256(sessionId)>.json`，沿用 `checksumJson`、Zod parse、UnitOfWork staging 和资源版本冲突规则。观察和 Reducer 结果必须一次原子保存。

- [ ] **Step 3: 测试重建等价性**

从 `LessonDefinition + active observations` 重放 Reducer，断言与持久化 state 的 `sourceSnapshotHash` 和内容一致；不一致报 `teaching_ledger_projection_mismatch`。

- [ ] **Step 4: 接入课程永久删除**

删除 Manifest 必须包含课节所属教学账本、观察和检查点。删除通过 session/lesson/course 引用查找，不依赖文件名猜测；失败不得留下仍可被档案或画像读取的来源。

- [ ] **Step 5: 运行 Repository 与删除测试**

Run: `corepack pnpm vitest run apps/server/src/persistence/teaching-ledger-repositories.contract.test.ts apps/server/src/persistence/course-archive-store.contract.test.ts`

Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/modules/interactive-teaching/ports/teaching-ledger-repository.ts apps/server/src/persistence/teaching-ledger-repositories.ts apps/server/src/persistence/teaching-ledger-repositories.contract.test.ts apps/server/src/persistence/paths.ts apps/server/src/persistence/course-archive-store.ts apps/server/src/persistence/course-archive-store.contract.test.ts
git commit -m "feat: persist teaching observations and ledger"
```

---

### Task 5: 实现上下文装配与教学智能体 Adapter

**Files:**
- Create: `apps/server/src/modules/interactive-teaching/ports/teaching-context-sources.ts`
- Create: `apps/server/src/modules/interactive-teaching/ports/teaching-agent.ts`
- Create: `apps/server/src/modules/interactive-teaching/implementation/context-assembler.ts`
- Create: `apps/server/src/modules/interactive-teaching/implementation/generation-teaching-agent.ts`
- Create: `apps/server/src/modules/interactive-teaching/tests/context-assembler.test.ts`
- Create: `apps/server/src/modules/interactive-teaching/tests/generation-teaching-agent.test.ts`
- Modify: `apps/server/src/ai-providers/mock-provider.ts`

**Interfaces:**
- Produces: `TeachingContextAssembler.assemble(input): Promise<TeachingContextPackage>`。
- Produces: `TeachingAgent.submit/complete/stop` Adapter around GenerationRuntime。
- Consumes: course/lesson facts, materialized messages, Review excerpts, ledger, `PersonalizationContextSource`。

- [ ] **Step 1: 写上下文优先级失败测试**

测试包必须包含：当前消息、绑定版本的课程课节地图、全部当前核心知识点、`courseMode`、可选 `playIntent`、账本开放项、账本游标后消息、相关材料、Review 和个性化视图。Token 预算不足时依次裁剪：长期弱信号、较远 Review、较远对话、材料扩展；不可裁剪当前消息、当前核心知识点和开放项来源。标准模式断言 `playIntent` 缺席；八种玩法断言只出现一段完整意图且不存在 `modeWeight`、玩法步骤或回合配额。

- [ ] **Step 2: 实现来源 Port，禁止 Blind Ref**

```ts
export interface TeachingContextSources {
  getCourseAndLesson(lessonId: string): Promise<CourseLessonTeachingContext>;
  listMessages(sessionId: string): Promise<readonly MaterializedTeachingMessage[]>;
  listRelevantFinalReviews(courseId: string, lessonId: string): Promise<readonly SourceExcerpt[]>;
  listRelevantMaterialExcerpts(lessonId: string): Promise<readonly SourceExcerpt[]>;
  getLearningStartSummary(courseId: string): Promise<string | undefined>;
  getPersonalizationView(query: PersonalizationQuery): Promise<PersonalizationView>;
}
```

Adapter 层必须读取 Artifact 正文并校验 hash；传给模型的包中不得出现未解析 `artifactRef`、文件路径或 `templateRef`。

- [ ] **Step 3: 实现五层装配和来源注释**

每个片段带 `sourceRef`、版本、摘取原因和是否可裁剪。第二层拆成 2A 课程/本课责任事实和 2B 玩法倾向：2A 不可被 2B 覆盖；2B 只在多个合格教学动作之间择优。当前明确表达覆盖历史弱信号只影响本次上下文排序，不改写全局用户档案。

- [ ] **Step 4: 写教学智能体请求测试**

断言请求不含 `lesson-response@v1`、固定步骤、固定题量、八玩法专属模板或范围白名单；包含已经物化的 `TeachingContextPackage`。

- [ ] **Step 5: 实现短能力合同**

```ts
const TEACHING_CAPABILITY = [
  '依据提供的真实上下文继续当前互动式教学。',
  '核心知识点是教学责任而不是固定顺序；根据学习者最新表达自由决定讲解、提问、案例、教学支线和节奏。',
  '玩法意图只在出现自然教学机会时影响下一步选择，不必每回合显式呈现，也不规定输出形式。',
  '不要把缺少证据的掌握状态当作事实。只输出学习者可见的 Markdown。',
].join('\n');
```

业务层不按玩法、学科或课节拼接额外指令。GenerationRuntime 现有 `prompt` 字段仅作为 Provider 文本运输；后续重命名不影响业务 Interface。

- [ ] **Step 6: 让 Mock Provider 可按请求返回教学/观察/Review fixture**

把 `scriptFactory` 改为 `(request, attempt) => steps`，保证离线测试能按 `taskKind` 或输入合同提供不同结果，而不是所有任务都返回候选大纲。

- [ ] **Step 7: 运行测试**

Run: `corepack pnpm vitest run apps/server/src/modules/interactive-teaching/tests/context-assembler.test.ts apps/server/src/modules/interactive-teaching/tests/generation-teaching-agent.test.ts apps/server/src/modules/generation-runtime/tests/provider-contract.test.ts`

Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/modules/interactive-teaching apps/server/src/ai-providers/mock-provider.ts
git commit -m "feat: assemble materialized teaching context"
```

---

### Task 6: 实现逐回合观察队列与 InteractiveTeaching Interface

**Files:**
- Create: `apps/server/src/modules/interactive-teaching/ports/teaching-observer.ts`
- Create: `apps/server/src/modules/interactive-teaching/implementation/generation-teaching-observer.ts`
- Create: `apps/server/src/modules/interactive-teaching/implementation/observation-queue.ts`
- Create: `apps/server/src/modules/interactive-teaching/implementation/interactive-teaching.ts`
- Create: `apps/server/src/modules/interactive-teaching/tests/generation-teaching-observer.test.ts`
- Create: `apps/server/src/modules/interactive-teaching/tests/observation-queue.test.ts`
- Create: `apps/server/src/modules/interactive-teaching/tests/interactive-teaching.test.ts`
- Modify: `apps/server/src/http/routes/learning-sessions.ts`
- Modify: `apps/server/src/http/routes/learning-sessions.test.ts`
- Modify: `apps/server/src/bootstrap/local-application.ts`

**Interfaces:**
- Produces public deep module methods: `advanceTurn`, `stopTurn`, `getTeachingState`, `freezeCheckpoint`。
- Consumes Task 2 session effects, Task 3 Reducer, Task 4 Repository, Task 5 context/agent。
- Produces validated observations and frozen checkpoints for Tasks 7 and 9。

- [ ] **Step 1: 写公开 Interface 合同测试**

```ts
const accepted = await teaching.advanceTurn({
  lessonId: 'lesson_1',
  sessionId: 'session_1',
  userMessageId: 'message_user_1',
  userContentArtifactRef: 'artifact_user_1',
}, commandContext);

expect(accepted.taskId).toMatch(/^task_/u);
await observerHarness.drain('session_1');
expect((await teaching.getTeachingState('session_1')).ledgerVersion).toBe(1);
```

同一合同测试调用 `stopTurn({ sessionId, taskId })`，断言部分 Markdown 以 `completionStatus = interrupted` 记录且不建立掌握证据；HTTP 停止操作不得直接调用 GenerationRuntime。

- [ ] **Step 2: 实现结构化观察 Adapter**

观察输入只包含本回合完整消息、课程/课节上下文、前一账本和有效来源 ID。观察输出必须通过 `TeachingObservationSchema` 和 Task 3 validator；允许 `entries: []`。观察指令只描述结构、局部性、来源和禁止推断，不包含固定画像维度：

```ts
const OBSERVATION_CAPABILITY = [
  '只观察给定回合相对于当前课节和前一账本产生的局部教学事实。',
  '所有关系和条目必须引用给定的有效来源 ID；不能推断稳定人格、能力等级或学习风格。',
  '与课程相关但不属于本课的探索记为 adjacent；不确定时使用 unclear；没有可靠变化时返回空 entries。',
  '只返回符合 TeachingObservationSchema 的结构化数据。',
].join('\n');
```

- [ ] **Step 3: 实现会话级串行队列**

正常路径每个完整助手回复排队一次。队列键为 `sessionId`，任务幂等键为 `sessionId + sourceSnapshotHash + observerVersion`。同会话严格按消息顺序提交；不同会话可并行。

- [ ] **Step 4: 原子提交观察和账本效果**

先校验观察，再 Reducer，再在同一 UnitOfWork 保存观察与账本。只有新状态把 `evidenceCheckpoint` 从 false 变为 true 时，调用 Task 2 的 `EstablishEvidenceCheckpoint`；失败不得部分写入。

- [ ] **Step 5: 实现 `advanceTurn`**

顺序固定为：保存/追加用户消息 → 装配上下文 → 提交教学任务 → 发布 Markdown → 记录完整助手消息 → 排队观察。教学智能体不能直接拿到 Repository 或业务命令。

- [ ] **Step 6: 处理观察陈旧与下一回合**

观察 pending 时下一次装配使用最后稳定账本并附加 `unobservedMessages`，不阻塞教学。观察失败时状态为 failed，保留原始消息并允许恢复。

- [ ] **Step 7: 改造 HTTP 路由**

消息路由不再分别调用 session module 和 session generation coordinator，只保存用户 Artifact 后调用 `InteractiveTeaching.advanceTurn`。停止生成通过深模块内部 TeachingAgent Adapter，不能绕过消息完成状态记录。

- [ ] **Step 8: 测试玩法与 adjacent 自由度**

用相同 Interface 运行 standard、brainstorm 和 case_study fixture；断言没有玩法专属状态字段。相同主题和用户轨迹下，标准模式不携带 `playIntent`；两种玩法只在存在自然教学机会时呈现可辨认关注点，不复用固定回复结构。用户课程邻接脑洞产生 `adjacent_exploration` 和教学支线，正文不被重写，本课覆盖不变化。

- [ ] **Step 9: 运行测试**

Run: `corepack pnpm vitest run apps/server/src/modules/interactive-teaching apps/server/src/http/routes/learning-sessions.test.ts apps/server/src/bootstrap/local-application.test.ts`

Expected: PASS。

- [ ] **Step 10: Commit**

```bash
git add apps/server/src/modules/interactive-teaching apps/server/src/http/routes/learning-sessions.ts apps/server/src/http/routes/learning-sessions.test.ts apps/server/src/bootstrap/local-application.ts
git commit -m "feat: orchestrate observed teaching turns"
```

---

### Task 7: 用教学检查点驱动阶段与最终 Review

**Files:**
- Modify: `apps/server/src/modules/review-closure/interface.ts`
- Modify: `apps/server/src/modules/review-closure/model/review-state.ts`
- Modify: `apps/server/src/modules/review-closure/implementation/stage-review.ts`
- Modify: `apps/server/src/modules/review-closure/implementation/lesson-closure.ts`
- Modify: `apps/server/src/modules/review-closure/implementation/final-review-validator.ts`
- Modify: `apps/server/src/modules/review-closure/tests/stage-review.test.ts`
- Modify: `apps/server/src/modules/review-closure/tests/lesson-closure.test.ts`
- Modify: `apps/server/src/modules/learning-session/implementation/abandon-lesson.ts`
- Modify: `apps/server/src/http/routes/review-closure.ts`
- Modify: `packages/contracts/src/review-closure.ts`
- Modify: `apps/server/src/bootstrap/local-application.ts`

**Interfaces:**
- Consumes: `Pick<InteractiveTeaching, 'freezeCheckpoint'>` through public Interface only。
- Produces: immutable Review source manifest with `teachingCheckpointRef`, ledgerVersion and sourceSnapshotHash。
- Produces: Review reference for Task 9 user profile ingestion。

- [ ] **Step 1: 写失败测试，拒绝客户端权威来源快照**

HTTP `BeginLessonClosure` body 只保留用户 `endIntent`；`sourceMessageIds`、`sourceSessionIds` 和 `messageRangeChecksum` 必须由服务器从冻结检查点生成。测试伪造客户端 checksum 不再影响关闭输入。

- [ ] **Step 2: 修改 StageReview 与 LessonClosure manifest**

```ts
type LessonReviewInputManifest = Readonly<{
  lessonId: string;
  checkpointId: string;
  teachingCheckpointRef: string;
  teachingLedgerVersion: number;
  sourceSnapshotHash: string;
  previousStageReviewRef?: string;
}>;
```

Review 任务读取已经物化的检查点内容，不接收盲 `session-snapshot:<hash>`。

- [ ] **Step 3: 让放弃流程先冻结再决定保留**

`freezeCheckpoint(reason = evidenced_abandon)` 返回 `retentionDecision`。pending/failed 观察一律 preserve 并进入可重试状态；只有 complete + evidenceCheckpoint false 才允许空会话回收。

- [ ] **Step 4: Review 自由 Markdown 生成**

Review 能读取讲解覆盖、掌握支持/限制证据、开放项和教学支线。生成合同不要求固定标题或段落；Validator 只校验 Markdown 完整性、来源快照一致性、无未知内部引用和最终不可变性，不以标题正则模板化输出。

- [ ] **Step 5: 测试 adjacent 在 Review 中的边界**

Review fixture 可以自然记录课程邻接探索，但关闭判断仍只依据当前课节核心知识责任；支线不能把未来课节写成完成。

- [ ] **Step 6: 移除本地应用硬编码 Review**

删除 `# Stage Review\nLearning preserved...` 和 `# Final Review\nLearning completed.` 取消任务后硬编码路径，改为真实 Review Agent/GenerationRuntime 完成和 commit。

- [ ] **Step 7: 运行 Review 与关闭测试**

Run: `corepack pnpm vitest run apps/server/src/modules/review-closure apps/server/src/http/routes/review-closure.test.ts apps/server/src/modules/learning-session/tests/abandon-lesson.test.ts`

Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/modules/review-closure apps/server/src/modules/learning-session/implementation/abandon-lesson.ts apps/server/src/http/routes/review-closure.ts packages/contracts/src/review-closure.ts apps/server/src/bootstrap/local-application.ts
git commit -m "feat: generate reviews from teaching checkpoints"
```

---

### Task 8: 建立 GlobalUserProfile 深模块并迁移候选证据模型

**Files:**
- Move/Rewrite: `apps/server/src/modules/profile-evidence/interface.ts` → `apps/server/src/modules/global-user-profile/interface.ts`
- Move/Rewrite: `apps/server/src/modules/profile-evidence/implementation/**` → `apps/server/src/modules/global-user-profile/implementation/**`
- Move/Rewrite: `apps/server/src/modules/profile-evidence/ports/**` → `apps/server/src/modules/global-user-profile/ports/**`
- Move/Rewrite: `apps/server/src/modules/profile-evidence/tests/**` → `apps/server/src/modules/global-user-profile/tests/**`
- Move/Rewrite: `apps/server/src/persistence/profile-evidence-repositories.ts` → `apps/server/src/persistence/global-user-profile-repositories.ts`
- Move/Rewrite: `apps/server/src/persistence/profile-evidence-repositories.contract.test.ts` → `apps/server/src/persistence/global-user-profile-repositories.contract.test.ts`
- Modify: `packages/contracts/src/profile.ts`
- Modify: `apps/server/src/http/routes/profile.ts`
- Modify: `apps/server/src/bootstrap/local-application.ts`
- Modify: all imports from `modules/profile-evidence/interface.ts`

**Interfaces:**
- Produces: `GlobalUserProfile.ingestCheckpoint`, `getPersonalizationView`, `createConsumerSnapshot`, `retractCourseSources`。
- Produces: canonical `UserProfileEvidence` storage and legacy read migration。
- Consumed by: Task 9 learning portrait and Task 5 personalization adapter。

- [ ] **Step 1: 写 Schema 迁移失败测试**

测试新记录含 `summary/explicitness/sourceType/sourceRefs/sourceGroupId/dependentSourceGroupIds/sourceSnapshotHash/qualityFlags/safety/supersedes/version/status`，且新写入口拒绝 `claimDimension`、`strength` 和 `polarity`。

- [ ] **Step 2: 建立新的深模块 Interface**

```ts
export interface GlobalUserProfile {
  ingestCheckpoint(input: UserProfileCheckpointManifest): Promise<UserProfileIngestionResult>;
  getPersonalizationView(input: PersonalizationQuery): Promise<PersonalizationView>;
  createConsumerSnapshot(input: ConsumerSnapshotQuery): Promise<GlobalUserProfileSnapshot>;
  retractCourseSources(courseId: string): Promise<void>;
}
```

事实投影、证据提炼、来源组、backlog、失效和消费清单均留在模块内部。

- [ ] **Step 3: 迁移持久化路径**

新写路径使用 `user-profile/evidence`、`user-profile/checkpoints`、`user-profile/rejections` 和 `user-profile/snapshots`。Repository 在启动迁移阶段可以读取旧 `portrait-evidence/*`，转换后写入新路径并记录 migration receipt；运行期不得双写。

- [ ] **Step 4: 重写现有事实 Extractor 输出**

生命周期与统计事实只产生中性局部候选，不生成固定学习风格维度或强度分数。Review availability 本身不是语义证据；只有读取受控 Review/检查点后才能形成候选。

- [ ] **Step 5: 实现消费快照和个性化视图**

档案快照确定性列出统计快照、active+usable evidence、Artifact 索引、游标、完整性和 backlog。`PersonalizationView` 只返回当前用途相关、带来源和限制的显式目标/约束及少量观察；不得包含学习画像 Markdown。

- [ ] **Step 6: 更新 API 命名和兼容边界**

服务内部类型和模块统一使用 `UserProfileEvidence`/`GlobalUserProfile`。如暂时保留 `/api/v1/portrait-evidence` 兼容路由，只能作为 deprecated read adapter，并在响应头/契约中标记迁移；新写入和学习画像消费不得依赖旧名。

- [ ] **Step 7: 运行档案模块与 Repository 测试**

Run: `corepack pnpm vitest run apps/server/src/modules/global-user-profile apps/server/src/persistence/global-user-profile-repositories.contract.test.ts packages/contracts/src/global-user-profile.test.ts`

Expected: PASS，且 `rg "claimDimension|strength:|polarity:" apps/server/src/modules/global-user-profile` 无权威证据模型匹配。

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/modules/global-user-profile apps/server/src/persistence/global-user-profile-repositories.ts apps/server/src/persistence/global-user-profile-repositories.contract.test.ts packages/contracts/src/profile.ts apps/server/src/http/routes/profile.ts apps/server/src/bootstrap/local-application.ts
git rm -r apps/server/src/modules/profile-evidence apps/server/src/persistence/profile-evidence-repositories.ts
git commit -m "refactor: separate global user profile from portrait"
```

---

### Task 9: 从教学检查点提炼档案证据并让学习画像只读消费

**Files:**
- Create: `apps/server/src/modules/global-user-profile/implementation/teaching-checkpoint-extractor.ts`
- Create: `apps/server/src/modules/global-user-profile/implementation/checkpoint-ingestion.ts`
- Create: `apps/server/src/modules/global-user-profile/tests/teaching-checkpoint-extractor.test.ts`
- Create: `apps/server/src/modules/global-user-profile/tests/checkpoint-ingestion.test.ts`
- Modify: `apps/server/src/modules/learning-portrait/interface.ts`
- Modify: `apps/server/src/modules/learning-portrait/implementation/evidence-packer.ts`
- Modify: `apps/server/src/modules/learning-portrait/implementation/portrait-input-manifest.ts`
- Modify: `apps/server/src/modules/learning-portrait/implementation/portrait-pipeline.ts`
- Modify: `apps/server/src/modules/learning-portrait/tests/evidence-packer.test.ts`
- Modify: `apps/server/src/modules/learning-portrait/tests/portrait-pipeline.test.ts`
- Modify: `apps/server/src/bootstrap/local-application.ts`

**Interfaces:**
- Consumes: `TeachingCheckpointSnapshot` plus optional Review ref and LearningFacts snapshot。
- Produces: zero or more `UserProfileEvidence` records in same lesson source group。
- Produces: `GlobalUserProfileSnapshot` consumed read-only by `learning-portrait`。

- [ ] **Step 1: 写候选提炼失败测试**

覆盖：

- 无学习者新信息时返回 `[]`；
- 用户明确目标/约束为 `user_declared`；
- 真实解释、纠偏、问题和教学支线可为 `ai_observed`；
- 助手讲解本身不能推断学习者掌握；
- 阶段/最终 Review 与原会话使用相同 `sourceGroupId`；
- adjacent 可以成为局部候选，但不固化为稳定偏好；
- interrupted/off_scope 来源默认不产生可用候选。

- [ ] **Step 2: 实现检查点 Manifest 与幂等摄取**

```ts
type UserProfileCheckpointManifest = Readonly<{
  checkpointId: string;
  checkpointReason: 'manual_pause' | 'evidenced_abandon' | 'lesson_closure';
  sourceSnapshotHash: string;
  teachingCheckpointRef: string;
  reviewRef?: string;
  sourceGroupId: string;
  dependentSourceGroupIds: readonly string[];
  completeness: 'complete' | 'partial';
}>;
```

同一快照和 extractorVersion 幂等；模型/规则升级生成新版本并 supersede 旧记录。partial 检查点可排 backlog，但不得输出看似完整的长期结论。

- [ ] **Step 3: 在暂停、放弃、最终 Review 后编排摄取**

组合根负责把冻结检查点和 Review 引用交给 `GlobalUserProfile.ingestCheckpoint`。`interactive-teaching` 和 `review-closure` 均不得直接 import 档案实现。

- [ ] **Step 4: 改造 LearningPortrait 消费关系**

`learning-portrait` 从 `global-user-profile/interface.ts` 读取冻结消费快照。Evidence Packer 不再按固定 dimension priority 或 strength score 排序；只使用证据状态、安全、来源独立性、时间窗口、限制/反例和 token budget。

- [ ] **Step 5: 更新 Portrait manifest**

用 `globalUserProfileVersion`、`consumerSnapshotHash` 和 `generationPolicyVersion` 替代含混的 `profileVersion`/`promptTemplateVersion`。画像任务成功后只把版本引用写入档案索引，不把画像正文或洞察回灌为候选证据。

- [ ] **Step 6: 测试两个消费者互不回写**

教学个性化读取 `PersonalizationView`；学习画像读取 `GlobalUserProfileSnapshot`。断言画像完成后 candidate count 不增加，教学上下文也不包含画像 Markdown。

- [ ] **Step 7: 运行档案与画像测试**

Run: `corepack pnpm vitest run apps/server/src/modules/global-user-profile apps/server/src/modules/learning-portrait`

Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/modules/global-user-profile apps/server/src/modules/learning-portrait apps/server/src/bootstrap/local-application.ts
git commit -m "feat: ingest teaching checkpoints into user profile"
```

---

### Task 10: 恢复、删除、架构门与端到端纵向验证

**Files:**
- Create: `tools/architecture/src/teaching-data-boundaries.test.ts`
- Create: `apps/server/src/modules/interactive-teaching/tests/vertical-slice.test.ts`
- Modify: `apps/server/src/bootstrap/local-application.test.ts`
- Modify: `apps/server/src/persistence/course-archive-store.contract.test.ts`
- Modify: `tools/architecture/src/profile-data-boundaries.test.ts`
- Modify: `CHANGELOG.md`
- Modify: `docs/基础模块功能等价清单与回归基线.md`

**Interfaces:**
- Verifies the complete slice and every cross-module ownership rule。

- [ ] **Step 1: 写启动恢复失败测试**

构造消息日志末尾晚于账本游标、服务重启、观察任务未提交的场景。启动恢复必须按消息顺序补排观察；同一 snapshot/version 不重复写。failed 观察保留会话并暴露恢复状态。

- [ ] **Step 2: 写完整纵向 E2E 测试**

测试流程：

1. 用户提出本课问题；
2. 教学智能体自由回复；
3. 观察器记录讲解和学习者证据；
4. 账本更新并进入下一回合上下文；
5. 用户提出课程相关但非本课脑洞，形成 adjacent 教学支线；
6. 支线不更新本课覆盖且不完成未来课节；
7. 最终检查点冻结并生成 Review；
8. 档案提炼器生成带精确来源、同来源组的候选证据；
9. 学习画像 manifest 包含该档案证据，但画像结果不回写；
10. 课程删除撤销消息、观察、账本、Review、事实、档案证据和画像引用。

- [ ] **Step 3: 写架构边界测试**

断言：

- 其他 server module 只能 import `interactive-teaching/interface.ts`；
- `learning-portrait` 只能 import `global-user-profile/interface.ts`，不得 import其 implementation/repository；
- `interactive-teaching` 不 import `review-closure`、`global-user-profile` 或 `learning-portrait`；
- `review-closure` 不扫描 `message-log.ts`；
- `global-user-profile` 不包含 Provider/页面/网络/write lease 遥测；
- 学习画像完成路径不调用档案 evidence save。

- [ ] **Step 4: 验证删除和失效重建**

课程永久删除后，旧 `sourceRefs` 无法按需读取，档案 snapshot 不含被删 evidence，画像刷新状态进入 updating/failed-safe；重算失败也不得展示含被删来源的旧画像。

- [ ] **Step 5: 更新回归基线和 Changelog**

记录新深模块 Interface、`adjacent` 语义、观察恢复、Review 来源和全局用户档案/学习画像分离。不要新增固定 AI 文案快照作为回归标准；使用语义不变量。

- [ ] **Step 6: 运行聚焦验证**

Run: `corepack pnpm vitest run apps/server/src/modules/interactive-teaching apps/server/src/modules/review-closure apps/server/src/modules/global-user-profile apps/server/src/modules/learning-portrait apps/server/src/persistence/course-archive-store.contract.test.ts tools/architecture/src/teaching-data-boundaries.test.ts`

Expected: PASS。

- [ ] **Step 7: 运行架构、类型和 Schema 门**

Run: `corepack pnpm typecheck && corepack pnpm schema:check && corepack pnpm architecture:check && corepack pnpm equivalence:check`

Expected: PASS。

- [ ] **Step 8: 运行完整验证**

Run: `corepack pnpm verify`

Expected: PASS；如存在与本切片无关的用户工作区既有失败，单独记录命令、失败文件和证据，不把它们混入本切片修复。

- [ ] **Step 9: Commit**

```bash
git add tools/architecture/src/teaching-data-boundaries.test.ts tools/architecture/src/profile-data-boundaries.test.ts apps/server/src/modules/interactive-teaching/tests/vertical-slice.test.ts apps/server/src/bootstrap/local-application.test.ts apps/server/src/persistence/course-archive-store.contract.test.ts CHANGELOG.md docs/基础模块功能等价清单与回归基线.md
git commit -m "test: verify interactive teaching vertical slice"
```

---

## Delivery Order and Review Gates

1. Tasks 1–4 建立不依赖真实模型的合同、语义和持久化基础；完成后可独立审查数据正确性。
2. Tasks 5–6 接入高自由度教学与逐回合观察；完成后可独立运行互动教学，不依赖 Review/画像。
3. Task 7 接入 Review；完成后形成课节闭环。
4. Tasks 8–9 完成全局用户档案和学习画像消费分离；完成后形成长期数据链。
5. Task 10 负责恢复、删除、架构和端到端总门，不代替前面各 Task 的单元测试。

每个 Gate 必须先审查来源权威、幂等、失败策略和自由度约束，再进入下一组任务。
