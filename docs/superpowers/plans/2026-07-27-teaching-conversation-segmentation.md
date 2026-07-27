# Teaching Conversation Segmentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist assistant-message knowledge-point ownership and render exact knowledge-chain titles, immediate continuation thinking feedback, and unlabeled continuation boundaries.

**Architecture:** The server captures the active knowledge point before applying a generated directive and stores it as optional assistant-message metadata. The web client renders titles from the authoritative teaching-progress title map and manages continuation waiting independently from ledger synchronization.

**Tech Stack:** TypeScript, Zod contracts, Fastify, React 19, Vitest, Testing Library, CSS.

## Global Constraints

- Titles use the exact confirmed knowledge-chain title and are never AI-authored.
- A title appears once when the conversation enters a knowledge point.
- Continuation batches use an unlabeled divider with spacing.
- Clicking “继续讲解” immediately shows “正在思考中…”.
- Failed empty continuation batches leave no divider and restore the button.
- Existing message records remain readable without migration.

---

### Task 1: Persist message knowledge-point ownership

**Files:**
- Modify: `packages/contracts/src/learning-session.ts`
- Modify: `packages/contracts/src/learning-session.test.ts`
- Modify: `apps/server/src/modules/learning-session/interface.ts`
- Modify: `apps/server/src/modules/learning-session/implementation/message-log.ts`
- Modify: `apps/server/src/modules/learning-session/implementation/session-module.ts`
- Modify: `apps/server/src/modules/learning-session/tests/session-module.test.ts`
- Modify: `apps/server/src/http/routes/learning-sessions.ts`
- Modify: `apps/server/src/http/routes/learning-sessions.test.ts`

**Interfaces:**
- Produces: optional `knowledgePointRef?: string` on persisted assistant messages and session-view messages.
- Consumes: optional `knowledgePointRef` on `CommitAssistantMessage`.

- [ ] **Step 1: Add failing contract, storage, and route assertions**

```ts
expect(
  LearningSessionViewResponseSchema.parse({
    ...sessionView,
    messages: [{
      id: 'assistant_01',
      role: 'assistant',
      createdAt: now,
      markdown: '讲解',
      knowledgePointRef: 'knowledge:lesson_01:point_01',
    }],
  }).messages?.[0]?.knowledgePointRef,
).toBe('knowledge:lesson_01:point_01');
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `node_modules/.bin/vitest run packages/contracts/src/learning-session.test.ts apps/server/src/modules/learning-session/tests/session-module.test.ts apps/server/src/http/routes/learning-sessions.test.ts`

Expected: FAIL because the strict schemas and command types omit `knowledgePointRef`.

- [ ] **Step 3: Add optional metadata end-to-end**

```ts
type LearningMessage = Readonly<{
  id: string;
  role: 'user' | 'assistant';
  createdAt: string;
  contentArtifactRef: string;
  generationTaskId?: string;
  knowledgePointRef?: string;
  completionStatus: 'complete' | 'interrupted';
}>;
```

- [ ] **Step 4: Verify compatibility**

Run the focused tests from Step 2.

Expected: PASS for both old records without the field and new assistant messages with it.

### Task 2: Bind generated replies to the pre-directive knowledge point

**Files:**
- Modify: `apps/server/src/modules/interactive-teaching/implementation/interactive-teaching.ts`
- Modify: `apps/server/src/modules/interactive-teaching/interface.ts`
- Modify: `apps/server/src/bootstrap/local-application/learning-teaching-context.ts`
- Modify: `apps/server/src/modules/interactive-teaching/tests/interactive-teaching.test.ts`

**Interfaces:**
- Consumes: `assembled.teachingState.activeKnowledgePointRef`.
- Produces: `CommitAssistantMessage.knowledgePointRef` for success, recovered failure, stop-preserve, and restart recovery paths.

- [ ] **Step 1: Add a failing ownership test**

```ts
expect(committedAssistantCommand).toMatchObject({
  type: 'CommitAssistantMessage',
  knowledgePointRef: 'knowledge:lesson_01:point_01',
});
```

- [ ] **Step 2: Capture ownership before directive application**

```ts
const messageKnowledgePointRef = input.assembled.teachingState.activeKnowledgePointRef;
await applyCommittedDirective(/* may advance the ledger */);
await options.sessionModule.execute({
  type: 'CommitAssistantMessage',
  ...messageIdentity,
  ...(messageKnowledgePointRef === undefined ? {} : { knowledgePointRef: messageKnowledgePointRef }),
}, context);
```

- [ ] **Step 3: Carry ownership through stop and recovery**

Store the captured reference in in-memory task context; when recovering after restart, read the active ledger state before applying the recovered directive.

- [ ] **Step 4: Run interactive-teaching tests**

Run: `node_modules/.bin/vitest run apps/server/src/modules/interactive-teaching/tests/interactive-teaching.test.ts apps/server/src/modules/interactive-teaching/tests/teaching-generation-reconciler.test.ts`

Expected: PASS.

### Task 3: Render titles and continuation batches

**Files:**
- Modify: `apps/web/src/features/learning/message-stream.tsx`
- Modify: `apps/web/src/features/learning/session-page.tsx`
- Modify: `apps/web/src/features/learning/lesson-session-workspace.tsx`
- Modify: `apps/web/src/features/learning/lesson-session-workspace.css`
- Modify: `apps/web/src/features/learning/session-page.test.tsx`

**Interfaces:**
- Consumes: `message.knowledgePointRef` and `teachingProgress.knowledgePoints`.
- Produces: `LessonSessionMessage.knowledgePointRef`, `knowledgePointTitle`, and `continuationPending`.

- [ ] **Step 1: Add failing rendering and reducer tests**

```tsx
expect(screen.getByRole('heading', { name: '双侧极限的单侧判据' })).toBeVisible();
expect(screen.getAllByTestId('continuation-divider')).toHaveLength(1);
expect(screen.getByRole('status', { name: 'AI 回复状态' })).toHaveTextContent('正在思考中');
```

- [ ] **Step 2: Add a dedicated continuation-start action**

```ts
if (action.type === 'continuation-started') {
  return {
    ...state,
    phase: 'generating',
    assistantMarkdown: '',
    assistantPending: true,
    continuationPending: true,
    generationKnowledgePointRef: action.knowledgePointRef,
    taskId: undefined,
  };
}
```

- [ ] **Step 3: Render exact titles and stable boundaries**

For each assistant message, render the title when its reference differs from the previous attributed assistant message. Render an unlabeled divider when the immediately preceding visible message is also an assistant. While a continuation is waiting without streamed text, render the same divider before the thinking status.

- [ ] **Step 4: Clear temporary structure on failure**

`continuation-failed` clears `continuationPending`, `assistantPending`, streamed Markdown, and the task id after the authoritative snapshot is hydrated.

- [ ] **Step 5: Run web tests**

Run: `node_modules/.bin/vitest run apps/web/src/features/learning/session-page.test.tsx`

Expected: PASS for immediate thinking, first-delta transition, failure retry, no empty divider, exact title, no repeated title, and refresh restoration.

### Task 4: Scoped verification and runtime activation

**Files:**
- Verify all files changed by Tasks 1–3.

- [ ] **Step 1: Run affected verification**

Run: `corepack pnpm verify -- <all files changed by Tasks 1–3>`

Expected: selected format, lint, related tests, contracts/server/web typechecks, schema, and architecture gates pass.

- [ ] **Step 2: Build and activate the local release**

Run the repository’s existing local release activation workflow, then query the launcher/runtime status.

Expected: the active build identity equals the newly created build and the application health endpoint is ready.
