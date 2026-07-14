# Slice 2: Generation Execution, Scenario Registry, and Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give every AI business module one small, restart-safe execution API while keeping all business semantics in the owning deep module.

**Architecture:** `generation-runtime` exposes only submit, await terminal, stream frames, cancel, and recover. A typed scenario registry binds task kinds to provider/output policy. Business modules assemble input and validate/commit results themselves.

**Tech Stack:** TypeScript, Zod, Vitest, existing generation runtime/provider adapters.

---

### Task 1: Specify the narrow execution seam

**Files:**
- Modify: `packages/contracts/src/generation.ts`
- Modify: `packages/contracts/src/ai-runtime.ts`
- Create: `apps/server/src/modules/generation-runtime/ports/generation-execution.ts`
- Create: `apps/server/src/modules/generation-runtime/tests/generation-execution.test.ts`

- [ ] Write failing contract tests for `submit`, `awaitTerminal`, `stream`, `cancel`, and `recover`.
- [ ] Require idempotency keys, input snapshot refs/hashes, task kind, and terminal result/error metadata.
- [ ] Implement the interface and adapter over the existing runtime; do not add course/plan/report/portrait parsing.
- [ ] Run the focused tests and expect exit `0`.

### Task 2: Add a complete scenario registry

**Files:**
- Create: `apps/server/src/modules/generation-runtime/scenario-registry.ts`
- Create: `apps/server/src/modules/generation-runtime/tests/scenario-registry.test.ts`
- Modify: `apps/server/src/bootstrap/local-application.ts`

- [ ] Register every production kind: authoring conversation, candidate, candidate intent, teaching, teaching observation, reviews, plan flow, weekly report, portrait, next lesson, and profile evidence.
- [ ] Test uniqueness, known output mode, provider capability, timeout/retry policy, and recovery handler ownership for every entry.
- [ ] Fail startup on an unknown or duplicate production task kind.
- [ ] Run the registry test and expect exit `0`.

### Task 3: Make terminal waiting and restart recovery observable

**Files:**
- Modify: `apps/server/src/modules/generation-runtime/implementation/generation-runtime-service.ts`
- Modify: `apps/server/src/modules/generation-runtime/implementation/recovery-service.ts`
- Modify: `apps/server/src/modules/generation-runtime/tests/generation-runtime-service.test.ts`
- Modify: `tests/recovery/full-fault-matrix.test.ts`

- [ ] Test completed, failed, cancelled, timed-out, duplicate-submit, and process-restart cases.
- [ ] Persist correlation id, business owner ref, attempts, terminal reason, and result ref.
- [ ] Ensure `recover` returns a terminal result or safely resumes/marks a retryable task; it must never fabricate business success.
- [ ] Run focused runtime and recovery tests and expect exit `0`.

### Task 4: Migrate composition roots and verify boundaries

**Files:**
- Modify: `apps/server/src/bootstrap/local-application.ts`
- Modify: `apps/server/src/bootstrap/http-routes.ts`
- Modify: `tools/architecture/src/check-architecture.ts`

- [ ] Inject `GenerationExecution` into business modules instead of exposing provider/task-store internals.
- [ ] Add an architecture rule forbidding generation-runtime from importing course-authoring, planning, report, portrait, teaching, or profile models.
- [ ] Run `corepack pnpm architecture:check`, `corepack pnpm test:recovery`, and `corepack pnpm typecheck`; expect exit `0`.
- [ ] Stage only Slice 2 files and commit with `git commit -m "refactor: add restart-safe generation execution seam"`.
