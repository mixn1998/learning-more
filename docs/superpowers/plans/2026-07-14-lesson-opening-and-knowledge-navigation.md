# 正式课程首轮教学与知识导航摘要实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让正式课程在进入后由 AI 主动开场，并让课节卡与知识导航展示短标题和逐项核心知识点摘要。

**Architecture:** 新增幂等 opening generation 命令，不伪造用户消息；教学上下文通过 `turnKind: opening` 允许无当前用户原话，教学观察只处理后续包含学习者行为的回合。导航使用前端纯函数投影核心知识点，不改课程大纲事实结构。

**Tech Stack:** React 19、Fastify、Zod contracts、Vitest、现有 GenerationRuntime 与 InteractiveTeaching 模块。

## Global Constraints

- 不新增固定教学 Prompt 模板；opening 只增加主动开场能力契约和自然语言背景。
- 不创建伪造用户消息，不把 opening 作为学习者行为证据。
- `coreKnowledgePoints` 仍是确认版大纲的唯一事实来源。
- 保留现有未提交改动，不执行 reset、checkout 或批量清理。

---

### Task 1: 扩展 opening 上下文接口并补失败测试

**Files:**
- Modify: `apps/server/src/modules/interactive-teaching/interface.ts`
- Modify: `apps/server/src/modules/interactive-teaching/ports/teaching-context-sources.ts`
- Modify: `apps/server/src/modules/interactive-teaching/implementation/context-assembler.ts`
- Modify: `apps/server/src/modules/interactive-teaching/implementation/generation-teaching-agent.ts`
- Test: `apps/server/src/modules/interactive-teaching/tests/context-assembler.test.ts`
- Test: `apps/server/src/modules/interactive-teaching/tests/generation-teaching-agent.test.ts`

**Interfaces:**
- `TeachingContextAssembler.assemble` 接收 `turnKind: 'opening' | 'response'`，`currentUserMessageId` 仅在 `response` 时必需。
- `InteractiveTeaching.openLesson` 接收 `courseId/lessonId/sessionId` 和 `CommandContext`，返回 `{ taskId, resourceVersion }`。

- [x] **Step 1: 添加 opening 装配失败测试**：断言 opening 无用户消息仍能生成 context，response 缺少当前用户消息仍拒绝。
- [x] **Step 2: 添加教学智能体 opening 输入测试**：断言自然语言输入包含本课目标、核心知识点和主动开场意图，不包含“当前诉求｜用户原话”空字段或内部状态键。
- [x] **Step 3: 运行测试确认失败**：`corepack pnpm --filter @learning-more/server test -- context-assembler generation-teaching-agent`，预期新断言失败。
- [x] **Step 4: 实现最小接口扩展**：opening context 允许无 current message，保留上下文裁剪保护；agent 在 opening 时输出主动导入能力说明，response 路径保持原逻辑。
- [x] **Step 5: 运行模块测试确认通过**：同一命令全部通过。

### Task 2: 实现幂等 opening generation 与观察边界

**Files:**
- Modify: `apps/server/src/modules/interactive-teaching/implementation/interactive-teaching.ts`
- Modify: `apps/server/src/http/routes/learning-sessions.ts`
- Modify: `packages/contracts/src/learning-session.ts`
- Test: `apps/server/src/modules/interactive-teaching/tests/interactive-teaching.test.ts`
- Test: `apps/server/src/http/routes/learning-sessions.test.ts`

**Interfaces:**
- 新增 `POST /api/v1/lesson-sessions/:sessionId/opening`，请求体为空，使用 `If-Match` 和页面租约。
- 成功返回既有 `GenerationTaskAcceptedResponseSchema`；已存在 opening 消息或活动任务时返回当前任务/版本，不重复提交。

- [x] **Step 1: 添加路由和模块失败测试**：首次 opening 返回 task；重复 opening 不新增用户消息、不新增第二个任务；opening 完成只保存 assistant 消息。
- [x] **Step 2: 添加观察边界测试**：opening 完成不调用 observer/reasoning sink；随后用户回复仍调用原有观察链路。
- [x] **Step 3: 运行相关测试确认失败**。
- [x] **Step 4: 实现 `openLesson`**：复用现有 task submission、session generation、frame log 和 assistant artifact 完成路径，opening completion 跳过 `observeCompletedTurn`，以 session/message 状态作为幂等依据。
- [x] **Step 5: 注册路由并保持版本控制**：路由解析 session、检查租约/版本、调用 `openLesson`，失败返回可重试 problem。
- [x] **Step 6: 运行 server 模块与路由测试确认通过**。

### Task 3: 前端自动启动、流式展示与失败回退

**Files:**
- Modify: `apps/web/src/client/learning-client.ts`
- Modify: `apps/web/src/features/learning/session-page.tsx`
- Modify: `apps/web/src/features/learning/lesson-session-workspace.tsx`
- Test: `apps/web/src/features/learning/session-page.test.tsx`

**Interfaces:**
- `LearningClient.openLesson(sessionId, resourceVersion)` 调用 opening endpoint，返回 `{ taskId, resourceVersion }`。

- [x] **Step 1: 添加 UI 失败测试**：进入课程后自动调用 opening，不出现用户气泡；状态显示 AI 导入；流式完成后显示 assistant Markdown。
- [x] **Step 2: 添加失败/重试测试**：opening 请求或流断开时显示重试按钮，点击后按最新版本重试；允许用户明确点击“直接开始对话”后恢复输入。
- [x] **Step 3: 运行 SessionPage 测试确认失败**。
- [x] **Step 4: 实现启动协调**：`start()` 后 hydrate，再在没有消息/活动任务时调用 opening；复用现有 stream、refresh、stop 和 version conflict 处理。
- [x] **Step 5: 更新空态文案和按钮状态**：移除“开始提问后……”作为默认空态，区分 opening、生成中、失败和可输入状态。
- [x] **Step 6: 运行 Web 学习模块测试和类型检查确认通过**。

### Task 4: 知识点展示投影与课节卡摘要

**Files:**
- Create: `apps/web/src/features/learning/knowledge-point-presentation.ts`
- Modify: `apps/web/src/features/learning/lesson-entry-page.tsx`
- Modify: `apps/web/src/features/learning/abandoned-lesson-record.tsx`
- Modify: `apps/web/src/features/course/course-page.tsx`
- Modify: `apps/web/src/features/course/outline-view.tsx`
- Test: `apps/web/src/features/learning/knowledge-point-presentation.test.ts`
- Test: `apps/web/src/features/learning/lesson-entry-page.test.tsx`

**Interfaces:**
- `toKnowledgePointPresentation(text): { title: string; summary: string }`；summary 保留原始文本，title 仅为展示投影。
- `toLessonKnowledgeSummary(points): string[]` 返回用于课节卡的短核心知识点列表。

- [x] **Step 1: 添加投影函数测试**：长文本生成短标题、summary 保留完整原文；短文本不被破坏；不同知识点不会共享同一说明。
- [x] **Step 2: 运行测试确认失败**。
- [x] **Step 3: 实现确定性投影**：优先按冒号/顿号/逗号等语义边界压缩，超过展示阈值再安全省略；永不修改传入原文。
- [x] **Step 4: 接入知识导航与已学习/待完成状态**：标题使用 projection.title，说明使用 projection.summary，状态 marker 保持现有行为。
- [x] **Step 5: 接入课节卡/课程页**：摘要改为核心知识点列表，避免直接渲染完整 objective 长段落。
- [x] **Step 6: 运行 Web 相关测试确认通过**。

### Task 5: 全链路验收

**Files:**
- Test: `apps/server/src/modules/interactive-teaching/tests/*.test.ts`
- Test: `apps/server/src/http/routes/learning-sessions.test.ts`
- Test: `apps/web/src/features/learning/*.test.tsx`

- [x] **Step 1: 运行 server 类型检查和交互教学/路由测试**。
- [x] **Step 2: 运行 UI、Web 类型检查和 Web 构建**。
- [x] **Step 3: 检查 opening 不产生 user message、不触发首轮观察，且导航原文可追溯**。
