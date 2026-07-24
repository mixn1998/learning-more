# Teaching Without Assessment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace assessment-gated formal teaching with optional interaction invitations and a comprehensive application stage while preserving historical session compatibility.

**Architecture:** Introduce the new phase name at protocol and contract boundaries, normalize the legacy phase on read, and remove verification streaks from progression authority. Keep the teaching ledger responsible for progress while teaching observation and Review remain responsible for learning evidence.

**Tech Stack:** TypeScript, Zod contracts, Vitest, React.

## Global Constraints

- Preserve user edits in `docs/superpowers/reports/2026-07-24-formal-teaching-prompt-snapshot.md`.
- Do not batch rewrite historical sessions.
- Do not change teaching observation or Review ownership of learning behavior evidence.
- Do not let `verificationSignals` or `verificationStreak` gate new teaching progress.

---

### Task 1: Protocol and historical normalization

**Files:**
- Modify: `packages/contracts/src/teaching.ts`
- Modify: `packages/contracts/src/learning-session.ts`
- Modify: `apps/server/src/modules/interactive-teaching/implementation/teaching-directive.ts`
- Test: `apps/server/src/modules/interactive-teaching/implementation/teaching-directive.test.ts`

**Interfaces:**
- Consumes: persisted `comprehensive_check` phase values.
- Produces: canonical `comprehensive_application` values for new generation and normalized runtime state.

- [ ] Add the canonical phase and legacy input compatibility to contracts.
- [ ] Remove verification-streak forced progression from directive application.
- [ ] Update closure gates to use the canonical phase.
- [ ] Add tests covering legacy recovery and progress without correct-answer streaks.
- [ ] Run the focused directive tests.

### Task 2: Prompt assembly and teaching policy

**Files:**
- Modify: `apps/server/src/modules/interactive-teaching/implementation/teaching-context.ts`
- Modify: `apps/server/src/modules/interactive-teaching/implementation/teaching-closure-policy.ts`
- Modify: `apps/server/src/modules/interactive-teaching/implementation/teaching-flow-policy.ts`
- Modify: `apps/server/src/modules/interactive-teaching/implementation/teaching-control-protocol.ts`
- Modify: `apps/server/src/modules/interactive-teaching/implementation/generation-teaching-observer.ts`
- Test: `apps/server/src/modules/interactive-teaching/implementation/interactive-teaching.test.ts`

**Interfaces:**
- Consumes: canonical teaching state and the edited prompt snapshot.
- Produces: visible teaching instructions and sparse machine directives without assessment semantics.

- [ ] Align common, phase, closure, and control prompts with optional interaction invitations.
- [ ] Remove runtime injection of recent signals, related Reviews, and related materials.
- [ ] Keep difficulty signals and personalized background behavior intact.
- [ ] Update observer wording without changing its data ownership.
- [ ] Run focused interactive-teaching tests.

### Task 3: UI projection and product documentation

**Files:**
- Modify: `apps/web/src/features/learning/session-page.tsx`
- Modify: `CONTEXT.md`
- Modify: `docs/项目2.0现状/01-功能设计层.md`
- Modify: `docs/superpowers/reports/2026-07-24-formal-teaching-prompt-snapshot.md`

**Interfaces:**
- Consumes: canonical/legacy-normalized teaching state.
- Produces: user-visible “综合应用” terminology and current-state documentation.

- [ ] Replace visible assessment wording with interaction/application wording.
- [ ] Resolve residual contradictions in the edited prompt snapshot without reverting its structure.
- [ ] Update product/domain descriptions to teaching-completion semantics.
- [ ] Scan scoped runtime and documentation paths for obsolete assessment terminology.

### Task 4: Verification

**Files:**
- Verify: server and web packages changed above.

**Interfaces:**
- Consumes: all implementation tasks.
- Produces: evidence that current and historical sessions remain operable.

- [ ] Run focused teaching tests.
- [ ] Run server and web typechecks.
- [ ] Run the obsolete-semantics scan and inspect intentional compatibility identifiers.
- [ ] Review the final diff for unrelated changes and preserved user edits.
