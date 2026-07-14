# AI Control Chain Vertical Slices Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement every vertical slice defined in the approved AI control-chain design and prove that every user-visible AI feature uses a real generation result rather than a cancelled task or hardcoded substitute.

**Architecture:** Keep each business domain as a deep module that owns its input package, result validation, persistence, and state transitions. Share only provider execution, terminal waiting, frame streaming, and restart recovery through `generation-runtime`; implement the slices in dependency order and preserve immutable/versioned business outputs.

**Tech Stack:** TypeScript 5.9, Node 24, Fastify 5, React 19, Zod 4, Vitest 4, Playwright 1.61, local-file repositories, generation-runtime/provider adapters.

**Implementation status (2026-07-14):** Steps 1–9 are implemented. Repository-wide unit, type, schema, architecture, lint, format, and build gates pass; see [implementation acceptance report](../reports/2026-07-14-ai-control-chain-vertical-slices-implementation.md).

## Global Constraints

- User-visible agents output natural Markdown; structured observations and decisions run in separate internal modules.
- A complete assessment round is one user message followed by one complete assistant message.
- The home-page course direction is persisted as the first user OutlineMessage during session creation; its first complete AI reply counts as assessment round one and the creation page never asks the user to resend it.
- Candidate generation is unavailable before three complete assessment rounds and mandatory-available after round three.
- AI never confirms a candidate, schedule, lesson start, course close, Review conclusion, or permanent profile claim on the user's behalf.
- All Provider inputs contain materialized facts and excerpts with source references; artifact references alone are insufficient.
- Existing user changes in the dirty worktree must be preserved; commits stage only files owned by the current slice.
- Each slice must pass its focused tests before the next slice starts; final completion additionally requires the repository-wide verification gates.

---

## Execution Order

1. [Course authoring conversation and candidate adjustment](2026-07-14-slice-1-course-authoring-conversation.md)
2. [Generation execution, scenario registry, and recovery](2026-07-14-slice-2-generation-execution.md)
3. [Real AI plan-flow preview](2026-07-14-slice-3-plan-flow-ai.md)
4. [Real AI weekly report](2026-07-14-slice-4-weekly-report-ai.md)
5. [Real AI learning portrait](2026-07-14-slice-5-learning-portrait-ai.md)
6. [Next-lesson recommendation](2026-07-14-slice-6-next-lesson-recommendation.md)
7. [Checkpoint-based profile evidence extraction](2026-07-14-slice-7-profile-evidence-extraction.md)
8. Run the formal-course AI control-chain audit: teaching context assembly, course/adjacent scope behavior, teaching observer, state ledger, stage/final/course Review, restart recovery, and downstream evidence consumption.
9. Synchronize product rules, AI inventory, data-governance documents, OpenAPI, scenario registry, and architecture checks.
10. Run completion audit against every design assertion and every command below.

## Final Verification Commands

```powershell
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm schema:check
corepack pnpm architecture:check
corepack pnpm equivalence:check
corepack pnpm test
corepack pnpm build
corepack pnpm playwright:test
```

Expected: every command exits `0`; production code search finds no task cancellation followed by hardcoded AI success content.

```powershell
rg -n "cancel\(.*generationTaskId|Weekly Review|符合用户时间窗|当前学习画像" apps/server/src/bootstrap apps/server/src/modules
```

Expected: no composition-root hardcoded AI success path; user-facing copy may only remain in tests/fixtures explicitly named as fixtures.
