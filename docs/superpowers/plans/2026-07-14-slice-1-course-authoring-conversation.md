# Slice 1: Course Authoring Conversation and Candidate Adjustment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the one-message pseudo-assessment with a durable AI conversation, enforce the three-complete-round gate, carry the home-page direction into the session as message one, and support post-candidate clarification, full regeneration, and invariant-preserving module patches.

**Architecture:** `course-authoring` owns messages, round counting, authoring context, candidate intent observation, candidate versioning, and atomic state transitions. The visible agent emits Markdown; a separate observer emits a schema-validated decision. Provider execution stays behind the existing generation port.

**Tech Stack:** TypeScript, Fastify, Zod, React, Vitest, Playwright, local-file repositories.

---

### Task 1: Lock the contract and state machine with failing tests

**Files:**
- Modify: `packages/contracts/src/course-authoring.ts`
- Modify: `packages/contracts/src/course-authoring.test.ts`
- Modify: `packages/contracts/openapi/openapi.yaml`
- Modify: `apps/server/src/modules/course-authoring/model/outline-session.ts`
- Modify: `apps/server/src/modules/course-authoring/tests/outline-session.test.ts`

- [ ] Add `OutlineMessage`, expanded `OutlineSessionStatus`, `completedAssessmentRounds`, active task, and candidate version fields to the public schemas.
- [ ] Add a test proving session creation stores the home input as the first `user` message.
- [ ] Add tests proving only a complete user→assistant pair increments the round count; failed/partial assistant messages do not.
- [ ] Add tests proving candidate generation is rejected at rounds 0–2, becomes available at round 3, and remains available while the user continues assessment.
- [ ] Run `corepack pnpm vitest run packages/contracts/src/course-authoring.test.ts apps/server/src/modules/course-authoring/tests/outline-session.test.ts` and confirm the new assertions fail for the intended missing behavior.
- [ ] Implement the schemas and aggregate transitions; re-run the command and expect exit `0`.

### Task 2: Persist immutable authoring messages atomically

**Files:**
- Create: `apps/server/src/modules/course-authoring/model/outline-message.ts`
- Create: `apps/server/src/modules/course-authoring/ports/outline-message-repository.ts`
- Modify: `apps/server/src/modules/course-authoring/ports/outline-session-repository.ts`
- Modify: `apps/server/src/bootstrap/local-repositories.ts`
- Modify: `apps/server/src/modules/course-authoring/implementation/course-authoring-facade.ts`
- Modify: `apps/server/src/modules/course-authoring/tests/course-authoring-facade.test.ts`

- [ ] Write repository tests for ordered immutable messages and idempotent append by message id.
- [ ] Write a facade test for one create command producing the session plus first user message, followed automatically by the first assistant turn.
- [ ] Implement local-file message persistence and the unit-of-work boundary so a session cannot reference an absent message.
- [ ] Remove the old `appendMessage -> completeAssessment` shortcut.
- [ ] Run `corepack pnpm vitest run apps/server/src/modules/course-authoring/tests/course-authoring-facade.test.ts` and expect exit `0`.

### Task 3: Add the free-form authoring agent and materialized context

**Files:**
- Create: `apps/server/src/modules/course-authoring/ports/authoring-agent.ts`
- Create: `apps/server/src/modules/course-authoring/implementation/authoring-context-assembler.ts`
- Create: `apps/server/src/modules/course-authoring/implementation/generation-authoring-agent.ts`
- Modify: `apps/server/src/modules/course-authoring/implementation/prompt-input-builder.ts`
- Modify: `apps/server/src/modules/course-authoring/implementation/course-authoring-module.ts`
- Create: `apps/server/src/modules/course-authoring/tests/authoring-context-assembler.test.ts`

- [ ] Test that the context package includes topic, ordered messages, course-mode attention, parsed material excerpts plus source ids, and the current candidate when one exists.
- [ ] Test that artifact ids without materialized content are rejected by the assembler.
- [ ] Implement a short capability prompt: clarify the learner's need, stay within the course domain including adjacent exploration, and output natural Markdown only.
- [ ] Keep business state and structured decisions out of the visible agent response.
- [ ] Run `corepack pnpm vitest run apps/server/src/modules/course-authoring/tests/authoring-context-assembler.test.ts` and expect exit `0`.

### Task 4: Execute and recover authoring turns

**Files:**
- Modify: `apps/server/src/modules/course-authoring/interface.ts`
- Modify: `apps/server/src/modules/course-authoring/implementation/course-authoring-facade.ts`
- Modify: `apps/server/src/bootstrap/http-routes.ts`
- Modify: `apps/server/src/bootstrap/local-application.ts`
- Modify: `apps/server/src/modules/course-authoring/tests/course-authoring-facade.test.ts`

- [ ] Add tests for `advanceConversation`, busy-state rejection, provider failure, retry, and restart recovery from an active task.
- [ ] Implement acceptance of a user message, provider execution, complete assistant persistence, and atomic round/state commit.
- [ ] Expose session/message retrieval and conversation advancement through HTTP without exposing prompts.
- [ ] Assert that after three complete rounds the API always reports `canGenerateCandidate: true`.
- [ ] Run the focused facade and route tests; expect exit `0`.

### Task 5: Generate versioned candidates from real context

**Files:**
- Modify: `apps/server/src/modules/course-authoring/implementation/schemas/candidate-outline.ts`
- Modify: `apps/server/src/modules/course-authoring/implementation/candidate-generation-coordinator.ts`
- Modify: `apps/server/src/modules/course-authoring/implementation/outline-compiler.ts`
- Modify: `apps/server/src/modules/course-authoring/ports/candidate-version-repository.ts`
- Modify: `apps/server/src/modules/course-authoring/tests/candidate-generation-coordinator.test.ts`
- Modify: `apps/server/src/modules/course-authoring/tests/outline-compiler.test.ts`

- [ ] Extend candidates with stable `CandidateModule { id, title, lessonIds }` metadata.
- [ ] Test that candidate generation receives the full materialized authoring context and is unavailable before three rounds.
- [ ] Test immutable version creation and latest-version pointer updates.
- [ ] Implement schema validation, compile validation, and atomic version commit.
- [ ] Run both focused test files and expect exit `0`.

### Task 6: Add post-candidate alignment and safe patching

**Files:**
- Create: `apps/server/src/modules/course-authoring/implementation/authoring-turn-observer.ts`
- Create: `apps/server/src/modules/course-authoring/implementation/outline-patch-composer.ts`
- Create: `apps/server/src/modules/course-authoring/tests/authoring-turn-observer.test.ts`
- Create: `apps/server/src/modules/course-authoring/tests/outline-patch-composer.test.ts`
- Modify: `apps/server/src/modules/course-authoring/implementation/course-authoring-facade.ts`

- [ ] Define and test observer output `clarify | full_regeneration | module_patch`, with target module ids and evidence references.
- [ ] Test that `clarify` changes no candidate version.
- [ ] Test that full regeneration creates a complete new version.
- [ ] Test that module patching permits only existing target ids and byte-for-byte preserves non-target modules before saving a complete new snapshot.
- [ ] Implement observer validation and deterministic composition; reject ambiguous or invalid patch targets without mutating the candidate.
- [ ] Run the observer/composer/facade tests and expect exit `0`.

### Task 7: Replace the fixed creation UI with the real transcript

**Files:**
- Modify: `apps/web/src/features/course-authoring/authoring-workspace-model.ts`
- Modify: `apps/web/src/features/course-authoring/outline-workspace-view.tsx`
- Modify: `apps/web/src/features/course-authoring/assessment-panel.tsx`
- Modify: `apps/web/src/features/course-authoring/authoring-page.tsx`
- Modify: `apps/web/src/features/course-authoring/authoring-page.test.tsx`
- Modify: `tests/e2e/course-authoring.spec.ts`

- [ ] Test that navigation from home immediately displays the original home input as the first user bubble and never renders a duplicate initial-topic card/input request.
- [ ] Test busy/error/retry states, hidden candidate action before round 3, available action from round 3 onward, and continued chat after eligibility.
- [ ] Test candidate alignment causing clarification, full replacement, or one-module update on the right panel.
- [ ] Implement transcript rendering from API messages and stream/poll updates without fixed AI copy.
- [ ] Run `corepack pnpm vitest run apps/web/src/features/course-authoring/authoring-page.test.tsx` and `corepack pnpm playwright test tests/e2e/course-authoring.spec.ts`; expect both to exit `0`.

### Task 8: Slice verification and commit

- [ ] Run `corepack pnpm typecheck`, `corepack pnpm architecture:check`, and focused authoring tests.
- [ ] Run `rg -n "completeAssessment|随时跳过评估|你想为哪个问题打开新思路" apps/server/src apps/web/src` and verify no deprecated production control path remains.
- [ ] Review `git diff --check` and stage only Slice 1 files.
- [ ] Commit with `git commit -m "feat: close course authoring AI control chain"`.
