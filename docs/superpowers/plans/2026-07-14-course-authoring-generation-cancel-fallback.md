# Course Authoring Generation Cancel and Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure candidate-outline generation never leaves the course-authoring page permanently busy and gives the learner an explicit, durable cancellation path.

**Architecture:** The server remains the source of truth for outline-session state. A new course-authoring cancellation command delegates to the existing generation-runtime cancellation primitive, then transitions the outline session to its retryable state. The browser treats SSE as an acceleration channel: terminal events update immediately, while disconnects/timeouts trigger one authoritative session reload.

**Tech Stack:** TypeScript, Fastify, Zod contracts, React reducer, Vitest, existing generation frame log/runtime.

## Global Constraints

- Preserve high-freedom AI content and Markdown output; this change only controls task lifecycle and visibility.
- Do not add a second generation runtime or a second cancellation state machine.
- A cancelled or interrupted generation must remain retryable and must not create a candidate version.
- Existing unrelated working-tree changes remain untouched.

---

### Task 1: Add the cancellation transport contract and server command

**Files:**
- Modify: `packages/contracts/src/course-authoring.ts`
- Modify: `packages/contracts/src/course-authoring.test.ts`
- Modify: `apps/server/src/modules/course-authoring/implementation/course-authoring-module.ts`
- Modify: `apps/server/src/modules/course-authoring/implementation/course-authoring-facade.ts`
- Modify: `apps/server/src/http/routes/course-authoring.ts`
- Test: `apps/server/src/http/routes/course-authoring.test.ts`

**Interfaces:**
- Produce `CancelCandidateGenerationResponseSchema` with `outlineSessionId`, `state`, and `resourceVersion`.
- Produce `CancelCandidateGeneration` module execution that calls runtime `cancel(taskId)` and transitions the session through the existing `candidateGenerationFailed` domain event.

- [ ] Write a failing HTTP test for cancelling a generating session and returning `202` with a retryable state.
- [ ] Run the focused route test and verify it fails because the route/schema is absent.
- [ ] Add the strict response schema and route; resolve the active task from the persisted outline session and delegate cancellation to `generationRuntime.cancel`.
- [ ] Persist the session transition with the current resource version and return the new version.
- [ ] Run route and course-authoring module tests; verify cancellation is idempotent for already-terminal tasks and rejects sessions without an active task.

### Task 2: Add browser cancellation and authoritative fallback

**Files:**
- Modify: `apps/web/src/client/course-authoring-client.ts`
- Modify: `apps/web/src/client/sse-client.ts`
- Modify: `apps/web/src/features/course-authoring/authoring-page.tsx`
- Modify: `apps/web/src/features/course-authoring/outline-workspace-view.tsx`
- Modify: `apps/web/src/features/course-authoring/authoring-page.test.tsx`

**Interfaces:**
- Add `cancelCandidateGeneration(input)` to `CourseAuthoringClient`.
- Add a page-level `cancel-generation` action and a `cancelGeneration` handler.

- [ ] Add a failing UI test asserting that an accepted generation shows an enabled “取消生成” action.
- [ ] Add a failing UI test asserting SSE rejection reloads the session and exits `generating` when the server reports `assessment-ready`.
- [ ] Implement the client request against `/api/v1/outline-sessions/:sessionId/candidate-generations/cancellation` with `If-Match` and idempotency headers.
- [ ] Make `generate()` use an `AbortController`, enforce a bounded stream wait, and call `loadSession()` once on disconnect/timeout before displaying interruption.
- [ ] Wire the cancel action to abort the stream, call the server cancellation endpoint, then reload the session; keep the draft visible and make retry available.
- [ ] Run the focused web tests and verify no generating state remains after cancel, timeout, or disconnect.

### Task 3: Add end-to-end task replay coverage

**Files:**
- Modify: `apps/server/src/modules/generation-runtime/tests/scheduler.test.ts`
- Modify: `apps/server/src/modules/course-authoring/tests/candidate-generation-coordinator.test.ts`
- Modify: `apps/server/src/bootstrap/local-application.test.ts`
- Modify: `apps/web/src/client/sse-client.test.ts`

- [ ] Add a replay where a running candidate task is cancelled, the frame log emits `task.cancelled`, and the persisted task ends with `generation_cancelled`.
- [ ] Add a service restart/reload replay proving an interrupted task is recoverable and cancellation does not leave `generating-candidates` persisted.
- [ ] Add an SSE replay where the stream ends without a terminal event and the page fallback path is exercised by the caller.
- [ ] Run all affected server and web suites, then typecheck and build both packages.

### Task 4: Verify runtime activation and regression gates

**Files:**
- No production files; inspect runtime identity and activation status.

- [ ] Confirm the active runtime build contains the updated cancellation route and relaxed candidate schema.
- [ ] Confirm the original outline session is not actively generating before retrying.
- [ ] Run `corepack pnpm --filter @learning-more/server test`, `corepack pnpm --filter @learning-more/server typecheck`, and `corepack pnpm --filter @learning-more/server build`.
- [ ] Run the web course-authoring tests and document any unrelated repository-wide format failures without modifying parallel work.
