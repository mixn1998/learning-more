# Course Authoring Async Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make course-outline generation return a durable task immediately, finish in the background, and update or recover the authoring page without manual refresh.

**Architecture:** Split candidate acceptance from candidate finalization inside the existing coordinator. Persist the active task id in the outline-session projection, finalize through the existing generation execution and frame log, and let one frontend effect own SSE connection and recovery for both new and restored tasks.

**Tech Stack:** TypeScript 5.9, Fastify, React 19, Zod contracts, Vitest, Testing Library, Playwright, local durable JSON repositories.

## Global Constraints

- Keep the existing provider/model/fallback task request unchanged.
- Publish `task.completed` only after candidate and session persistence succeeds.
- Preserve optimistic resource-version checks and idempotent command receipts.
- Cover explicit generation and alignment-triggered patch/regenerate.
- Do not add a second task queue or a new HTTP endpoint.

---

### Task 1: Prove acceptance is independent from provider completion

**Files:**
- Modify: `apps/server/src/modules/course-authoring/tests/candidate-generation-coordinator.test.ts`
- Modify: `apps/server/src/modules/course-authoring/implementation/candidate-generation-coordinator.ts`
- Modify: `apps/server/src/modules/course-authoring/implementation/course-authoring-facade.ts`

**Interfaces:**
- Consumes: existing `CourseAuthoringModule.requestCandidate`, `GenerationExecution`, and `GenerationFrameLog`.
- Produces: `CandidateGenerationCoordinator.generate(input)` for immediate acceptance and `recover(input)` for durable finalization recovery.

- [ ] **Step 1: Write a failing deferred-background coordinator test**

  Add a dispatcher that captures `() => Promise<void>`, call `generate`, assert the result and session are `running`/`generating-candidates` before invoking captured work, then invoke it and assert immutable candidate plus terminal frames.

- [ ] **Step 2: Run the focused test and verify the old coordinator blocks**

  Run: `node_modules/.bin/vitest.CMD run apps/server/src/modules/course-authoring/tests/candidate-generation-coordinator.test.ts -t "accepts before provider completion" --reporter=verbose`

  Expected: FAIL because the current `generate()` executes `runtime.runNext()` before returning and has no background dispatcher.

- [ ] **Step 3: Split acceptance and finalization**

  Change the coordinator constructor to consume `execution: GenerationExecution` plus optional `dispatchBackground(work)`. Move the current provider-terminal, compilation, persistence, and frame publication logic into one deduplicated finalizer keyed by task id. Make `generate()` request/persist the task, ensure the frame log, dispatch finalization, and return the committed session version immediately. Add `recover({ outlineSessionId, taskId })` that awaits the same finalizer directly.

- [ ] **Step 4: Make terminal failures authoritative**

  Ensure provider failure, timeout, validation failure, and unexpected finalizer failure call `failCandidateGeneration` and append one matching terminal frame. Return immediately for cancelled tasks so the cancellation path remains the owner of `task.cancelled`.

- [ ] **Step 5: Run coordinator and facade tests**

  Run: `node_modules/.bin/vitest.CMD run apps/server/src/modules/course-authoring/tests/candidate-generation-coordinator.test.ts apps/server/src/modules/course-authoring/tests/course-authoring-facade.test.ts`

  Expected: PASS.

### Task 2: Recover durable candidate tasks and expose the active task id

**Files:**
- Modify: `apps/server/src/bootstrap/local-application.ts`
- Modify: `apps/server/src/modules/course-authoring/implementation/course-authoring-facade.ts`
- Modify: `packages/contracts/src/course-authoring.ts`
- Modify: `packages/contracts/src/course-authoring.test.ts`
- Modify: `apps/server/src/http/routes/course-authoring.test.ts`

**Interfaces:**
- Consumes: `CandidateGenerationCoordinator.recover({ outlineSessionId, taskId })`.
- Produces: optional `generationTaskId` on `OutlineSessionViewResponseSchema`.

- [ ] **Step 1: Write failing contract and recovery tests**

  Assert a generating session view serializes `generationTaskId`. Add coordinator coverage for a completed generation task whose outline session is still generating, then call `recover` and assert the candidate/session are finalized.

- [ ] **Step 2: Run tests and verify missing projection/recovery behavior**

  Run: `node_modules/.bin/vitest.CMD run packages/contracts/src/course-authoring.test.ts apps/server/src/modules/course-authoring/tests/candidate-generation-coordinator.test.ts apps/server/src/http/routes/course-authoring.test.ts`

  Expected: FAIL on the absent field or recovery method.

- [ ] **Step 3: Add the projection field and startup recovery**

  Add optional `generationTaskId` to the strict response schema and course-authoring query result. Include `record.session.activeCandidateTaskId` in the view. Wire coordinator production construction to `generationExecution`. Replace startup resubmission with `await candidateGeneration.recover(...)` for every generating session with an active task, then drain unrelated queued work.

- [ ] **Step 4: Verify server and contract suites**

  Run: `node_modules/.bin/vitest.CMD run packages/contracts/src/course-authoring.test.ts apps/server/src/modules/course-authoring apps/server/src/http/routes/course-authoring.test.ts`

  Expected: PASS.

### Task 3: Make one frontend observer own new and restored generation tasks

**Files:**
- Modify: `apps/web/src/client/course-authoring-client.ts`
- Modify: `apps/web/src/features/course-authoring/authoring-page.tsx`
- Modify: `apps/web/src/features/course-authoring/authoring-page.test.tsx`

**Interfaces:**
- Consumes: `OutlineSessionView.generationTaskId`, `CourseAuthoringClient.streamGeneration`, and authoritative session GET.
- Produces: automatic SSE observation and reconnect for every generating authoring session.

- [ ] **Step 1: Write failing restore and alignment tests**

  Add a test where initial session load returns `generating-candidates` plus `generationTaskId`; emit terminal SSE, return a ready view, and assert candidate Markdown appears without reload. Add an alignment test where `appendMessage` returns while the subsequent session view is generating; assert the same observer connects and renders the new candidate.

- [ ] **Step 2: Run focused frontend tests**

  Run: `node_modules/.bin/vitest.CMD run apps/web/src/features/course-authoring/authoring-page.test.tsx -t "generation" --reporter=verbose`

  Expected: FAIL because restored sessions do not retain a task id or start a stream.

- [ ] **Step 3: Project and clear generation task state**

  Extend `OutlineSessionView`, `State`, and `session-loaded` with optional `generationTaskId`. Set it from server views and clear it whenever a loaded view has no active task.

- [ ] **Step 4: Move stream ownership into an effect**

  Make submit handlers stop opening SSE directly. Add one effect keyed by phase/session/task that installs an `AbortController`, streams events, reloads the authoritative candidate on terminal events, and retries transient stream failures while GET still reports generation in progress. Clean up on task change/unmount and retain the existing 120-second operation deadline with an explicit recoverable failure when exhausted.

- [ ] **Step 5: Verify frontend tests**

  Run: `node_modules/.bin/vitest.CMD run apps/web/src/features/course-authoring/authoring-page.test.tsx apps/web/src/client/course-authoring-client.test.ts`

  Expected: PASS.

### Task 4: Verify the full authoring lifecycle and runnable build

**Files:**
- Modify if required by evidence: `tests/e2e/course-authoring.spec.ts`

**Interfaces:**
- Consumes: completed server and frontend behavior.
- Produces: release-ready evidence for no-refresh generation and recovery.

- [ ] **Step 1: Extend E2E acceptance if existing coverage does not assert the first candidate before reload**

  Assert the candidate heading becomes visible immediately after generation/retry and before any `page.reload()`. Preserve the later reload assertion for durable restore.

- [ ] **Step 2: Run focused unit and E2E suites**

  Run: `node_modules/.bin/vitest.CMD run apps/server/src/modules/course-authoring apps/server/src/http/routes/course-authoring.test.ts apps/web/src/features/course-authoring/authoring-page.test.tsx packages/contracts/src/course-authoring.test.ts`

  Run: `node_modules/.bin/playwright.CMD test tests/e2e/course-authoring.spec.ts`

  Expected: PASS.

- [ ] **Step 3: Run typecheck and build**

  Run: `corepack pnpm typecheck`

  Run: `corepack pnpm build`

  Expected: PASS.

- [ ] **Step 4: Build or reconnect the runnable release and verify its assets**

  Use the project release/host workflow already configured in the repository, then verify the runtime manifest build id changed and the served authoring bundle contains the new session task projection and observer behavior.

