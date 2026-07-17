# Architecture Greenline Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the committed tree to a green quality baseline by fixing the Planning seam, splitting teaching-context composition out of `learning-runtime.ts`, and formatting the six reported files without changing behavior.

**Architecture:** Planning owns all schedule and plan-flow cleanup rules behind one transactional `PlanningOutlineRevisionParticipant` Interface. CourseAuthoring supplies revision facts and an existing transaction but no longer imports Planning Repository ports. Learning runtime delegates teaching-context source assembly to one internal deep Module while retaining its external Interface.

**Tech Stack:** TypeScript 5, Node.js 24, pnpm 10, Vitest 4, Prettier, custom architecture verifier.

## Global Constraints

- Preserve the current same-transaction outline revision and Planning cleanup behavior.
- Do not expose Schedule or PlanFlow Repository types from `planning/interface.ts`.
- Do not change HTTP, OpenAPI, persistence Schema, event payload, or `LocalLearningRuntime` contracts.
- Keep `learning-runtime.ts` at or below 610 physical lines after formatting.
- Treat concurrent Teaching work as out of scope: do not repair, stage, commit, or use its transient failures as evidence against this plan.
- Do not change Vitest workers, CI, release, Host, startup, or health-check architecture in this plan.

---

## File Structure

- `apps/server/src/modules/planning/interface.ts`: public transactional outline-revision participant and its input contract.
- `apps/server/src/modules/planning/implementation/outline-revision-cleanup.ts`: private Schedule/PlanFlow cleanup implementation.
- `apps/server/src/modules/planning/tests/outline-revision-cleanup.test.ts`: behavior test for the Planning participant.
- `apps/server/src/modules/course-authoring/implementation/revise-course-outline.ts`: calls the Planning participant through its public Interface.
- `apps/server/src/modules/course-authoring/implementation/course-authoring-facade.ts`: accepts the Planning participant dependency.
- `apps/server/src/bootstrap/local-application/course-runtime.ts`: composes the Planning implementation and local-file adapters.
- `apps/server/src/bootstrap/local-application/learning-teaching-context.ts`: internal teaching-context Module.
- `apps/server/src/bootstrap/local-application/learning-runtime.ts`: delegates teaching-context creation.
- Five surviving Prettier failures: formatting-only changes.

### Task 1: Move outline-revision cleanup behind the Planning Interface

**Files:**

- Modify: `apps/server/src/modules/planning/interface.ts`
- Create: `apps/server/src/modules/planning/implementation/outline-revision-cleanup.ts`
- Create: `apps/server/src/modules/planning/tests/outline-revision-cleanup.test.ts`
- Delete: `apps/server/src/modules/course-authoring/implementation/outline-revision-live-cleanup.ts`
- Delete: `apps/server/src/modules/course-authoring/tests/outline-revision-live-cleanup.test.ts`
- Modify: `apps/server/src/modules/course-authoring/implementation/revise-course-outline.ts`
- Modify: `apps/server/src/modules/course-authoring/implementation/course-authoring-facade.ts`
- Modify: `apps/server/src/bootstrap/local-application/course-runtime.ts`

**Interfaces:**

- Consumes: the caller-owned `TransactionContext`, Schedule and PlanFlow Repository adapters, and the existing cancellation-event callback.
- Produces:

```ts
export type PlanningOutlineRevisionInput = Readonly<{
  courseId: string;
  retainedLessonIds: readonly string[];
  knownCourseLessonIds: readonly string[];
  commandId: string;
  occurredAt: string;
}>;

export interface PlanningOutlineRevisionParticipant {
  retireOutlineReferences(
    input: PlanningOutlineRevisionInput,
    tx: TransactionContext,
  ): Promise<void>;
}
```

- [ ] **Step 1: Relocate the existing behavior test to the Planning seam**

Move the test body unchanged to `modules/planning/tests/outline-revision-cleanup.test.ts`; update its imports and call:

```ts
import { createOutlineRevisionCleanup } from '../implementation/outline-revision-cleanup.js';
import { createInMemoryPlanFlowRepository } from '../ports/plan-flow-repository.js';
import { createInMemoryScheduleRepository } from '../ports/schedule-repository.js';

const cleanup = createOutlineRevisionCleanup({
  schedules,
  planFlows,
  recordScheduleCancelled,
});
await cleanup.retireOutlineReferences(input, tx);
```

- [ ] **Step 2: Run the relocated test and confirm the new seam is red**

Run:

```powershell
node node_modules\vitest\vitest.mjs run apps/server/src/modules/planning/tests/outline-revision-cleanup.test.ts --maxWorkers=1 --reporter=dot
```

Expected: FAIL because `outline-revision-cleanup.ts` and `createOutlineRevisionCleanup` do not exist.

- [ ] **Step 3: Add the Planning Interface and minimal implementation**

Add the two public declarations above to `planning/interface.ts`. Create the implementation by moving the existing cleanup algorithm into Planning and changing only the names:

```ts
import type { TransactionContext } from '../../../persistence/unit-of-work.js';
import type { PlanningOutlineRevisionParticipant } from '../interface.js';
import type { PlanFlowRepository } from '../ports/plan-flow-repository.js';
import type { ScheduleRepository } from '../ports/schedule-repository.js';

type ScheduleCancelledEvent = Readonly<{
  scheduleItemId: string;
  courseId: string;
  lessonId: string;
  reason: 'outline_revised';
  occurredAt: string;
}>;

const unconfirmedPlanFlowStates = new Set([
  'draft',
  'previewing',
  'preview-ready',
  'confirming',
]);

export function createOutlineRevisionCleanup(options: {
  readonly schedules: ScheduleRepository;
  readonly planFlows: PlanFlowRepository;
  readonly recordScheduleCancelled?: (
    event: ScheduleCancelledEvent,
    tx: TransactionContext,
  ) => Promise<void>;
}): PlanningOutlineRevisionParticipant {
  return {
    async retireOutlineReferences(input, tx) {
      const retained = new Set(input.retainedLessonIds);
      const staleCourseLessons = new Set(
        input.knownCourseLessonIds.filter((lessonId) => !retained.has(lessonId)),
      );

      for await (const item of options.schedules.list()) {
        if (
          item.courseId !== input.courseId ||
          item.status !== 'scheduled' ||
          retained.has(item.lessonId)
        ) {
          continue;
        }
        await options.schedules.save(
          tx,
          {
            ...item,
            status: 'removed',
            cancelReason: 'outline_revised',
            updatedAt: input.occurredAt,
            processedCommandIds: item.processedCommandIds.includes(input.commandId)
              ? item.processedCommandIds
              : [...item.processedCommandIds, input.commandId],
          },
          item.resourceVersion,
        );
        await options.recordScheduleCancelled?.(
          {
            scheduleItemId: item.id,
            courseId: item.courseId,
            lessonId: item.lessonId,
            reason: 'outline_revised',
            occurredAt: input.occurredAt,
          },
          tx,
        );
      }

      for await (const flow of options.planFlows.list()) {
        const referencesCourse =
          flow.courseRefs.includes(input.courseId) ||
          flow.suggestions.some((suggestion) => suggestion.courseId === input.courseId);
        if (!referencesCourse || !unconfirmedPlanFlowStates.has(flow.state)) continue;
        const processedCommandIds = flow.processedCommandIds ?? [];
        await options.planFlows.save(
          tx,
          {
            ...flow,
            state: 'failed',
            errorCode: 'outline_revised',
            lessonRefs: flow.lessonRefs.filter(
              (lessonId) => !staleCourseLessons.has(lessonId),
            ),
            suggestions: flow.suggestions.filter(
              (suggestion) =>
                suggestion.courseId !== input.courseId || retained.has(suggestion.lessonId),
            ),
            updatedAt: input.occurredAt,
            processedCommandIds: processedCommandIds.includes(input.commandId)
              ? processedCommandIds
              : [...processedCommandIds, input.commandId],
          },
          flow.resourceVersion,
        );
      }
    },
  };
}
```

- [ ] **Step 4: Update CourseAuthoring callers and composition**

Replace the private implementation type with the public Planning Interface:

```ts
import type { PlanningOutlineRevisionParticipant } from '../../planning/interface.js';

readonly liveCleanup?: PlanningOutlineRevisionParticipant;
```

Change the call to:

```ts
await dependencies.liveCleanup?.retireOutlineReferences(revisionInput, tx);
```

In `course-runtime.ts`, compose `createOutlineRevisionCleanup` with the existing local-file Planning repositories and pass it to the facade. Keep the event-envelope callback byte-for-byte equivalent.

- [ ] **Step 5: Run behavior and architecture tests**

Run:

```powershell
node node_modules\vitest\vitest.mjs run apps/server/src/modules/planning/tests/outline-revision-cleanup.test.ts apps/server/src/modules/course-authoring/tests/revise-course-outline.test.ts --maxWorkers=2 --reporter=dot
corepack pnpm architecture:check
```

Expected: cleanup and revision tests PASS; architecture check reports zero forbidden imports.

- [ ] **Step 6: Commit only Task 1 files**

```powershell
git add -- apps/server/src/modules/planning/interface.ts apps/server/src/modules/planning/implementation/outline-revision-cleanup.ts apps/server/src/modules/planning/tests/outline-revision-cleanup.test.ts apps/server/src/modules/course-authoring/implementation/outline-revision-live-cleanup.ts apps/server/src/modules/course-authoring/tests/outline-revision-live-cleanup.test.ts apps/server/src/modules/course-authoring/implementation/revise-course-outline.ts apps/server/src/modules/course-authoring/implementation/course-authoring-facade.ts apps/server/src/bootstrap/local-application/course-runtime.ts
git commit -m "refactor(server): move outline cleanup behind planning interface"
```

### Task 2: Extract the Learning teaching-context Module

**Files:**

- Create: `apps/server/src/bootstrap/local-application/learning-teaching-context.ts`
- Modify: `apps/server/src/bootstrap/local-application/learning-runtime.ts`
- Test: `tools/architecture/src/local-application-boundaries.test.ts`

**Interfaces:**

- Consumes: `LocalCourseRuntime['access']`, learning-record lookup, message listing, Markdown artifact reads, and personalization lookup.
- Produces:

```ts
export function createLearningTeachingContext(input: Readonly<{
  course: LocalCourseRuntime['access'];
  getLearningRecord: LearningRepositories['get'];
  listMessages: MessageLog['list'];
  artifactStore: ReturnType<typeof createMarkdownArtifactStore>;
  getPersonalizationView: TeachingContextSources['getPersonalizationView'];
}>): TeachingContextSources;
```

- [ ] **Step 1: Confirm the current complexity gate is red**

Run:

```powershell
node node_modules\vitest\vitest.mjs run tools/architecture/src/local-application-boundaries.test.ts --maxWorkers=1 --reporter=dot
```

Expected: FAIL with `learning-runtime.ts` at 694 lines and a 650-line maximum.

- [ ] **Step 2: Create `learning-teaching-context.ts`**

Move the complete current `TeachingContextSources` object into `createLearningTeachingContext`. Keep its error codes, hashing formula, message fallback order, Review selection rule, material selection rule and personalization function unchanged. The new Module creates no repositories and performs no eager I/O.

- [ ] **Step 3: Delegate from `learning-runtime.ts`**

Replace the inlined object with:

```ts
const teachingContextSources = createLearningTeachingContext({
  course: input.course.access,
  getLearningRecord: learningRepositories.get,
  listMessages: messageLog.list,
  artifactStore: input.artifactStore,
  getPersonalizationView: input.profile.getTeachingPersonalization,
});
```

Remove teaching-context-only imports from `learning-runtime.ts`; import the new factory. Do not change `LearningAccess` or route wiring. If an out-of-scope branch independently needs `createHash`, leave that branch's use untouched.

- [ ] **Step 4: Run the architecture and local-application tests**

Run:

```powershell
node node_modules\vitest\vitest.mjs run tools/architecture/src/local-application-boundaries.test.ts apps/server/src/bootstrap/local-application.test.ts --maxWorkers=2 --reporter=dot
```

Expected: PASS, and the formatted `learning-runtime.ts` line count is no more than 610.

- [ ] **Step 5: Commit only Task 2 files**

```powershell
git add -- apps/server/src/bootstrap/local-application/learning-teaching-context.ts apps/server/src/bootstrap/local-application/learning-runtime.ts
git commit -m "refactor(server): extract learning teaching context"
```

### Task 3: Repair committed formatting drift

**Files:**

- Modify: `apps/server/src/modules/interactive-teaching/implementation/teaching-directive.ts`
- Modify: `apps/server/src/modules/learning-session/model/learning-session.ts`
- Modify: `apps/server/src/persistence/recover-transactions.test.ts`
- Modify: `apps/server/src/runtime/logger.ts`
- Modify: `apps/web/src/features/learning/lesson-session-workspace.tsx`
- Format: all Task 1 and Task 2 TypeScript files.

**Interfaces:**

- Consumes: repository-pinned Prettier configuration and version.
- Produces: formatting-only diffs and a green repository format gate.

- [ ] **Step 1: Run Prettier only on known failures and task files**

```powershell
corepack pnpm exec prettier --write apps/server/src/modules/interactive-teaching/implementation/teaching-directive.ts apps/server/src/modules/learning-session/model/learning-session.ts apps/server/src/persistence/recover-transactions.test.ts apps/server/src/runtime/logger.ts apps/web/src/features/learning/lesson-session-workspace.tsx apps/server/src/modules/planning/interface.ts apps/server/src/modules/planning/implementation/outline-revision-cleanup.ts apps/server/src/modules/planning/tests/outline-revision-cleanup.test.ts apps/server/src/modules/course-authoring/implementation/revise-course-outline.ts apps/server/src/modules/course-authoring/implementation/course-authoring-facade.ts apps/server/src/bootstrap/local-application/course-runtime.ts apps/server/src/bootstrap/local-application/learning-teaching-context.ts apps/server/src/bootstrap/local-application/learning-runtime.ts
```

Expected: only layout, wrapping, indentation, quote and trailing-comma changes.

- [ ] **Step 2: Review formatting diffs and run the gate**

```powershell
git diff --check
corepack pnpm format:check
```

Expected: both commands PASS.

- [ ] **Step 3: Commit only the five standalone formatting files**

```powershell
git add -- apps/server/src/modules/interactive-teaching/implementation/teaching-directive.ts apps/server/src/modules/learning-session/model/learning-session.ts apps/server/src/persistence/recover-transactions.test.ts apps/server/src/runtime/logger.ts apps/web/src/features/learning/lesson-session-workspace.tsx
git commit -m "style: repair committed formatting drift"
```

### Task 4: Full completion audit

**Files:**

- Inspect: all files changed by Tasks 1–3.
- Preserve: all unrelated concurrent Teaching changes.

**Interfaces:**

- Consumes: repository quality gates.
- Produces: authoritative green-line evidence.

- [ ] **Step 1: Run focused compile and gates**

```powershell
corepack pnpm --filter @learning-more/server typecheck
corepack pnpm lint
corepack pnpm architecture:check
corepack pnpm format:check
```

Expected: every command exits 0.

- [ ] **Step 2: Run the complete Vitest suite with the proven safe four-worker diagnostic configuration**

```powershell
node node_modules\vitest\vitest.mjs run --passWithNoTests --maxWorkers=4 --reporter=dot
```

Expected: all tests PASS; no architecture budget failure remains.

- [ ] **Step 3: Run the authoritative repository gate**

```powershell
corepack pnpm verify
```

Expected: format, lint, typecheck, Schema, architecture, equivalence, complete serial Vitest and build all exit 0.

- [ ] **Step 4: Audit scope and commit any gate-only corrections**

```powershell
git status --short
git diff --check
git diff --name-status HEAD~3..HEAD
```

Expected: concurrent Teaching changes remain uncommitted unless their owner committed them; no generated artifacts or unrelated source changes are included. If a correction was required, stage only its explicit path and commit it with `fix: complete architecture greenline remediation`.
