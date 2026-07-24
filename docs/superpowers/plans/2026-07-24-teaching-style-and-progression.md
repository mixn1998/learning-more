# Teaching Style And Progression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Execute the tasks below in order and keep the existing teaching workflow unchanged.

**Goal:** Make formal-course teaching follow the course’s intended form and the learner’s valid reasoning path while limiting detail-level follow-up and requiring substantive progression.

**Architecture:** Keep the change inside existing prompt policy modules. High-priority guiding policy owns learner-path freedom, core policy owns language/style adaptation, closure and phase policies own interaction density and progression, and the depth module applies the same limits to key/difficult knowledge points.

**Tech Stack:** TypeScript, Vitest, existing interactive-teaching prompt renderers.

## Global Constraints

- Do not modify teaching ledger state, observation, progress synchronization, generation lifecycle, or lesson closure.
- Do not add a new public course or context field.
- Reuse `courseMode`, `playIntent`, lesson facts, and recent messages already present in the prompt.
- A learner may follow any relevant reasoning path inside the current knowledge-point framework.
- The same understanding gap may be followed up at most once; afterwards change explanation, example, or thinking angle and move understanding forward.

---

### Task 1: Align fixed teaching policies

**Files:**
- Modify: `apps/server/src/modules/interactive-teaching/implementation/teaching-guiding-policy.ts`
- Modify: `apps/server/src/modules/interactive-teaching/implementation/teaching-core-policy.ts`
- Modify: `apps/server/src/modules/interactive-teaching/implementation/teaching-closure-policy.ts`
- Test: `apps/server/src/modules/interactive-teaching/tests/generation-teaching-agent.test.ts`

**Interfaces:**
- Consumes: existing zero-argument policy renderers.
- Produces: the same `string` prompt fragments with revised policy wording.

- [x] Add prompt assertions for learner-path freedom, adaptive language style, integrated questions, one follow-up maximum, and required progression.
- [x] Run the focused agent test and confirm the new assertions fail.
- [x] Update the three fixed policy renderers without changing their signatures.
- [x] Run the focused agent test and confirm it passes.

### Task 2: Remove phase and depth contradictions

**Files:**
- Modify: `apps/server/src/modules/interactive-teaching/implementation/teaching-flow-policy.ts`
- Modify: `apps/server/src/modules/interactive-teaching/implementation/teaching-depth-policy.ts`
- Test: `apps/server/src/modules/interactive-teaching/tests/teaching-depth-policy.test.ts`
- Test: `apps/server/src/modules/interactive-teaching/tests/generation-teaching-agent.test.ts`

**Interfaces:**
- Consumes: `TeachingContextPackage`.
- Produces: unchanged phase/depth prompt fragments.

- [x] Replace “multi-round interaction” wording that conflicts with the one-follow-up rule.
- [x] Require one integrated understanding task, follow only real gaps, and switch explanation after one follow-up.
- [x] Preserve deeper explanation for key/difficult points without allowing detail interrogation.
- [x] Run both focused test files and confirm they pass.

### Task 3: Make course modes carry distinct language rhythms

**Files:**
- Modify: `apps/server/src/modules/interactive-teaching/implementation/teaching-play-intent.ts`
- Test: `apps/server/src/modules/interactive-teaching/tests/generation-teaching-agent.test.ts`

**Interfaces:**
- Consumes: existing `CourseMode`.
- Produces: unchanged optional `playIntent` string.

- [x] Enrich each non-standard mode intent with an appropriate language/interaction rhythm while preserving its teaching purpose.
- [x] Verify the rendered teaching prompt contains the selected mode intent and does not expose internal field names.
- [x] Run focused interactive-teaching tests and server typecheck.

### Task 4: Present and publish

**Files:**
- No runtime file changes.

**Interfaces:**
- Consumes: final prompt renderer source.
- Produces: a user-facing, module-by-module display of every teaching prompt fragment.

- [x] Review the final diff for workflow changes or contradictory wording.
- [x] Commit the implementation.
- [ ] Push `main`.
- [ ] Display fixed, conditional, dynamic, and machine-control prompt sections for manual conversation tuning.
