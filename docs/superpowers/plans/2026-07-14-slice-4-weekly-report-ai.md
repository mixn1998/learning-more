# Slice 4: Real AI Weekly Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Generate source-grounded weekly reports from frozen weekly evidence instead of cancelling the task and returning fixed prose.

**Architecture:** The weekly-report deep module freezes a bounded evidence snapshot, asks a Markdown writer to synthesize it, validates citations/sections, and atomically stores an immutable report version.

**Tech Stack:** TypeScript, Zod, Fastify, React, Vitest.

---

### Task 1: Freeze evidence and define report versions

**Files:**
- Modify: `packages/contracts/src/profile.ts`
- Create: `apps/server/src/modules/weekly-report/model/weekly-report.ts`
- Create: `apps/server/src/modules/weekly-report/implementation/weekly-evidence-assembler.ts`
- Create: `apps/server/src/modules/weekly-report/tests/weekly-evidence-assembler.test.ts`

- [ ] Test timezone-bounded inclusion of learning sessions, ledger events, Reviews, plan changes, and reasoning evidence.
- [ ] Define immutable versions with period, evidence snapshot id/hash, Markdown, source refs, status, and generation metadata.
- [ ] Ensure absent evidence is represented as uncertainty, not invented activity.

### Task 2: Generate, validate, persist, and recover

**Files:**
- Create: `apps/server/src/modules/weekly-report/ports/weekly-report-writer.ts`
- Create: `apps/server/src/modules/weekly-report/implementation/ai-weekly-report-service.ts`
- Create: `apps/server/src/modules/weekly-report/tests/ai-weekly-report-service.test.ts`
- Modify: `apps/server/src/bootstrap/local-application.ts`

- [ ] Test completed, malformed, unsupported-claim, provider-failure, retry, and restart cases.
- [ ] Require every concrete claim to map to an allowed evidence ref; retain natural Markdown and flexible structure.
- [ ] Implement atomic report commit only after validation.
- [ ] Remove the fixed `# Weekly Review` fallback and immediate cancellation.

### Task 3: Wire retrieval and UI

**Files:**
- Modify: `apps/server/src/bootstrap/http-routes.ts`
- Modify: `apps/web/src/features/reports/weekly-report-page.tsx`
- Modify: `apps/web/src/features/reports/weekly-report-page.test.tsx`

- [ ] Show generating/error/retry/version/source states and preserve the current collapsed-by-default behavior.
- [ ] Run focused tests, `corepack pnpm typecheck`, and `rg -n "Weekly Review|cancel\(" apps/server/src/bootstrap/local-application.ts`; expect tests to pass and no fake path.
- [ ] Stage only Slice 4 files and commit with `git commit -m "feat: close weekly report AI generation loop"`.
