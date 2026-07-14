# Slice 3: Real AI Plan-Flow Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace cancelled generation plus hardcoded July scheduling with a validated AI schedule proposal that the user must explicitly confirm.

**Architecture:** The planning deep module owns availability/course context assembly, schedule schema validation, conflict checks, versioning, and confirmation. Generation execution only returns the model result.

**Tech Stack:** TypeScript, Zod, Fastify, React, Vitest, Playwright.

---

### Task 1: Define proposal contracts and invariants

**Files:**
- Modify: `packages/contracts/src/planning.ts`
- Modify: `packages/contracts/openapi/openapi.yaml`
- Create: `apps/server/src/modules/planning/implementation/plan-flow-output.ts`
- Create: `apps/server/src/modules/planning/tests/plan-flow-output.test.ts`

- [ ] Define versioned proposals containing lesson ids, dates/times, rationale, source snapshot refs, warnings, and status.
- [ ] Test invalid lesson ids, out-of-window dates, overlaps, omitted mandatory lessons, duplicate assignments, and timezone errors.
- [ ] Implement schema and deterministic domain validation; run focused tests and expect exit `0`.

### Task 2: Assemble real planning context and execute

**Files:**
- Create: `apps/server/src/modules/planning/implementation/plan-flow-context-assembler.ts`
- Create: `apps/server/src/modules/planning/implementation/ai-plan-flow-service.ts`
- Create: `apps/server/src/modules/planning/tests/ai-plan-flow-service.test.ts`
- Modify: `apps/server/src/bootstrap/local-application.ts`

- [ ] Test materialized input for availability, timezone, course/lesson graph, prerequisites, workload, user preferences, prior completion, and fixed commitments.
- [ ] Test task completion, failure/retry, stale-input rejection, and immutable proposal versions.
- [ ] Implement generation, parse/validate, and atomic draft commit; never commit schedule changes during generation.
- [ ] Remove the cancel-and-hardcode branch from `local-application.ts`.

### Task 3: Confirm explicitly and expose UI states

**Files:**
- Modify: `apps/server/src/bootstrap/http-routes.ts`
- Modify: `apps/web/src/features/planning/plan-flow-page.tsx`
- Modify: `apps/web/src/features/planning/plan-flow-page.test.tsx`
- Modify: `tests/e2e/plan-flow.spec.ts`

- [ ] Test generating/error/retry/draft/stale/confirmed states.
- [ ] Test that only explicit user confirmation changes the canonical schedule.
- [ ] Render AI rationale and warnings as proposal content, not authoritative facts.
- [ ] Run focused server/web tests and Playwright; expect exit `0`.
- [ ] Run `rg -n "cancel\(|2026-07|绗﹀悎鐢ㄦ埛" apps/server/src/bootstrap/local-application.ts` and verify the fake success path is gone.
- [ ] Stage only Slice 3 files and commit with `git commit -m "feat: generate real AI plan-flow proposals"`.
