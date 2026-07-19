# Teaching Generation Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make formal-course AI replies converge correctly across pause, retry, edit, stream disconnect, process restart, and version activation without orphaned tasks, lost completed replies, duplicate messages, or permanent “正在思考中”.

**Architecture:** Keep Generation Runtime and Learning Session as separate modules, but make the generation task a durable Saga record by storing a generic business `requestRef`. A teaching recovery coordinator reconciles task status, source-message identity, session binding, committed messages, and frame logs; normal failures compensate immediately and process crashes converge during startup/page reconciliation.

**Tech Stack:** TypeScript 5.9, Node.js 24, React 19, Fastify 5, Zod 4, Vitest 4, local-file UnitOfWork persistence.

## Global Constraints

- Pausing a learning session pauses timing and new user input only.
- A retry for an already-sent unanswered user message may run while paused and must not resume timing.
- A completed reply may be committed after pause/restart only when course, lesson, session, task, and source-message identity still match.
- Editing, stopping, replacing, or superseding the source message permanently prevents an old task from writing back.
- Each user turn has at most one complete assistant reply and each generation task can commit at most one assistant message.
- Existing complete history is immutable; technical retry restores the same unanswered turn.
- Do not log prompt text, user text, or reply bodies.

---

### Task 1: Persist a Generation Business Request Reference

**Files:**
- Modify: `apps/server/src/modules/generation-runtime/interface.ts`
- Modify: `apps/server/src/modules/generation-runtime/ports/generation-task-repository.ts`
- Modify: `apps/server/src/modules/generation-runtime/implementation/generation-runtime.ts`
- Modify: `apps/server/src/persistence/local-file-repositories.ts`
- Modify: `apps/server/src/persistence/in-memory-repositories.ts`
- Test: `apps/server/src/modules/generation-runtime/tests/scheduler.test.ts`

**Interfaces:**
- Consumes: existing `GenerationRequest`, `GenerationTask`, and task persistence schemas.
- Produces: optional `requestRef?: string` persisted unchanged from request to task; `GenerationRuntime.listByOwner(ownerRef, taskKind?)` for recovery queries.

- [ ] **Step 1: Write failing persistence and owner-query tests**

Add tests that submit two tasks for one owner and one for another owner, then assert:

```ts
const accepted = await runtime.submit({
  ...request('turn-01'),
  ownerRef: 'session_01',
  requestRef: 'message_01',
  taskKind: 'interactive-teaching',
});
expect((await runtime.get(accepted.taskId)).requestRef).toBe('message_01');
expect((await runtime.listByOwner('session_01', 'interactive-teaching')).map((task) => task.id))
  .toContain(accepted.taskId);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
corepack pnpm vitest run apps/server/src/modules/generation-runtime/tests/scheduler.test.ts --maxWorkers=1
```

Expected: type/runtime failure because `requestRef` and `listByOwner` do not exist.

- [ ] **Step 3: Add the fields and query**

Add:

```ts
export interface GenerationRequest {
  readonly requestRef?: string;
}

export interface GenerationTask {
  readonly requestRef?: string | undefined;
}

export interface GenerationRuntime {
  listByOwner(ownerRef: string, taskKind?: string): Promise<readonly GenerationTask[]>;
}
```

Persist `requestRef` in `submit`, add it to both Zod schemas, and implement `listByOwner` by filtering `allTasks()` without exposing repository internals.

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```powershell
corepack pnpm vitest run apps/server/src/modules/generation-runtime/tests/scheduler.test.ts --maxWorkers=1
corepack pnpm --filter @learning-more/server typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/server/src/modules/generation-runtime apps/server/src/persistence
git commit -m "feat(ai): persist generation request identity"
```

---

### Task 2: Allow Paused Reply Recovery Without Resuming the Session

**Files:**
- Modify: `apps/server/src/modules/learning-session/interface.ts`
- Modify: `apps/server/src/modules/learning-session/implementation/session-module.ts`
- Modify: `apps/server/src/modules/learning-session/model/learning-session.ts`
- Test: `apps/server/src/modules/learning-session/tests/session-module.test.ts`

**Interfaces:**
- Consumes: `StartSessionGeneration`, `AppendUserMessage`, and the existing session state machine.
- Produces: explicit `mode: 'new-turn' | 'retry' | 'recovery'`; internal generation binding can run while paused and leaves timing intervals closed, while `AppendUserMessage` remains the user-input gate.

- [ ] **Step 1: Write failing paused-retry tests**

Create an active session, append a user message, pause it, and execute:

```ts
await module.execute(
  {
    type: 'StartSessionGeneration',
    lessonId: 'lesson_01',
    taskId: 'task_retry',
    mode: 'retry',
  },
  { ...context('retry_paused', 'page_a'), expectedVersion: paused.resourceVersion },
);
```

Assert session state remains `paused`, `activeGenerationTaskId === 'task_retry'`, and no learning interval opens. Add sibling assertions that internal `mode: 'new-turn'` binding is also accepted while paused, while `AppendUserMessage` remains rejected.

- [ ] **Step 2: Run focused test and verify RED**

```powershell
corepack pnpm vitest run apps/server/src/modules/learning-session/tests/session-module.test.ts --maxWorkers=1
```

Expected: FAIL because paused generation is currently rejected.

- [ ] **Step 3: Implement explicit mode semantics**

Change the command to:

```ts
| (LessonCommand & Readonly<{
    type: 'StartSessionGeneration';
    taskId: string;
    mode: 'new-turn' | 'retry' | 'recovery';
  }>)
```

Carry `mode` into the domain command. Permit `StartSessionGeneration` in both active and paused states for every mode; do not emit resume events and do not open a timing interval. Keep the new-user-turn restriction exclusively in `AppendUserMessage`.

- [ ] **Step 4: Update all callers with an explicit mode and run tests**

Use `new-turn` for ordinary messages/opening/revision, `retry` for user retry, and `recovery` for startup reconciliation.

Run:

```powershell
corepack pnpm vitest run apps/server/src/modules/learning-session --maxWorkers=1
corepack pnpm --filter @learning-more/server typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/server/src/modules/learning-session apps/server/src/modules/interactive-teaching
git commit -m "fix(learning): allow paused reply recovery"
```

---

### Task 3: Make Normal Teaching Generation Compensating and Identity-Aware

**Files:**
- Modify: `apps/server/src/modules/interactive-teaching/ports/teaching-agent.ts`
- Modify: `apps/server/src/modules/interactive-teaching/implementation/generation-teaching-agent.ts`
- Modify: `apps/server/src/modules/interactive-teaching/implementation/interactive-teaching.ts`
- Test: `apps/server/src/modules/interactive-teaching/tests/interactive-teaching.test.ts`

**Interfaces:**
- Consumes: `GenerationRuntime.requestRef`, explicit session generation mode, teaching context assembler, frame log.
- Produces: `TeachingAgent.submit(context, requestRef)`, `TeachingAgent.listTasks(sessionId)`, `TeachingAgent.cancel(taskId)`, and a single coordinator path that either returns a fully bound/streamable task or terminalizes it.

- [ ] **Step 1: Add regression tests for the exact orphan window**

Inject a session module whose `StartSessionGeneration` fails after `agent.submit`. Assert the returned promise rejects and:

```ts
expect((await runtime.get(submittedTaskId)).status).toBe('cancelled');
expect((await runtime.listByOwner('session_01', 'interactive-teaching')))
  .not.toContainEqual(expect.objectContaining({ status: 'queued' }));
```

Add a version-race test where context assembly advances the session version; assert scheduling re-queries the latest session version before binding and succeeds without creating a second task.

- [ ] **Step 2: Run focused test and verify RED**

```powershell
corepack pnpm vitest run apps/server/src/modules/interactive-teaching/tests/interactive-teaching.test.ts --maxWorkers=1
```

Expected: orphan task remains queued and version-race test fails.

- [ ] **Step 3: Add request identity to the teaching agent**

Change:

```ts
submit(context: TeachingContextPackage, requestRef: string): Promise<{ taskId: string }>;
listTasks(sessionId: string): Promise<readonly GenerationTask[]>;
cancel(taskId: string): Promise<void>;
```

Pass `requestRef` into the generation request. Opening uses `opening:${sessionId}`; user turns use their actual message ID.

- [ ] **Step 4: Refactor scheduling into a compensating coordinator**

The coordinator must:

```ts
const accepted = await agent.submit(assembled, requestRef);
try {
  const latest = await sessionModule.query(/* GetLessonLearning */);
  const started = await sessionModule.execute(
    { type: 'StartSessionGeneration', lessonId, taskId: accepted.taskId, mode },
    { ...context, expectedVersion: latest.resourceVersion },
  );
  await frameLog.ensureTask(accepted.taskId, 'queued');
  startCompletion(/* ... */);
  return { taskId: accepted.taskId, resourceVersion: started.value.resourceVersion };
} catch (error) {
  await agent.cancelUnstarted(accepted.taskId);
  await clearMatchingSessionBinding(/* if attached */);
  await appendTerminalFailureIfJournalExists(/* ... */);
  throw error;
}
```

Expose only the narrow task query and cancellation operations required by the teaching coordinator. Do not dispatch Provider execution before binding and journal creation succeed.

- [ ] **Step 5: Make message commit and directive application idempotent**

Before committing, check message history for the same `generationTaskId`. If already committed, reuse it and only apply any missing directive. Never add a second assistant message for one task.

- [ ] **Step 6: Run focused tests**

```powershell
corepack pnpm vitest run apps/server/src/modules/interactive-teaching/tests/interactive-teaching.test.ts --maxWorkers=1
corepack pnpm --filter @learning-more/server typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add apps/server/src/modules/interactive-teaching
git commit -m "fix(teaching): compensate failed generation handoff"
```

---

### Task 4: Reconcile Orphaned, Running, and Completed Teaching Tasks

**Files:**
- Create: `apps/server/src/modules/interactive-teaching/implementation/teaching-generation-reconciler.ts`
- Modify: `apps/server/src/modules/interactive-teaching/implementation/interactive-teaching.ts`
- Modify: `apps/server/src/bootstrap/local-application/learning-runtime.ts`
- Modify: `apps/server/src/bootstrap/local-application/assemble.ts`
- Test: `apps/server/src/modules/interactive-teaching/tests/teaching-generation-reconciler.test.ts`
- Test: `apps/server/src/modules/interactive-teaching/tests/interactive-teaching.test.ts`

**Interfaces:**
- Consumes: tasks from `TeachingAgent.listTasks(sessionId)`, session state, message history, agent recovery/read, frame log, and idempotent message/directive commit operations.
- Produces: `reconcileSessionGeneration({ courseId, lessonId, sessionId, context }): Promise<ReconciliationResult>`.

- [ ] **Step 1: Encode the production failures as deterministic RED fixtures**

Create fixtures for:

```ts
// A: completed task, latest unanswered source message, no active binding, no assistant message
// B: queued task, latest unanswered source message, no frame log, no active binding
// C: completed task whose source message was replaced
```

Assert A commits exactly one assistant message, B is either safely rebound/executed or cancelled when a valid completed sibling exists, and C is cancelled without message commit.

- [ ] **Step 2: Run the new test and verify RED**

```powershell
corepack pnpm vitest run apps/server/src/modules/interactive-teaching/tests/teaching-generation-reconciler.test.ts --maxWorkers=1
```

Expected: FAIL because no reconciler exists.

- [ ] **Step 3: Implement source identity selection**

For new tasks use `requestRef`. For legacy tasks, permit recovery only when a source message ID can be deterministically extracted from the structured Prompt and equals the single trailing unanswered user message. Ambiguous legacy tasks return `generation_recovery_ambiguous` and cannot commit.

- [ ] **Step 4: Implement the reconciliation matrix**

Return one of:

```ts
type ReconciliationAction =
  | 'none'
  | 'resumed'
  | 'reply_recovered'
  | 'orphan_cancelled'
  | 'terminal_binding_cleared'
  | 'ambiguous';
```

The reconciler sorts tasks deterministically, prefers a valid completed result over queued duplicates, cancels stale siblings, preserves pause state, and guards every commit with session/source/task identity.

- [ ] **Step 5: Replace active-task-only startup recovery**

Use the reconciler for each teaching session. Keep one Promise per session, write structured result/error logs, and do not silently convert all failures into an unobservable projection flag. Running Provider recovery remains asynchronous so unrelated readiness is not blocked.

- [ ] **Step 6: Trigger lightweight reconciliation on session load/retry**

Before returning a stuck active task or creating another retry, reconcile persisted state once. This closes the gap when startup recovery previously failed or the page opens after a crash.

- [ ] **Step 7: Run recovery and teaching tests**

```powershell
corepack pnpm vitest run apps/server/src/modules/interactive-teaching --maxWorkers=1
corepack pnpm test:recovery
corepack pnpm --filter @learning-more/server typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add apps/server/src/modules/interactive-teaching apps/server/src/bootstrap/local-application
git commit -m "fix(teaching): recover orphaned generation sagas"
```

---

### Task 5: Make the Formal Lesson UI Converge from Server Facts

**Files:**
- Modify: `apps/web/src/features/learning/session-page.tsx`
- Modify: `apps/web/src/features/learning/session-page.test.tsx`
- Modify: `apps/web/src/client/learning-client.ts`

**Interfaces:**
- Consumes: generation stream, `getSession`, retry endpoint, and authoritative task/session status.
- Produces: bounded start acknowledgement and reconnect/reconciliation behavior; paused retry remains available without enabling the composer.

- [ ] **Step 1: Write failing UI tests**

Add tests for:

```ts
it('leaves thinking state and offers retry when an accepted task never exposes a stream journal', ...)
it('refreshes the committed reply after the generation stream disconnects', ...)
it('allows retry while paused without enabling input or advancing the timer', ...)
```

Use fake timers for the start-confirmation window and mock `getSession` to return either an unanswered terminal state or a recovered assistant message.

- [ ] **Step 2: Run tests and verify RED**

```powershell
corepack pnpm vitest run apps/web/src/features/learning/session-page.test.tsx --maxWorkers=1
```

Expected: the page remains in `generating` or retry is unavailable while paused.

- [ ] **Step 3: Add an authoritative reconciliation helper**

Create a local helper that, after stream disconnect/no-start signal, calls `getSession`, hydrates messages/progress, and returns one of `completed | generating | retryable`. Do not treat the acknowledgement timer as an AI generation timeout.

- [ ] **Step 4: Reconnect or exit generating state**

If the refreshed session still exposes the same valid active task, reconnect from the latest sequence. If the reply is committed, complete and refresh. Otherwise dispatch `send-failed` so the retry icon appears.

- [ ] **Step 5: Keep paused retry available**

Make retry availability depend on an unanswered failed generation, not on composer writability. Keep the textarea disabled and timer held while `activity === 'paused'`.

- [ ] **Step 6: Run focused web tests and typecheck**

```powershell
corepack pnpm vitest run apps/web/src/features/learning/session-page.test.tsx --maxWorkers=1
corepack pnpm --filter @learning-more/web typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add apps/web/src/features/learning
git commit -m "fix(web): reconcile stalled teaching generation"
```

---

### Task 6: Repair Current Data, Verify Fault Matrix, and Activate

**Files:**
- Modify: `apps/server/src/bootstrap/local-application/learning-runtime.ts`
- Test: `tests/recovery/full-fault-matrix.test.ts`
- Test: `tests/recovery/runtime-activation-flow.test.ts`

**Interfaces:**
- Consumes: production-safe reconciler and current local data.
- Produces: repaired current session, no orphan teaching tasks, activated build, and verified runtime.

- [ ] **Step 1: Add restart fault-matrix cases**

Inject crashes at: after task submit, after session bind, after journal creation, after Provider completion, after assistant commit, and after directive application. Restart the app against the same temporary data root after each crash.

Assert:

```ts
expect(completeAssistantMessagesForSource).toHaveLength(1);
expect(orphanQueuedOrRunningTasks).toHaveLength(0);
expect(session.activeGenerationTaskId).toBeUndefined();
```

- [ ] **Step 2: Run the original RED-capable orphan assertion before repair**

Run the fixed-data diagnostic or its checked-in fixture equivalent and confirm it reports:

```text
RED: orphaned generation request reproduced
```

- [ ] **Step 3: Run focused and full verification**

```powershell
corepack pnpm vitest run apps/server/src/modules/generation-runtime apps/server/src/modules/learning-session apps/server/src/modules/interactive-teaching apps/web/src/features/learning/session-page.test.tsx --maxWorkers=1
corepack pnpm test:recovery
corepack pnpm verify
```

Expected: PASS with no architecture, type, schema, unit, or build failures.

- [ ] **Step 4: Activate the new build using the project runtime workflow**

Use the existing activation command documented by the host/runtime scripts, then query `/api/v1/runtime/ready` and assert the active `buildId` matches HEAD with store, projection, and provider status ready.

- [ ] **Step 5: Verify current real data converged**

Assert:

- the valid completed legacy task reply is committed once if identity still matches;
- the queued zero-attempt sibling is cancelled;
- the lesson session remains paused;
- no active task points to a terminal/missing task;
- the UI shows the recovered reply or a retry button, never permanent thinking.

- [ ] **Step 6: Remove temporary instrumentation and run `git diff --check`**

```powershell
rg -n '\[DEBUG-' apps packages tests
git diff --check
git status --short
```

Expected: no debug instrumentation, no whitespace errors, and only intentional files before final commit.

- [ ] **Step 7: Commit remaining integration changes**

```powershell
git add apps packages tests
git commit -m "fix(teaching): make AI reply recovery crash-safe"
```
