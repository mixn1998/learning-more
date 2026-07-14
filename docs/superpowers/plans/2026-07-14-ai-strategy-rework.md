# AI Strategy Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AI generation contracts evolvable without constraining teaching prose, make play modes observable teaching lenses rather than content prisons, and make dynamic reasoning evidence durable, auditable, and consumable across learning contexts.

**Architecture:** Keep `CandidateOutlineMetadata` as the course-domain model and introduce a versioned model-response envelope only at the provider seam. Keep `InteractiveTeaching` as the deep module for visible teaching, and give its observer an optional observation lens that prioritizes—not filters—evidence. Keep reasoning dimensions open-ended; add source-agnostic capture and dimension lineage so long-term data does not hard-code a taxonomy or accumulate disconnected near-duplicates.

**Tech Stack:** TypeScript 5.9, Zod 4, Vitest 4, Fastify 5, React 19, React Markdown, local-file repositories.

## Global Constraints

- User-visible course creation and teaching output remains natural Markdown.
- A machine response contract is an interface protocol, not a teaching-content prompt.
- `outlineSessionId`, `courseMode`, topic, source permissions, task IDs, rounds, ledger IDs, and server timestamps are server-owned and must never be model-returned requirements.
- Course-related but out-of-lesson exploration remains `adjacent`; it is recorded as a branch and never counts as lesson completion.
- Course modes change attention and observation priority, never required response form, mandatory evidence category, or learner label.
- Dynamic reasoning dimensions are evidence-derived and provisional; logical, associative, divergent, structural, and metaphorical are examples, never fixed columns.
- Learning portrait is a user-facing analysis module; global user profile is the long-lived governed evidence store. Neither may promote a local observation into a permanent fact without governance.
- Preserve existing content and Markdown freedom. Remove only implementations proven redundant by the replacement seam and its tests.

---

### Task 1: Version the candidate model-response envelope

**Files:**
- Modify: `packages/contracts/src/course-authoring.ts`
- Modify: `packages/contracts/src/course-authoring.test.ts`
- Modify: `apps/server/src/modules/course-authoring/implementation/schemas/candidate-outline.ts`
- Modify: `apps/server/src/modules/course-authoring/implementation/candidate-output-contract.ts`
- Test: `apps/server/src/modules/course-authoring/tests/candidate-output-contract.test.ts`

**Interfaces:**
- Consumes: `CandidateOutlineMetadataSchema` as the server's authoritative course-domain schema.
- Produces: `CandidateModelResponseSchema` with `{ protocol: 'learning-more.candidate', schemaVersion: 1, outline: CandidateOutlineMetadata }`.
- Invariant: a provider may return only the envelope and free Markdown; server-owned context fields are not valid envelope fields.

- [ ] **Step 1: Write failing contract tests**

```ts
expect(CandidateModelResponseSchema.parse({
  protocol: 'learning-more.candidate',
  schemaVersion: 1,
  outline: validOutline,
})).toMatchObject({ outline: validOutline });

expect(() => CandidateModelResponseSchema.parse({
  schemaVersion: 2,
  outlineSessionId: 'session_1',
  courseMode: 'case_study',
  topic: 'x',
  title: 'x',
  sourceRefs: ['source_topic'],
})).toThrow();
```

- [ ] **Step 2: Run the contract test and verify it fails**

Run: `corepack pnpm test -- apps/server/src/modules/course-authoring/tests/candidate-output-contract.test.ts`

Expected: FAIL because `CandidateModelResponseSchema` does not exist.

- [ ] **Step 3: Implement the response envelope**

```ts
export const CandidateModelResponseSchema = z.strictObject({
  protocol: z.literal('learning-more.candidate'),
  schemaVersion: z.literal(1),
  outline: CandidateOutlineMetadataSchema,
});
```

Keep `CandidateOutlineMetadataSchema` unchanged and use the envelope only where untrusted provider output crosses into the course-authoring module.

- [ ] **Step 4: Rewrite the prompt example from the same schema value**

```ts
const example = {
  protocol: 'learning-more.candidate',
  schemaVersion: 1,
  outline: candidateOutlineOutputExample,
};
```

The text must explicitly say that response syntax does not constrain Markdown teaching structure, explanations, cases, or examples.

- [ ] **Step 5: Run focused tests**

Run: `corepack pnpm test -- apps/server/src/modules/course-authoring/tests/candidate-output-contract.test.ts packages/contracts/src/course-authoring.test.ts`

Expected: PASS.

### Task 2: Compile, replay, and present the new candidate contract

**Files:**
- Modify: `apps/server/src/modules/course-authoring/implementation/outline-compiler.ts`
- Modify: `apps/server/src/modules/course-authoring/implementation/candidate-generation-coordinator.ts`
- Modify: `apps/server/src/modules/course-authoring/tests/outline-compiler.test.ts`
- Modify: `apps/server/src/modules/course-authoring/tests/candidate-generation-coordinator.test.ts`
- Modify: `apps/server/src/modules/course-authoring/tests/fixtures/codex-cli-context-envelope-as-outline.md`
- Modify: `apps/web/src/features/course-authoring/candidate-generation-failure.ts`
- Test: `apps/web/src/features/course-authoring/authoring-page.test.tsx`

**Interfaces:**
- Consumes: `CandidateModelResponseSchema` and a server-built `CandidateInputManifest`.
- Produces: `CandidateCompilationResult`, whose valid branch exposes `response.outline` as the persisted candidate and whose invalid branch preserves the raw draft artifact.
- Invariant: malformed legacy context envelopes are `candidate_invalid`, never `generation_interrupted`; no lossy mapping invents goals, lessons, or provenance.

- [ ] **Step 1: Write failing compiler and replay tests**

```ts
const response = { protocol: 'learning-more.candidate', schemaVersion: 1, outline: baseMetadata };
expect(compileCandidate(markdownFor(response), manifest)).toMatchObject({
  valid: true,
  candidate: { courseGoals: baseMetadata.courseGoals },
});

expect(replay.failureCode).toBe('candidate_invalid');
expect(replay.frames.at(-1)).toMatchObject({
  type: 'task.failed', data: { problem: { code: 'candidate_invalid' } },
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `corepack pnpm test -- apps/server/src/modules/course-authoring/tests/outline-compiler.test.ts apps/server/src/modules/course-authoring/tests/candidate-generation-coordinator.test.ts`

Expected: FAIL because the compiler currently parses the domain metadata directly.

- [ ] **Step 3: Parse the envelope, then validate the domain model**

```ts
const response = CandidateModelResponseSchema.safeParse(parsedJson);
if (!response.success) return invalidFromZod(response.error);
const parsed = response.data.outline;
```

Run all existing module/source/prerequisite/HTML checks against `parsed`; do not move those checks into prompt text.

- [ ] **Step 4: Keep failure semantics distinct in the coordinator and UI**

`candidate_invalid` means the model completed but violated the response protocol; `generation_timeout` means runtime timeout; `generation_interrupted` means transport/runtime interruption. All preserve the draft and retry authority.

- [ ] **Step 5: Run focused server and web tests**

Run: `corepack pnpm test -- apps/server/src/modules/course-authoring/tests apps/web/src/features/course-authoring/authoring-page.test.tsx`

Expected: PASS.

### Task 3: Add a non-restrictive observation lens for every course mode

**Files:**
- Create: `apps/server/src/modules/interactive-teaching/implementation/teaching-observation-lens.ts`
- Modify: `apps/server/src/modules/interactive-teaching/ports/teaching-observer.ts`
- Modify: `apps/server/src/modules/interactive-teaching/implementation/interactive-teaching.ts`
- Modify: `apps/server/src/modules/interactive-teaching/implementation/generation-teaching-observer.ts`
- Test: `apps/server/src/modules/interactive-teaching/tests/teaching-observation-lens.test.ts`
- Test: `apps/server/src/modules/interactive-teaching/tests/generation-teaching-observer.test.ts`

**Interfaces:**
- Consumes: `CourseMode` and materialized completed teaching messages.
- Produces: `TeachingObservationLens { priority: string; nonRequirements: readonly string[] }` as internal observer context.
- Invariant: no lens can suppress valid learning evidence, mark lesson completion, or become a visible response template.

- [ ] **Step 1: Write failing lens tests**

```ts
expect(observationLens('case_study')).toMatchObject({
  priority: expect.stringContaining('情境'),
  nonRequirements: expect.arrayContaining(['不要求每轮使用案例']),
});
expect(observationLens('standard').nonRequirements).toContain('不忽略其他可验证学习行为');
```

- [ ] **Step 2: Implement the lens catalog**

Each of the eight modes returns one evidence priority and shared non-requirements. The module must not return a fixed behavior taxonomy or scoring rubric.

- [ ] **Step 3: Pass the lens to the observer, not raw mode controls**

```ts
observer.observe({
  ...observationInput,
  lens: observationLens(courseMode),
});
```

The generation observer prompt labels it `【本次观察重心】` and repeats: record all material evidence even when it does not match this focus.

- [ ] **Step 4: Run focused tests**

Run: `corepack pnpm test -- apps/server/src/modules/interactive-teaching/tests/teaching-observation-lens.test.ts apps/server/src/modules/interactive-teaching/tests/generation-teaching-observer.test.ts apps/server/src/modules/interactive-teaching/tests/interactive-teaching.test.ts`

Expected: PASS.

### Task 4: Make dynamic reasoning dimensions continuous and governable

**Files:**
- Modify: `packages/contracts/src/global-user-profile.ts`
- Modify: `apps/server/src/modules/global-user-profile/ports/reasoning-behavior-repository.ts`
- Modify: `apps/server/src/modules/global-user-profile/implementation/reasoning-behavior-module.ts`
- Create: `apps/server/src/modules/global-user-profile/implementation/reasoning-dimension-reconciler.ts`
- Modify: `apps/server/src/modules/profile-evidence/implementation/reasoning-evidence-projector.ts`
- Modify: `apps/server/src/persistence/reasoning-behavior-repositories.ts`
- Test: `apps/server/src/modules/global-user-profile/tests/reasoning-dimension-reconciler.test.ts`
- Test: `apps/server/src/modules/global-user-profile/tests/reasoning-behavior-module.test.ts`

**Interfaces:**
- Consumes: evidence-derived draft dimensions and the active dimension lineage.
- Produces: `reconcileReasoningDimensions({ drafts, activeDimensions })` returning continued dimensions, newly created dimensions, and superseded dimension IDs.
- Invariant: dimensions remain open-ended; semantic continuity comes from evidence-backed lineage, not a predefined list of labels.

- [ ] **Step 1: Write failing continuity tests**

```ts
expect(reconcileReasoningDimensions({ drafts: [renamedAssociation], activeDimensions: [association] }))
  .toMatchObject({ continued: [{ dimensionId: association.dimensionId }] });

expect(reconcileReasoningDimensions({ drafts: [newMetaphorUse], activeDimensions: [association] }))
  .toMatchObject({ created: [expect.objectContaining({ label: '隐喻性建模' })] });
```

- [ ] **Step 2: Add lineage fields and reconciliation**

Persist `semanticFingerprint`, `continuesDimensionId?`, and `supersedesDimensionIds`. The reconciler may continue a dimension only when its derived episode sets and inclusion/exclusion signals overlap sufficiently; otherwise it creates a new dynamic dimension.

- [ ] **Step 3: Replace stale projected evidence instead of accumulating it**

When a dimension is superseded, retract or supersede its projected candidate evidence in the same unit of work. Deduplication must be based on stable lineage identity and source episode, not a transient dimension-set version.

- [ ] **Step 4: Run focused tests**

Run: `corepack pnpm test -- apps/server/src/modules/global-user-profile/tests apps/server/src/modules/profile-evidence/tests`

Expected: PASS.

### Task 5: Expand reasoning capture without adding visible-response latency

**Files:**
- Create: `apps/server/src/modules/global-user-profile/implementation/reasoning-checkpoint-capture.ts`
- Modify: `apps/server/src/modules/global-user-profile/interface.ts`
- Modify: `apps/server/src/bootstrap/local-application.ts`
- Modify: `apps/server/src/modules/course-authoring/implementation/course-authoring-facade.ts`
- Test: `apps/server/src/modules/global-user-profile/tests/reasoning-checkpoint-capture.test.ts`
- Test: `apps/server/src/bootstrap/local-application.test.ts`

**Interfaces:**
- Consumes: immutable authoring baseline/candidate-confirmed checkpoints and completed teaching observations.
- Produces: background reasoning episodes with source references, elicitation, source group, and immutable source snapshot hash.
- Invariant: visible authoring and teaching replies await no additional analysis call; capture is queued from persisted checkpoints and may be retried independently.

- [ ] **Step 1: Write failing checkpoint-capture tests**

```ts
await captureAuthoringCheckpoint(checkpoint);
expect(submitted.taskGroup).toBe('background');
expect(submitted.prompt).toContain('【可分析的对话证据】');
expect(submitted.prompt).not.toContain('outlineSessionId');
```

- [ ] **Step 2: Implement source-agnostic checkpoint capture**

The module accepts a materialized checkpoint, creates an idempotent background task, validates only source-backed learner reasoning episodes, and persists them through the existing reasoning repository.

- [ ] **Step 3: Wire authoring checkpoint capture after persistence**

基础评估和候选草稿只可进入候选证据治理，绝不进入思维行为统计。仅在用户确认候选且课程原子创建成功后，追溯该 OutlineSession 的已持久化消息并写入 Authoring Episode；不添加可见作者观察器，也不延迟 `advanceConversation` 或确认结果。

- [ ] **Step 4: Run focused tests**

Run: `corepack pnpm test -- apps/server/src/modules/global-user-profile/tests/reasoning-checkpoint-capture.test.ts apps/server/src/bootstrap/local-application.test.ts apps/server/src/modules/course-authoring/tests`

Expected: PASS.

### Task 6: Expose auditable reasoning analysis in the learning portrait

**Files:**
- Modify: `apps/web/src/client/profile-client.ts`
- Modify: `apps/web/src/features/profile/portrait-workspace-model.ts`
- Modify: `apps/web/src/features/profile/portrait-workspace.tsx`
- Modify: `apps/web/src/features/profile/portrait-workspace.css`
- Test: `apps/web/src/features/profile/portrait-workspace-model.test.ts`
- Test: `apps/web/src/features/profile/profile-page.test.tsx`

**Interfaces:**
- Consumes: completed portrait plus optional `reasoningBehaviorAnalysis` containing snapshot, dimensions, counts, limitations, and source episode IDs.
- Produces: a collapsible “思维行为证据” section; no radar chart and no permanent trait language.
- Invariant: UI displays evidence window, independent source-group count, provisional/usable status, limitations, and citations before any dimension summary.

- [ ] **Step 1: Write failing view-model tests**

```ts
expect(buildPortraitWorkspaceModel(portrait).reasoning).toMatchObject({
  status: 'usable',
  dimensions: [expect.objectContaining({ label: '关联式推理', evidenceCount: 3 })],
});
```

- [ ] **Step 2: Implement the auditable projection**

Render each dynamic dimension with description, count, independent-source count, evidence links, and the system limitation text. Hide the entire section when analysis is absent; never synthesize zero-value dimensions.

- [ ] **Step 3: Run web tests**

Run: `corepack pnpm test -- apps/web/src/features/profile/portrait-workspace-model.test.ts apps/web/src/features/profile/profile-page.test.tsx`

Expected: PASS.

### Task 7: Remove superseded implementation and verify the complete control chain

**Files:**
- Modify: `docs/superpowers/plans/2026-07-14-ai-control-chain-master-plan.md`
- Modify: `docs/superpowers/reports/2026-07-14-ai-control-chain-vertical-slices-implementation.md`
- Modify or delete only files proven unreachable by Tasks 1–6 and covered by replacement tests.

**Interfaces:**
- Consumes: replacement response envelope, observation lens, reasoning lineage, background capture, and portrait projection.
- Produces: one source of truth per seam and an acceptance report that names remaining infrastructure-only failures separately.

- [ ] **Step 1: Run static reachability searches before deletion**

Run: `rg -n "COURSE_OUTLINE_CANDIDATE_V3|candidateOutlineOutputExample|dimensionSetVersion|courseMode|playIntent" apps packages tests`

Expected: every remaining reference is either the replacement protocol, a domain persistence field, or an intentional test fixture.

- [ ] **Step 2: Delete only redundant adapters or fixtures**

Do not delete persisted data readers, source evidence, or Markdown rendering. Update imports and tests in the same change.

- [ ] **Step 3: Run verification gates**

Run: `corepack pnpm verify`

Expected: format, lint, type, schema, architecture, equivalence, unit tests, and build all exit `0`.

- [ ] **Step 4: Run browser acceptance after isolated E2E ports are fixed**

Run: `corepack pnpm playwright:test`

Expected: candidate generation, formal teaching, portrait evidence, and restart flows pass without a foreign local service satisfying readiness.
