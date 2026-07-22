# Formal Course Generation Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce formal-course AI reply latency without weakening teaching quality, stream safety, recovery, or ledger consistency.

**Architecture:** Add a backward-compatible sparse teaching-control directive that is materialized against the authoritative ledger before existing validation. Preserve reply-first streaming, then remove fixed startup/projection costs only where cancellation and recovery semantics remain unchanged.

**Tech Stack:** TypeScript, Zod, Vitest, React, Codex CLI app-server, local durable generation journals.

## Global Constraints

- Keep schema version 1 readable for historical tasks.
- Preserve sentence/paragraph streaming and safe Markdown boundaries.
- Preserve teaching-agent directive → teaching ledger → frontend projection.
- Do not lower reasoning depth for key or difficult knowledge points.
- Preserve all existing uncommitted generation-recovery and closure fixes.

---

### Task 1: Sparse teaching control directive

**Files:**
- Modify: `apps/server/src/modules/interactive-teaching/ports/teaching-agent.ts`
- Modify: `apps/server/src/modules/interactive-teaching/implementation/teaching-directive.ts`
- Modify: `apps/server/src/modules/interactive-teaching/implementation/teaching-control-protocol.ts`
- Modify: `apps/server/src/modules/interactive-teaching/implementation/teaching-response-stream.ts`
- Test: `apps/server/src/modules/interactive-teaching/tests/teaching-directive.test.ts`
- Test: `apps/server/src/modules/interactive-teaching/tests/generation-teaching-agent.test.ts`

- [ ] Add failing tests proving schema version 2 may omit unchanged top-level fields and update only one knowledge point.
- [ ] Add the version 2 union type and Zod schema.
- [ ] Materialize version 2 against the normalized current ledger before running the existing full-state validation.
- [ ] Change the model protocol to request sparse version 2 output while retaining version 1 parsing.
- [ ] Run the directive, response-stream, and generation-agent tests.

### Task 2: Timing evidence and fixed overhead

**Files:**
- Modify: `apps/server/src/modules/generation-runtime/implementation/generation-runtime.ts`
- Modify: `apps/server/src/modules/generation-runtime/ports/generation-task-repository.ts`
- Modify: `apps/server/src/persistence/local-file-repositories.ts`
- Test: `apps/server/src/modules/generation-runtime/tests/scheduler.test.ts`
- Modify: `apps/web/src/features/learning/session-page.tsx`
- Test: `apps/web/src/features/learning/session-page.test.tsx`

- [ ] Record the first provider-delta timestamp exactly once on the durable generation task.
- [ ] Test that retries do not overwrite the first successful delta timestamp.
- [ ] Replace avoidable post-terminal polling waits with an immediate authoritative snapshot while retaining bounded reconciliation for delayed projections.
- [ ] Run generation-runtime and session-page tests.

### Task 3: Verification and activation

**Files:**
- Verify: generation journals under `.learning-more-data/tasks/journals`
- Verify: task entities under `.learning-more-data/entities/tasks`

- [ ] Run focused server tests and web tests.
- [ ] Run server and web type checks.
- [ ] Build and activate the latest runtime version.
- [ ] Execute real teaching turns and compare TTFT, stream, tail, and total against the recorded baseline.

