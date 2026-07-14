# Slice 5: Real AI Learning Portrait Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Produce evidence-grounded, versioned learning-portrait analysis while keeping the learning portrait distinct from the long-lived global user profile.

**Architecture:** The portrait module consumes bounded learning evidence and permitted global-profile facts, emits a validated analysis with citations/confidence, and stores a portrait version. It never writes global-profile facts directly.

**Tech Stack:** TypeScript, Zod, Fastify, React, Vitest.

---

### Task 1: Separate portrait and global profile in contracts

**Files:**
- Modify: `packages/contracts/src/profile.ts`
- Modify: `packages/contracts/src/global-user-profile.ts`
- Modify: `packages/contracts/src/global-user-profile.test.ts`
- Modify: `packages/contracts/openapi/openapi.yaml`

- [ ] Test that portrait insights are versioned analytical outputs and global-profile entries are durable facts/preferences with provenance and lifecycle status.
- [ ] Add open-ended `observedTendencies[]` rather than fixed logic/association/divergence columns.
- [ ] Each tendency carries label, description, evidence refs/count, contexts, confidence, first/last observed, and analysis version.

### Task 2: Assemble context and generate a portrait

**Files:**
- Create: `apps/server/src/modules/learning-portrait/implementation/portrait-context-assembler.ts`
- Create: `apps/server/src/modules/learning-portrait/implementation/ai-portrait-service.ts`
- Create: `apps/server/src/modules/learning-portrait/tests/ai-portrait-service.test.ts`
- Modify: `apps/server/src/bootstrap/local-application.ts`

- [ ] Test consumption of Review evidence, teaching observations, ledger slices, reasoning-behavior analyses, course progress, and permitted global-profile facts.
- [ ] Test flexible AI-derived tendency labels, aggregation of repeated evidence, uncertainty, contradictions, and no-evidence behavior.
- [ ] Validate source refs and confidence; store immutable portrait versions.
- [ ] Remove programmatic fixed-dimension sentence assembly and immediate task cancellation.

### Task 3: Update portrait read model and UI

**Files:**
- Modify: `apps/server/src/bootstrap/http-routes.ts`
- Modify: `apps/web/src/features/profile/learning-portrait-page.tsx`
- Modify: `apps/web/src/features/profile/learning-portrait-page.test.tsx`

- [ ] Render narrative, supporting evidence, confidence, and observed tendency collections without assuming radar-chart axes.
- [ ] Add generating/error/retry/stale-version states.
- [ ] Run focused tests, typecheck, and a production grep for the old fixed sentences; expect success and no fake path.
- [ ] Stage only Slice 5 files and commit with `git commit -m "feat: generate evidence-grounded learning portraits"`.
