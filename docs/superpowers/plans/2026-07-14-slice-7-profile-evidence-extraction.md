# Slice 7: Checkpoint-Based Profile Evidence Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add controlled AI extraction of durable profile candidates and open-ended thinking-behavior observations without silently promoting them into permanent global-profile facts.

**Architecture:** At bounded checkpoints, the profile-evidence module consumes an immutable evidence slice, extracts schema-validated candidates, deduplicates/aggregates observations, and writes candidate records. Promotion, correction, expiry, and deletion remain deterministic governance operations.

**Tech Stack:** TypeScript, Zod, Vitest, existing global-profile and reasoning-behavior modules.

---

### Task 1: Define governed candidate and observation data

**Files:**
- Modify: `packages/contracts/src/global-user-profile.ts`
- Modify: `packages/contracts/src/events.ts`
- Create: `apps/server/src/modules/profile-evidence/model/profile-evidence-candidate.ts`
- Create: `apps/server/src/modules/profile-evidence/tests/profile-evidence-candidate.test.ts`

- [ ] Define candidate kinds for durable preference/fact and open-ended learning/thinking behavior observation.
- [ ] Require evidence refs, checkpoint, source scope, confidence, observed count, first/last observed, status, expiry policy, analyzer/version, and contradiction links.
- [ ] Prohibit AI from setting `confirmed` or overwriting a global-profile value.

### Task 2: Extract only at controlled checkpoints

**Files:**
- Create: `apps/server/src/modules/profile-evidence/implementation/profile-evidence-context-assembler.ts`
- Create: `apps/server/src/modules/profile-evidence/implementation/ai-profile-evidence-extractor.ts`
- Create: `apps/server/src/modules/profile-evidence/tests/ai-profile-evidence-extractor.test.ts`
- Modify: `apps/server/src/modules/course-authoring/implementation/course-authoring-facade.ts`
- Modify: `apps/server/src/modules/teaching/implementation/teaching-session-service.ts`
- Modify: `apps/server/src/modules/review-closure/implementation/review-service.ts`

- [ ] Test checkpoints after authoring baseline/candidate confirmation, teaching session closure, stage/final/course Review, and explicit profile refresh.
- [ ] Test that raw turn-by-turn extraction is not triggered.
- [ ] Test flexible labels such as logical/associative/divergent/structural/metaphorical as examples only; the schema must admit new labels.
- [ ] Validate evidence refs against the checkpoint snapshot and reject unsupported claims.

### Task 3: Aggregate, deduplicate, and promote safely

**Files:**
- Create: `apps/server/src/modules/profile-evidence/implementation/profile-evidence-aggregator.ts`
- Create: `apps/server/src/modules/profile-evidence/tests/profile-evidence-aggregator.test.ts`
- Modify: `apps/server/src/modules/global-user-profile/implementation/global-user-profile-service.ts`
- Modify: `apps/server/src/bootstrap/local-application.ts`

- [ ] Test semantic-key deduplication, evidence-count aggregation, contradiction retention, expiry, user correction, deletion propagation, and re-analysis versioning.
- [ ] Allow downstream portrait/personalization consumers to read candidates under confidence/provenance policy; require explicit governance rules for promotion to durable facts.
- [ ] Ensure the global profile stores long-lived facts/preferences while the learning portrait consumes candidates as analytical evidence.

### Task 4: Synchronize consumers, governance, and verification

**Files:**
- Modify: `docs/data-governance.md`
- Modify: `docs/architecture.md`
- Modify: `docs/ai-scenario-inventory.md`
- Modify: `tools/architecture/src/check-architecture.ts`

- [ ] Document producers, consumers, legal basis/consent, retention, correction, deletion, confidence thresholds, and lineage for every new field.
- [ ] Add architecture checks preventing UI/AI adapters from directly mutating confirmed global-profile records.
- [ ] Run focused tests, `corepack pnpm schema:check`, `corepack pnpm architecture:check`, and `corepack pnpm typecheck`; expect exit `0`.
- [ ] Stage only Slice 7 and governance files and commit with `git commit -m "feat: add governed AI profile evidence checkpoints"`.
