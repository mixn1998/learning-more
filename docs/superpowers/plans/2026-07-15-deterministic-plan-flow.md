# Deterministic Plan Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace AI-generated plan-flow previews with deterministic scheduling rules and eliminate delayed UI updates caused by AI side effects.

**Architecture:** A pure scheduling policy converts the existing materialized `PlanPreviewContext` into `PlanSuggestion[]`. `PlanFlowService` saves the computed preview directly as `preview-ready`; the HTTP bootstrap no longer awaits or triggers generation for plan-flow or ordinary schedule mutations.

**Tech Stack:** TypeScript, Fastify, React, Vitest, local-file repositories.

## Global Constraints

- Plan flow must make zero AI provider or generation-runtime calls.
- Preserve current HTTP request/response shapes and confirmation transaction semantics.
- Preview never mutates the formal schedule; only confirm writes schedule items.
- Scheduling must be deterministic for identical structured input and repository state.
- Existing unrelated worktree changes must be preserved.

---

### Task 1: Deterministic Scheduling Policy

**Files:**
- Create: `apps/server/src/modules/planning/implementation/plan-flow-scheduler.ts`
- Create: `apps/server/src/modules/planning/tests/plan-flow-scheduler.test.ts`

**Interfaces:**
- Consumes: `PlanPreviewContext` and ordered lesson references.
- Produces: `buildPlanSuggestions(context, lessonRefs): readonly PlanSuggestion[]`.

- [ ] **Step 1: Write failing tests** for prerequisite ordering, selected weekdays, atomic lessons over the daily target, collision avoidance, and stable output.
- [ ] **Step 2: Run** `vitest run apps/server/src/modules/planning/tests/plan-flow-scheduler.test.ts`; expect failures because the policy does not exist.
- [ ] **Step 3: Implement** stable topological ordering, local-date enumeration, 19:00 local start conversion, daily soft-limit allocation, and collision shifting in the focused policy file.
- [ ] **Step 4: Run the focused test** and expect all scheduler cases to pass.

### Task 2: Remove Generation Runtime from Plan Flow

**Files:**
- Modify: `apps/server/src/modules/planning/implementation/plan-flow-service.ts`
- Modify: `apps/server/src/modules/planning/tests/plan-flow-service.test.ts`
- Modify: `apps/server/src/bootstrap/local-application.ts`
- Modify: `apps/server/src/bootstrap/local-application.test.ts`

**Interfaces:**
- Consumes: `buildPlanSuggestions(context, effectiveLessonRefs)`.
- Produces: `requestPreview` returning a persisted `preview-ready` flow without a generation task.

- [ ] **Step 1: Replace AI-submit assertions** with tests that a preview is ready immediately and matches deterministic suggestions.
- [ ] **Step 2: Run planning and bootstrap tests** and confirm they fail against the AI-backed implementation.
- [ ] **Step 3: Remove** `generationRuntime` and `providerId` from `createPlanFlowService`, compute suggestions during `requestPreview`, validate them, and persist conflict information.
- [ ] **Step 4: Simplify bootstrap** so the route directly delegates to the service; remove generation awaiting, model JSON parsing, and all schedule-change recommendation refresh calls.
- [ ] **Step 5: Run planning and bootstrap tests** and expect zero provider attempts attributable to preview or schedule mutations.

### Task 3: Immediate Frontend State Reconciliation

**Files:**
- Modify: `apps/web/src/features/planning/planning-page.tsx`
- Modify: `apps/web/src/features/planning/planning-page.test.tsx`
- Modify: `apps/web/src/features/planning/plan-flow-panel.tsx`

**Interfaces:**
- Consumes: existing `PlanningClient` responses.
- Produces: visible planning state that changes immediately after successful commands.

- [ ] **Step 1: Keep the regression test** that clicks “取消排期” and expects the date and cancel button to disappear without reload.
- [ ] **Step 2: Filter the removed item** from local state instead of replacing it with a removed tombstone.
- [ ] **Step 3: Replace AI-specific failure copy** with deterministic constraint/version error copy.
- [ ] **Step 4: Run** `vitest run apps/web/src/features/planning`; expect all planning UI tests to pass.

### Task 4: Full Verification and Runtime Deployment

**Files:**
- Verify all files above; no new interfaces.

- [ ] **Step 1: Run server planning and bootstrap tests**, web planning tests, typechecks, and lint.
- [ ] **Step 2: Search production planning code** for plan-flow generation submission, terminal waiting, model parsing, and schedule-change recommendation refresh; expect no active paths.
- [ ] **Step 3: Reconnect the desktop runtime** to the newly built release and wait for readiness.
- [ ] **Step 4: In the real planning page**, cancel a scheduled lesson and verify the row changes immediately, the API state matches, and a reload preserves the same state.
- [ ] **Step 5: Restore any schedule item used for verification** so user data is unchanged.
