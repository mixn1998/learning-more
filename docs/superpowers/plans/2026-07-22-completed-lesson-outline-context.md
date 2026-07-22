# Completed Lesson Outline Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep completed lessons frozen across outline revisions and provide a two-part past-version context to every revision generation.

**Architecture:** The authoring context assembler reads bounded historical dialogue and completed lesson summaries through injected read-only functions. Revision publication normalizes completed semantic keys to their original lesson definitions and always retains completed lesson IDs. The current affected course is repaired with a new immutable outline version.

**Tech Stack:** TypeScript, Vitest, Node.js, local-file repositories, atomic UnitOfWork.

## Global Constraints

- Only `learning.progress = completed` marks a completed lesson.
- Do not add semantic duplicate classification, confirmation UI, or a semantic publish gate.
- Preserve unrelated dirty-worktree changes.
- Preserve immutable historical outlines, sessions, Reviews, and lesson definitions.

---

### Task 1: Two-part revision generation context

**Files:**
- Modify: `apps/server/src/modules/course-authoring/ports/authoring-agent.ts`
- Modify: `apps/server/src/modules/course-authoring/implementation/authoring-context-assembler.ts`
- Modify: `apps/server/src/modules/course-authoring/implementation/prompt-input-builder.ts`
- Modify: `apps/server/src/modules/course-authoring/implementation/candidate-output-contract.ts`
- Test: `apps/server/src/modules/course-authoring/tests/candidate-output-contract.test.ts`
- Test: `apps/server/src/modules/course-authoring/tests/authoring-context-assembler.test.ts`

**Interfaces:**
- Produces: `CompletedLessonOutlineContext` and `AuthoringContext.pastVersionContext`.
- Consumes: `historySessionIds` and `listCompletedLessonOutlineContexts(courseId)`.

- [ ] **Step 1: Write failing tests** asserting that revision input contains a bounded historical dialogue digest and completed lesson summaries marked `用户已完成`, while new-course input remains unchanged.
- [ ] **Step 2: Run** `pnpm --filter @learning-more/server test -- candidate-output-contract.test.ts authoring-context-assembler.test.ts` and expect the new assertions to fail.
- [ ] **Step 3: Add the context types and deterministic dialogue compactor**, keeping current-session messages separate from historical messages.
- [ ] **Step 4: Render exactly two subsections under the past-version context** and instruct the model to preserve stable semantic keys and frozen outline summaries.
- [ ] **Step 5: Re-run the two focused tests** and expect PASS.

### Task 2: Completed lesson publication invariant and production wiring

**Files:**
- Modify: `apps/server/src/modules/course-authoring/implementation/revise-course-outline.ts`
- Modify: `apps/server/src/modules/course-authoring/implementation/course-authoring-facade.ts`
- Modify: `apps/server/src/modules/course-authoring/implementation/candidate-generation-coordinator.ts`
- Modify: `apps/server/src/bootstrap/local-application/course-runtime.ts`
- Test: `apps/server/src/modules/course-authoring/tests/revise-course-outline.test.ts`
- Test: `apps/server/src/modules/course-authoring/tests/candidate-generation-coordinator.test.ts`

**Interfaces:**
- Consumes: `isLessonCompleted(lessonId)` and `listCompletedLessonOutlineContexts(courseId)`.
- Produces: activity `lessonIds` containing every completed original lesson ID exactly once.

- [ ] **Step 1: Write failing revision tests** for an omitted completed lesson and a completed semantic key whose candidate wording was changed.
- [ ] **Step 2: Run** `pnpm --filter @learning-more/server test -- revise-course-outline.test.ts candidate-generation-coordinator.test.ts` and expect FAIL.
- [ ] **Step 3: Normalize completed anchors before persistence**: seed stable mappings, use frozen definitions for matching semantic keys, prepend omitted completed IDs, and include them as completed recommendation candidates.
- [ ] **Step 4: Wire the local learning-session repository** so both generation and publication use `learning.progress === 'completed'`.
- [ ] **Step 5: Re-run focused tests and server typecheck** with `pnpm --filter @learning-more/server typecheck` and expect PASS.

### Task 3: Repair the current course and verify

**Files:**
- Create temporarily, then remove: `tools/repair-current-completed-lessons.ts`
- Modify outside Git through UnitOfWork: `.learning-more-data/`

**Interfaces:**
- Consumes: current course, current outline, six named lesson IDs, local UnitOfWork.
- Produces: a new immutable outline version and a repaired active course reference.

- [ ] **Step 1: Back up the affected aggregate files** under the data root backup area with a timestamped repair manifest.
- [ ] **Step 2: Run a dry check** that the course and all six expected IDs match the precondition; abort without writes on mismatch.
- [ ] **Step 3: Create a new outline version** whose module-one Markdown uses the two frozen completed lessons and whose module-two-and-later Markdown is copied from the current outline.
- [ ] **Step 4: Atomically update the course** to `[old completed lesson 1, old completed lesson 2, ...current lessons except the two duplicate new lessons]` and keep historical entities untouched.
- [ ] **Step 5: Verify repository decoding, course lesson order, completion records, and absence of duplicate IDs**; then remove the temporary repair script.

### Task 4: Regression and commit

**Files:**
- Modify: `CONTEXT.md` only if the narrowed domain wording differs from the current glossary entry.

**Interfaces:**
- Consumes: all prior task results.
- Produces: one scoped code commit plus the already-reviewed design history.

- [ ] **Step 1: Run focused authoring tests and Prettier checks** on only touched files.
- [ ] **Step 2: Run `git diff --check`** and inspect that unrelated dirty files are not staged.
- [ ] **Step 3: Commit only the completed-lesson context, invariant, tests, and narrowed documentation** with `git commit -m "fix: preserve completed lessons across outline revisions"`.
