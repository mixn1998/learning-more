# AI 业务控制链总设计：真实生成闭环与七条纵向切片

**状态：** 待用户复核  
**日期：** 2026-07-14  
**适用项目：** Learning MORE

## 1. 目标

本设计把当前仓库中“看起来在使用 AI”但尚未形成真实业务闭环的场景，改造成可恢复、可校验、可审计的 AI 业务控制链。实施完成后：

1. 学习起点评估是至少三个完整回合的真实 AI 对话；第三回合完成后必须开放候选大纲生成，用户可自行决定是否继续更多评估回合。
2. 候选大纲由真实主题、对话、材料和玩法意图生成；生成后用户仍可与 AI 对齐需求，并触发整版重生或模块微调。
3. 计划流、周报和学习画像不再创建任务后立即取消并使用硬编码结果。
4. 下一课推荐和画像候选证据提炼达到现有业务规则声明的 AI 能力，而不是固定选择或仅靠事实字段映射。
5. 已经形成真实闭环的互动教学、教学观察、教学状态账本、阶段/最终/课程 Review、思维行为动态分析和 Provider 运行时保持原有深模块，不重复建设。

## 2. 全局设计原则

### 2.1 自由生成与业务控制分离

- 面向用户的对话智能体只输出自然 Markdown，不承担隐藏 JSON、业务状态迁移或数据治理结论。
- 需要结构化判断时使用独立的后置观察器或规划器；其输出经 Schema 和领域规则校验后才能驱动状态。
- Prompt 只保留短小能力契约。主题、材料、消息、候选、Review、事实和画像证据必须以物化上下文包提供，不能只把不存在于 Provider 视野中的 artifact ref 交给模型。
- AI 决定内容、表达、解释和合理的调整策略；程序决定最少轮次、写入权、版本、确认、不可变性、幂等、失败恢复和证据权限。

### 2.2 所有 AI 场景统一通过七步闭环验收

```text
业务触发
  → 冻结并物化输入快照
  → 提交真实生成任务
  → 获得完整或流式结果
  → 结构/来源/领域校验
  → 业务模块原子提交
  → 失败、重试、取消与重启恢复
```

任务被创建不等于 AI 功能已完成。缺少结果消费、校验、提交或恢复中的任一环，均视为控制链不完整。

### 2.3 不以一个超级模块吞并业务域

`generation-runtime` 只负责 Provider、调度、任务、流式帧、终态和恢复，不解释课程、计划、周报或画像语义。各业务深模块拥有自己的输入包、结果校验器和提交规则。公共运行能力通过一个小 interface 提供，业务结果不会集中到组合根硬编码。

## 3. 审计结论与实施范围

| 场景 | 当前状态 | 本设计决策 |
| --- | --- | --- |
| 起点评估 | 单条用户输入直接完成，无 AI 回复 | 切片 1 重建 |
| 候选大纲 | 调用模型但只传引用，真实上下文未物化 | 切片 1 重建输入与结果链 |
| 候选调整 | 没有对齐对话、整版重生和模块微调策略 | 切片 1 新增 |
| 阅读材料 | 文件解析真实；语义未进入评估/候选上下文 | 切片 1 接入 |
| 互动教学/观察/账本 | 真实 Agent、Observer、Ledger 链路 | 保留并复用模式 |
| 阶段/最终/课程 Review | 真实证据包、AI 生成和提交 | 保留 |
| 思维行为分析 | 真实生成、校验和版本化 | 保留 |
| 计划流 | AI 任务被取消，固定日期和解释代替结果 | 切片 3 重建 |
| 周报 | AI 任务被取消，固定统计文案代替结果 | 切片 4 重建 |
| 学习画像 | AI 任务被取消，程序拼接固定洞察 | 切片 5 重建 |
| 下一课推荐 | 固定选择第一课/新版第一课 | 切片 6 新增 |
| 画像候选证据 | 主要按事实字段提取，未消费受控对话检查点 | 切片 7 深化 |

## 4. 纵向切片 1：课程创建对话与候选调整

### 4.1 领域术语

- **课程创建消息（OutlineMessage）**：课程创建会话中的不可变用户或 assistant 消息。
- **完整评估回合（AssessmentRound）**：一条用户消息和随后一条 `complete` assistant 回复。主页提交的初始课程方向物化为第一条用户消息，AI 对它的完整回复构成第 1 回合；固定开场白、残缺回复、失败回复和仅用户消息都不计数。
- **基础评估完成（BaselineAssessmentCompleted）**：完整评估回合数达到 3。它只表示用户取得生成权，不表示信息客观充分或课程已经创建。
- **候选对齐回合（CandidateAlignmentRound）**：存在候选后，为澄清、解释或调整该候选发生的用户消息与 assistant 回复。
- **整版重生（full_regeneration）**：基于完整上下文和当前候选生成一个新的完整候选版本。
- **模块微调（module_patch）**：只替换选定模块的内容；未选模块由程序保证不变，结果仍保存为新的完整候选快照。

### 4.2 业务状态

`OutlineSession` 使用以下可观察状态：

```text
assessing
  → assessment-turn-running
  → assessing                     完整回合 < 3
  → assessment-ready              完整回合 >= 3
  → candidate-generating
  → candidate-ready
  → alignment-turn-running
  → candidate-ready               仅澄清/解释
  → candidate-updating
  → candidate-ready               新候选版本完成
  → confirming
  → confirmed
```

状态不通过页面文案推断。会话同时保存 `messageIds`、`completedAssessmentRounds`、`candidateVersionIds`、`latestCandidateVersionId`、`activeTaskId` 和资源版本。

### 4.3 三轮门槛与用户选择权

- 主页提交初始课程方向时，创建 OutlineSession 和第一条不可变 `user` OutlineMessage，两者在同一业务命令中落库；进入课程创建页后直接显示该消息，不要求用户再次提交。
- 新会话创建后，系统以这条初始用户消息为当前轮输入，提交第一条真实 assistant 评估回复；不再使用前端固定文案冒充 AI。该回复完整提交后计为第 1 个评估回合。
- 每次 assistant 完整回复提交后，由程序重新计算完整评估回合数。
- 第 1、2 个完整回合结束后，页面只提供继续输入，不显示“跳过评估”或生成候选入口。
- 第 3 个完整回合结束后，状态进入 `assessment-ready`，必须显示“生成候选大纲”；输入框继续可用，用户可以自愿进行任意更多回合。
- AI 可以在回复中建议继续澄清，但不能在第 3 回合后继续锁住生成权。
- 不再保留“随时跳过评估”的产品动作。恢复旧草稿时按实际完整回合数决定入口。

### 4.4 课程创建深模块 interface

外部调用者只需要学习以下行为，不接触 Prompt、观察器、上下文裁剪和存储布局：

```ts
interface CourseAuthoring {
  createSession(input: CreateOutlineSession, context: CommandContext): Promise<OutlineSessionView>;
  advanceConversation(input: AdvanceOutlineConversation, context: CommandContext): Promise<OutlineTurnAccepted>;
  requestCandidate(input: RequestOutlineCandidate, context: CommandContext): Promise<CandidateTaskAccepted>;
  confirmCandidate(input: ConfirmOutlineCandidate, context: CommandContext): Promise<ConfirmedCourseRef>;
  getSession(outlineSessionId: string): Promise<OutlineSessionView>;
}
```

`advanceConversation` 在评估期和候选期复用同一入口。模块内部根据当前状态选择评估上下文或候选对齐上下文。

### 4.5 内部 Agent 与观察/规划 seam

```ts
interface AuthoringConversationAgent {
  submit(context: AuthoringConversationContext): Promise<{ taskId: string }>;
  complete(taskId: string): Promise<{ markdown: string }>;
}

interface AuthoringTurnObserver {
  observe(turn: CompletedAuthoringTurn): Promise<AuthoringTurnObservation>;
}
```

`AuthoringConversationAgent` 只生成用户可见 Markdown。`AuthoringTurnObserver` 是内部 seam，输出：

- 本轮明确新增的目标、基础、约束、材料关注点和纠正；
- 仍需澄清但不得阻断三轮后生成权的开放问题；
- 候选期的调整意图：`clarify`、`full_regeneration` 或 `module_patch`；
- `module_patch` 的目标 moduleId 列表和用户要求来源消息。

观察结果不进入用户档案，不替代原始消息，也不强迫可见回复采用固定结构。

### 4.6 物化上下文包

评估上下文至少包含：主题、`courseMode`、非强制 `playIntent`、已解析材料的相关正文片段、完整消息尾部、较早消息摘要和当前评估观察。候选生成上下文在此基础上增加全部可追溯评估摘要、材料章节来源、最新候选（若有）和本次调整意图。

Provider 接收到的是实际文本和结构数据，不是无法自行读取的文件路径或 artifact ref。每个片段保留 `sourceRef`、内容哈希和选取原因。

### 4.7 候选结构和模块微调

候选 metadata 增加稳定模块结构：

```ts
type CandidateModule = {
  id: string;
  title: string;
  lessonIds: string[];
};

type CandidateOutlineMetadata = {
  courseGoals: string[];
  disciplineTag: string;
  topicTags: string[];
  modules: CandidateModule[];
  lessons: CandidateLesson[];
};
```

初次生成和整版重生输出完整候选。模块微调只允许生成目标模块片段及其 lesson metadata；`OutlinePatchComposer` 用当前候选替换目标模块，确定性保留其他模块，再编译为新的完整 Markdown 快照。校验器拒绝：

- 修改目标之外的模块；
- 引用不存在的 lessonId、moduleId 或 sourceRef；
- 丢失核心知识点、材料必要范围或先修关系；
- 产生循环依赖、重复 ID、空模块或非法 HTML。

每个新候选保存 `supersedesCandidateVersionId`、`changeKind`、`targetModuleIds`、输入快照哈希和完整 Markdown。旧候选永久保留，只有最新候选可确认。

候选生成使用独立的最小机器输出协议，不让模型从业务上下文猜测 metadata 字段：

- Provider 上下文先在本地投影为“已知学习背景、原始对话、材料与当前调整”，不暴露 `outlineSessionId`、回合数、messageId 或状态键。
- metadata 只允许 `courseGoals`、`disciplineTag`、`topicTags`、`modules` 和 `lessons`；协议只约束机器接口，不约束后续 Markdown 的教学结构、表达、案例或创造性。
- 同一次生成同时返回严格 metadata 和自由 Markdown，不增加观察调用或二次生成。
- `candidate_invalid`、`generation_timeout` 与 `generation_interrupted` 分开传播和显示；三者均保留草稿与生成权。
- 真实 Provider 错误输出必须作为固定回放 fixture 进入测试，不能只用预制正确 JSON 的 Mock 证明兼容性。

### 4.8 前端行为

- 左侧渲染真实消息列表和流式 assistant 回复，不再渲染固定 `ai/user/follow` 三段；主页初始课程方向是列表中的第一条用户消息，不再另设重复的“来自主页的初始主题”内容卡或预填待发送文本。
- 前两轮不出现生成按钮；第三轮 assistant 完整结束后出现“生成候选大纲”和继续输入。
- 候选生成后，左侧仍保持可输入。AI 可以先澄清；只有后置规划结果为整版重生或模块微调时，右侧进入更新状态。
- 更新时旧候选保持可读，确认按钮禁用；成功后切换到新版本并标记“整版重生”或“微调：模块名”。
- 模块微调高亮受影响模块，不把其他模块表现为重新生成。
- 刷新页面恢复消息、回合数、活动任务、候选版本和未完成流。

### 4.9 数据治理衔接

- 原始 OutlineMessage 由课程创建域拥有，追加保存且不可改写。
- `AssessmentSummary` 是下游课程和教学可消费的派生 Artifact，保留消息来源引用，不冒充用户原话。
- 达到三轮、确认候选、放弃有实质内容的会话是允许提炼画像候选证据的稳定检查点；检查点只提供来源清单，画像证据模块仍需独立提炼和校验。
- 未确认会话来源必须标记为 `unconfirmed_outline_session`，不能形成课程完成或掌握事实。

## 5. 纵向切片 2：通用生成完成与恢复能力

### 5.1 目标

删除组合根中的“提交任务后立刻取消，再手工构造业务结果”。`generation-runtime` 增加小型完成 interface：

```ts
interface GenerationExecution {
  submit(request: GenerationRequest): Promise<GenerationTaskHandle>;
  awaitTerminal(taskId: string): Promise<GenerationTask>;
  stream(taskId: string, cursor?: number): AsyncIterable<GenerationFrame>;
  cancel(taskId: string): Promise<GenerationTask>;
  recover(): Promise<GenerationRecoveryReport>;
}
```

`awaitTerminal` 隐藏本地调度循环和恢复等待；它不解析业务输出。每个业务模块继续负责自己的 `finalize/fail/retry`。

### 5.2 AI 场景注册表

建立集中但只读的场景注册表，记录 `taskKind`、触发器、输入包版本、输出合同、Artifact 类型、完成处理者、失败码、重试和不可变策略。注册表用于启动恢复、运行中心和架构检查，不成为统一 Prompt 中心。

### 5.3 恢复不变量

- 启动时恢复过期 lease，并按 taskKind 把终态任务交给所属业务完成处理者。
- 相同 taskKey 和输入哈希只能连接或复用，不能产生重复业务提交。
- 完成处理者必须校验业务实体当前仍引用该 taskId；过期结果标记 stale，不覆盖新版本。
- 业务提交成功但任务回执未记录时可幂等补写；任务成功但业务提交失败时可重放完成处理者。

## 6. 纵向切片 3：真实 AI 计划流

- 物化课程、可排课课节、用户约束、时间窗、时区和现有排期快照。
- AI 输出严格的 `PlanSuggestion[]`，包含 courseId、lessonId、startAt、endAt、timezoneAtCreation 和 explanation。
- 结果经课节可排性、区间、重复课节、冲突和基础排期版本校验后进入 `preview-ready`。
- 预览失败保留约束和草稿；重试绑定同一输入快照。
- 用户确认前不得写 ScheduleItem；确认仍由现有 planning 深模块执行。
- 删除固定 2026 年日期和“符合用户时间窗”的组合根替代结果。

## 7. 纵向切片 4：真实 AI 周报

- 输入为完整的自然周事实快照，而不是只有快照引用；包含统计口径版本、时区、排除项和哈希。
- AI 只生成用户可见 Markdown，允许自由组织总结、主题重点、限制和下周建议。
- 程序校验周范围、事实数字引用和禁止出现的运行遥测；校验通过后原子最终化。
- 同一周、同一事实哈希幂等；最终化后不可改写。失败保留草稿并允许重试。
- 删除取消任务后写入固定“完成 N 个课节、学习 N 秒”的逻辑。

## 8. 纵向切片 5：真实 AI 学习画像

- `PortraitInputManifest` 的受控内容实际物化给 Provider，包括统计摘要、候选证据、独立来源关系、反向证据、动态思维行为快照、窗口和 token 预算结果。
- AI 自由生成标题、摘要和数量不固定的洞察；结构化输出只用于结果提交，不规定用户可见章节。
- 现有 `validatePortraitOutput` 继续校验证据引用、独立来源、反证、限制和冻结 manifest。
- 成功后创建不可变画像版本并推进 current cursor；失败保留上一成功版本。
- 删除取消任务后按 `claimDimension` 拼接固定句式的逻辑。

## 9. 纵向切片 6：下一课推荐

- 在最终课时 Review 成功后触发，输入确认版大纲、未完成且未放弃课节、依赖、当前课时 Review 和既有进度。
- AI 输出一个 `recommendedLessonId` 和用户可见解释。程序只接受候选集合中的 lessonId；无候选时清空推荐。
- 推荐是建议，不自动开始课节、不改变排期和进度。
- AI 不可用时保留上一次仍有效推荐；若其已完成或放弃，则使用确定性的依赖顺序临时回退并明确标记为 fallback。
- 新版大纲发布后重新验证推荐，不能无条件重置为第一课。

## 10. 纵向切片 7：画像候选证据提炼

- 现有事实提取器继续负责确定性统计证据；新增 AI checkpoint extractor 处理课程创建、教学、补充学习和 Review 的受控检查点。
- 输入只包含净化后的精确片段、来源引用、来源组、场景、时间和检查点状态，不把整段原始会话无界送入画像域。
- 输出是中性、局部的候选证据：摘要、动态 claimDimension、sourceRefs、sourceGroupId、explicitness、qualityFlags、限制和安全状态。
- 禁止直接输出人格、永久能力等级、敏感推断或画像正文。
- 候选经来源存在性、安全、去重、替代/撤回和版本校验后进入全局用户档案；学习画像只消费冻结快照。
- 课程创建未确认会话、残缺 assistant 回复和被撤回来源必须保留相应限制或失效关系。

## 11. 不重做模块及其消费关系

| 现有深模块 | 本设计只提供的新输入/能力 | 保持不变的权威职责 |
| --- | --- | --- |
| `interactive-teaching` | 新的 `learningStartSummary` 与确认版模块结构 | 自由教学、观察、账本、检查点 |
| `review-closure` | 通用 `awaitTerminal` | 阶段/最终/课程 Review 提交规则 |
| `global-user-profile` | 新增受控候选证据和推荐无关的行为快照 | 长期证据、动态维度、消费快照 |
| `learning-portrait` | 真实物化 manifest 和生成结果 | 画像版本、验证、current cursor |
| `planning` | 真实 AI 预览结果 | 冲突校验、确认和 ScheduleItem 写入 |
| `learning-facts` | 真实周报 Markdown | 事实口径、自然周快照、不可变周报 |

## 12. 错误与恢复

统一处理以下场景：

- assistant 回复中断：保存 interrupted 草稿，不计完整回合，用户可重试。
- 第三轮完成后候选生成失败：生成权保持开放，消息和材料不丢失。
- 模块微调输出非法：旧候选继续有效，失败草稿可诊断，不产生半个候选版本。
- Provider 切换或服务重启：按 taskId 和帧游标恢复，不重复追加已完成消息。
- 版本冲突：保留本地输入，重新加载权威消息和候选后允许重新提交。
- 背景任务失败：业务实体进入明确 failed/retryable 状态，不由组合根生成替代内容冒充成功。

## 13. 实施分解与顺序

各切片都必须独立形成“合同—模块—持久化—HTTP—前端—恢复—测试”闭环：

1. 课程创建对话、三轮门槛、真实候选上下文、候选对齐与模块微调。
2. `GenerationExecution.awaitTerminal`、AI 场景注册表和启动恢复分派。
3. 计划流真实 AI 预览。
4. 周报真实 AI 生成与最终化。
5. 学习画像真实 AI 生成与验证。
6. 下一课推荐。
7. 画像候选证据 AI 提炼。

切片 1 可先复用当前运行时的同步执行方式；切片 2 随后统一完成与恢复。切片 3–7 必须依赖切片 2，不再各自复制调度轮询。

实施同时更新《课程创建通用流程与功能逻辑规则》《AI 业务流程场景与输出策略盘点》《课程学习与 Review 功能逻辑规则》《学习画像数据抓取与分析策略规则》和数据源定义清单，删除“随时跳过评估”及已落后于真实控制链的状态描述。文档、Contracts、实现和验收测试必须使用同一组状态名与业务术语。

## 14. 验收与负向断言

### 14.1 课程创建

- 模糊主题提交后 AI 实际追问，状态保持评估中。
- 主页初始课程方向自动成为第一条用户消息；进入创建页不需要再次发送，AI 首次完整回复后回合数为 1。
- 前两个完整回合不存在任何生成/跳过入口。
- 第三个完整回合提交后生成入口必定出现，继续对话仍可用。
- 刷新后消息、回合数和生成权不变。
- 候选输入包含实际主题、消息、材料正文和来源，不只有引用名称。
- 候选后普通解释不会强制更新大纲；明确调整产生整版新版本或目标模块微调版本。
- 模块微调不能改变非目标模块；旧候选仍可读取但不可确认。

### 14.2 其他 AI 场景

- 生产组合根不存在“提交 AI 任务后立即 cancel 并硬编码成功结果”。
- 计划建议来自校验后的模型输出，确认前无排期写入。
- 周报和画像使用真实生成结果；失败不会创建伪成功版本。
- 下一课推荐只引用有效候选课节。
- 画像候选证据全部有可解析来源和受控检查点。

### 14.3 质量门禁

- Contracts/OpenAPI 生成一致。
- 领域状态机、Repository contract、HTTP、前端和恢复测试覆盖每条切片。
- 增加真实 Provider 兼容测试，验证 Provider 能看到物化上下文而不是本地引用。
- 架构检查禁止业务模块直接读取其他域 Repository、禁止组合根构造 AI 业务成功内容、禁止学习遥测进入画像输入。
- 全量 `format`、`lint`、`typecheck`、schema、architecture、unit、build 和关键 Playwright 流程通过。

## 15. 明确不做

- 不建立固定评估问卷、固定三问内容或字段填充 Prompt；三轮只是用户生成权门槛。
- 不让 AI 自动确认候选、自动开始课节、自动确认计划或自动关闭课程。
- 不为八种玩法复制课程创建智能体或状态机；玩法只提供非强制 `playIntent`。
- 不用学习画像 Markdown 反向驱动教学或课程创建。
- 不把运行时 Provider、token、延迟和错误遥测写入学习事实、Review 或全局用户档案。
