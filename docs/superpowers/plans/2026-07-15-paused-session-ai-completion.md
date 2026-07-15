# Paused Session AI Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow an already-started, identity-matching AI generation to persist its reply after the learning session pauses, without resuming time or permitting new learner writes.

**Architecture:** Extend the internal assistant-commit command with session identity and pass generation identity into the domain state machine. Keep write-lease validation in the session module, permit only matching `commitAssistantMessage` commands in `active` or `paused`, and leave all browser lifecycle behavior unchanged.

**Tech Stack:** TypeScript, Vitest, LearningSession domain state machine, InteractiveTeaching orchestration.

## Global Constraints

- Background state continues to stop actual learning time.
- Paused sessions continue to reject learner messages and new generation starts.
- Only the current session's active generation task may commit after pause.
- Existing page-instance write-lease ownership remains mandatory.
- A successful background commit leaves the session paused.
- Do not modify the dirty learning-session frontend files.
- Do not change public HTTP request or response contracts.

---

### Task 1: Lock down paused assistant commit semantics

**Files:**
- Modify: `apps/server/src/modules/learning-session/tests/session-module.test.ts`
- Modify: `apps/server/src/modules/learning-session/interface.ts`
- Modify: `apps/server/src/modules/learning-session/model/commands.ts`
- Modify: `apps/server/src/modules/learning-session/implementation/session-module.ts`
- Modify: `apps/server/src/modules/learning-session/model/learning-session.ts`

**Interfaces:**
- Consumes: `CommitAssistantMessage` with `lessonId`, `sessionId`, `generationTaskId`, message identity, and artifact reference.
- Produces: A domain `commitAssistantMessage` command carrying `sessionId`, `generationTaskId`, and `messageId`.

- [x] **Step 1: Write the failing paused-commit test**

Create a session, start `task_01`, advance time, pause the session, then commit `task_01`. Assert the assistant message is persisted, `activeGenerationTaskId` is cleared, state remains `paused`, and actual seconds do not increase.

- [x] **Step 2: Write failing identity guard tests**

From a paused session with `task_01` active, assert `session_other` and `task_other` are rejected with `session_conflict`. Transfer the write lease and assert the original page is rejected with `write_lease_lost`.

- [x] **Step 3: Run the focused test and verify RED**

Run: `node_modules\.bin\vitest.CMD run apps/server/src/modules/learning-session/tests/session-module.test.ts`

Expected: FAIL because paused assistant commits are currently `session_not_writable` and the command has no session identity.

- [x] **Step 4: Implement the minimum domain change**

Add required `sessionId` to the internal application command. Pass `sessionId` and `generationTaskId` into the domain command. Split learner append and assistant commit rules: learner append still requires `active`; assistant commit permits `active` or `paused`, checks the session ID and active task ID, then emits the existing `AssistantMessageCommitted` event.

- [x] **Step 5: Run the focused test and verify GREEN**

Run: `node_modules\.bin\vitest.CMD run apps/server/src/modules/learning-session/tests/session-module.test.ts`

Expected: PASS.

### Task 2: Propagate session identity through interactive teaching

**Files:**
- Modify: `apps/server/src/modules/interactive-teaching/implementation/interactive-teaching.ts`
- Modify: `apps/server/src/modules/interactive-teaching/tests/interactive-teaching.test.ts`

**Interfaces:**
- Consumes: The enriched internal `CommitAssistantMessage` command.
- Produces: Normal completion, stop, and recovery commits that identify both session and task.

- [x] **Step 1: Write a failing orchestration regression test**

Use a deferred `agent.complete()` result. Start the opening, pause the stored learning session before resolving the deferred result, resolve the assistant Markdown, drain background work, and assert the message log contains the assistant reply and the final frame is `task.completed`.

- [x] **Step 2: Run the interactive-teaching test and verify RED**

Run: `node_modules\.bin\vitest.CMD run apps/server/src/modules/interactive-teaching/tests/interactive-teaching.test.ts`

Expected: FAIL because the completion is rejected after pause.

- [x] **Step 3: Propagate `sessionId` at every assistant commit call**

Add `sessionId: input.sessionId` to normal generation completion, interrupted completion, and recovery completion commands. Do not change user-message or generation-start behavior.

- [x] **Step 4: Run both focused suites and verify GREEN**

Run: `node_modules\.bin\vitest.CMD run apps/server/src/modules/learning-session/tests/session-module.test.ts apps/server/src/modules/interactive-teaching/tests/interactive-teaching.test.ts`

Expected: PASS.

### Task 3: Regression, build, and runtime verification

**Files:**
- Verify: server package and active local runtime.

**Interfaces:**
- Consumes: Completed domain and orchestration changes.
- Produces: Passing server checks and a real AI opening that survives background pause.

- [x] **Step 1: Run server typecheck and tests**

Run: `corepack pnpm --filter @learning-more/server typecheck`

Run: `corepack pnpm --filter @learning-more/server test`

Expected: all commands exit 0.

- [x] **Step 2: Build the server package**

Run: `corepack pnpm --filter @learning-more/server build`

Expected: production TypeScript build exits 0.

- [x] **Step 3: Activate the workspace build**

Use the existing local Host reconnect workflow and wait until readiness reports the target build ID with `status: ready`.

- [x] **Step 4: Verify the original race**

Start or retry a lesson opening, move the page to the background while generation is running, and assert after completion that the session remains paused, contains the assistant message, has no active generation task, and the stream terminal is `task.completed` rather than `task.failed`.

### Task 4: Keep successful replies terminally successful

**Files:**
- Modify: `apps/server/src/modules/interactive-teaching/implementation/interactive-teaching.ts`
- Modify: `apps/server/src/modules/interactive-teaching/implementation/generation-teaching-observer.ts`
- Modify: the corresponding interactive-teaching tests

- [x] **Step 1: Complete the generation task before derived observation work**

Once the assistant message and artifact are durable, emit `task.completed`. A later observation failure remains recoverable background work and cannot append `task.failed` to the successful reply.

- [x] **Step 2: Conservatively recover invalid generated observations**

If completed observer output violates the observation contract, project no evidence with `alignment: unclear` instead of persisting untrusted evidence or degrading the whole runtime.

- [x] **Step 3: Verify deployment recovery**

Confirm the deployed build reports Store, projection, and Provider as ready, then reload the paused lesson and verify both complete assistant replies remain visible.
