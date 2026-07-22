# Adaptive Teaching Context Optimization Implementation Plan

> **For Codex:** Execute this plan task-by-task in the current worktree. Preserve unrelated user changes and keep the existing Review production behavior unchanged.

**Goal:** Reduce formal-course response latency and prompt growth through prompt assembly and model-parameter routing while preserving the complete existing course-session workflow.

**Architecture:** Add pure turn-policy modules that derive reasoning effort, capability inclusion, and a local read-only ledger projection. Add a versioned personalization digest projection after the existing global profile analysis: refresh it asynchronously, retain the previous successful digest during refresh or failure, and inject at most 500 characters into teaching prompts. Sparse directives, full-ledger validation, Review production, task scheduling, session state, and closure behavior remain unchanged.

**Tech Stack:** TypeScript, Zod contracts, Vitest, local-file repositories, generation runtime.

---

## Task 1: Adaptive turn policy and capability routing

**Files:**
- Create: `apps/server/src/modules/interactive-teaching/implementation/teaching-turn-policy.ts`
- Create: `apps/server/src/modules/interactive-teaching/implementation/teaching-capability-router.ts`
- Modify: `apps/server/src/modules/interactive-teaching/implementation/generation-teaching-agent.ts`
- Test: `apps/server/src/modules/interactive-teaching/tests/teaching-turn-policy.test.ts`
- Test: `apps/server/src/modules/interactive-teaching/tests/teaching-capability-router.test.ts`
- Test: `apps/server/src/modules/interactive-teaching/tests/generation-teaching-agent.test.ts`

1. Write failing tests for low/medium/high effort, ambiguity fallback, and follow-up counting scoped by session plus knowledge-point ref.
2. Verify switching points pauses the count and revisiting the point restores its existing `request_deeper_explanation` count.
3. Write failing capability tests for explicit visual requests, mathematical visual concepts, prior math-plot continuation, nonvisual domains, and the Chinese single-character `场` false-positive guard.
4. Implement deterministic pure policies and pass the selected `reasoningEffort` into `GenerationRuntime.submit`.
5. Inject `renderMathPlotCapability()` only when the capability router requests it.
6. Run the three focused test files.

## Task 2: Local ledger projection and prompt deduplication

**Files:**
- Create: `apps/server/src/modules/interactive-teaching/implementation/teaching-ledger-projection.ts`
- Modify: `apps/server/src/modules/interactive-teaching/implementation/teaching-control-protocol.ts`
- Modify: `apps/server/src/modules/interactive-teaching/implementation/teaching-fact-context.ts`
- Test: `apps/server/src/modules/interactive-teaching/tests/teaching-ledger-projection.test.ts`
- Test: `apps/server/src/modules/interactive-teaching/tests/teaching-directive.test.ts`
- Test: `apps/server/src/modules/interactive-teaching/tests/generation-teaching-agent.test.ts`

1. Write failing tests for ordinary local windows, endpoint compact-full projections, explicit old-point references, and ambiguous references.
2. Implement a projection that always contains current point full state, next point reference, terminal counts, phase gates, and current point deep-follow-up count.
3. Keep the authoritative full ledger and sparse directive validation unchanged.
4. Replace the repeated full natural-language responsibility list with a local `当前教学窗口` describing evidence, gaps, and teaching need.
5. Compress fixed machine-protocol prose without removing enums, gates, sparse-update rules, or difficulty-signal semantics.
6. Run focused protocol, directive, projection, and agent tests.

## Task 3: Versioned personalization digest and prompt compression

**Files:**
- Create: `apps/server/src/modules/global-user-profile/implementation/personalization-digest.ts`
- Create: `apps/server/src/modules/global-user-profile/ports/personalization-digest-repository.ts`
- Create: `apps/server/src/persistence/personalization-digest-repositories.ts`
- Modify: `apps/server/src/bootstrap/local-application/profile-runtime.ts`
- Create: `apps/server/src/modules/interactive-teaching/implementation/teaching-personalization-prompt.ts`
- Modify: `apps/server/src/modules/interactive-teaching/implementation/teaching-fact-context.ts`
- Test: `apps/server/src/modules/global-user-profile/tests/personalization-digest.test.ts`
- Test: `apps/server/src/bootstrap/local-application/profile-runtime.test.ts`
- Test: `apps/server/src/modules/interactive-teaching/tests/teaching-personalization-prompt.test.ts`

1. Build the digest only from cross-session stable dimensions and durable explicit preferences; never fall back to raw or single-session candidates.
2. Persist requested profile/source versions, refresh status, and the latest successful digest separately.
3. Serialize refreshes, use optimistic writes, reject stale completions, and keep serving the previous successful digest while a newer refresh is pending or failed.
4. Trigger non-blocking refresh after profile projection and at startup so existing profile data is backfilled.
5. Render the stored digest into the teaching prompt with a hard 500-character bound and explicit limitations.
6. Run digest, profile-runtime, prompt-rendering, and agent tests.

## Task 4: Workflow non-regression checks

**Files:**
- Test: `apps/server/src/modules/interactive-teaching/tests/interactive-teaching.test.ts`
- Test: `apps/server/src/modules/interactive-teaching/tests/teaching-directive.test.ts`
- Test: `apps/server/src/modules/interactive-teaching/tests/teaching-generation-reconciler.test.ts`

1. Confirm Review production, learning-session workflow, scheduling, pause/retry behavior, and closure are unchanged.
2. Verify the added profile projection consumes existing aggregated profile outputs only and cannot block a teaching turn.
3. Run existing state transition, sparse directive validation, pause/recovery, generation reconciliation, Review recovery, and profile projection tests.
4. Inspect the final diff for race safety and strict separation between authoritative teaching state and prompt projection.

## Task 5: Verification, metrics, and documentation

**Files:**
- Modify as required: `docs/项目2.0现状/01-功能设计层.md`
- Modify as required: `docs/项目2.0现状/03-后端架构层.md`

1. Run all interactive-teaching, global-user-profile, profile-evidence, profile-runtime, and Review recovery tests.
2. Run package type-check and relevant server integration tests.
3. Compare representative prompt sizes for ordinary, key/difficult, and endpoint turns; verify ordinary ledger projection is bounded independently of lesson point count.
4. Verify prompt assembly only reads the latest successful digest and never waits for refresh generation.
5. Update current-state documentation only if the prompt architecture description is now inaccurate.
6. Inspect the final diff and report tests, prompt-size changes, and remaining operational risks.
