# Review Core Insight Semantic Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `coreInsight` preserve whatever summary structure is necessary for understanding while removing only meta/process language and genuine semantic duplication.

**Architecture:** Keep the existing Review document contract and evidence flow. Change the shared generation instruction in the production writer and historical reprocessor, then reproject historical Reviews with the same semantic policy.

**Tech Stack:** TypeScript, Zod, Vitest, Node.js migration tooling.

## Global Constraints

- Do not introduce a fixed summary template.
- Do not force `coreInsight` into one sentence or minimum length.
- Preserve necessary paragraphs, lists, semantic hierarchy, reasoning links, and boundary conditions.
- Preserve meaningful Markdown formatting such as emphasis, paragraphs, nested numbering, lists, blockquotes, code, and formulas.
- Do not truncate or restructure `coreInsight` again in the web presentation layer.
- Keep `methodologyInsight` as the separately condensed one-sentence projection.
- Do not mutate original classroom messages or evidence.

---

### Task 1: Update the production Review generation policy

**Files:**
- Modify: `apps/server/src/modules/review-closure/implementation/generation-review-writer.ts`
- Test: `apps/server/src/modules/review-closure/tests/generation-review-writer.test.ts`

**Interfaces:**
- Consumes: frozen Review evidence and classroom summary sources.
- Produces: the existing `ReviewDocument` shape without schema changes.

- [x] **Step 1: Update the prompt assertion**

Require the prompt to contain:

```ts
expect(request?.prompt).toContain('动态保留完成理解所必需的总结结构');
expect(request?.prompt).toContain('不得套用固定框架');
expect(request?.prompt).not.toContain('只保留能改变理解或行动的最小充分表达');
```

- [x] **Step 2: Run the focused test and observe failure**

Run:

```powershell
corepack pnpm vitest run apps/server/src/modules/review-closure/tests/generation-review-writer.test.ts
```

Expected: the new prompt assertions fail.

- [x] **Step 3: Replace the over-compression instruction**

In `generation-review-writer.ts`, replace the minimum-expression policy with a rule that:

```text
先识别并动态保留完成理解所必需的总结结构；结构可按课程内容表现为概念关系、因果链、判断框架、操作步骤、条件对比、推理过程、适用边界或其他必要形式。允许保留必要段落、列表与层次，不得套用固定框架，也不得为了简短而删除互相支撑的关键关系、推理环节或边界条件。
```

Keep the existing rule that removes evaluation, encouragement, interaction recap, transition language, and course workflow statements. Merge only genuinely synonymous repetition.

- [x] **Step 4: Run the focused test**

Run the command from Step 2.

Expected: PASS.

### Task 2: Keep historical reprocessing aligned

**Files:**
- Modify: `tools/reproject-review-classroom-sources.mjs`

**Interfaces:**
- Consumes: exported Review source snapshots.
- Produces: reprojected `coreInsight` and optional `methodologyInsight`.

- [x] **Step 1: Apply the identical semantic-fidelity instruction**

Replace the historical tool's minimum-expression sentence with the same dynamic-structure rule used by the production writer.

- [x] **Step 2: Validate the tool syntax**

Run:

```powershell
node --check tools/reproject-review-classroom-sources.mjs
```

Expected: no output and exit code 0.

### Task 3: Reprocess and verify historical Reviews

**Files:**
- Update runtime projection data through `tools/reproject-review-classroom-sources.mjs`.

**Interfaces:**
- Consumes: the existing 26 eligible Review source records.
- Produces: aligned historical Review projections while leaving source evidence unchanged.

- [x] **Step 1: Regenerate semantic cache through the configured provider**

Run the tool's export/generation path using the same production policy.

- [x] **Step 2: Apply the regenerated cache**

Run:

```powershell
node tools/reproject-review-classroom-sources.mjs --apply --cache-file=.learning-more-runtime/review-semantic-distillation-v3.json
```

Expected: all eligible records are projected with no unresolved IDs.

- [x] **Step 3: Verify historical projections**

Run:

```powershell
node tools/reproject-review-classroom-sources.mjs --verify --cache-file=.learning-more-runtime/review-semantic-distillation-v3.json
```

Expected: all eligible records match and `mismatches` is empty.

### Task 4: Validate and activate

**Files:**
- No additional source files.

**Interfaces:**
- Consumes: updated workspace source.
- Produces: healthy active runtime build.

- [x] **Step 1: Run focused tests and typecheck**

Run:

```powershell
corepack pnpm vitest run apps/server/src/modules/review-closure/tests/generation-review-writer.test.ts
corepack pnpm --filter @learning-more/server typecheck
```

Expected: PASS.

- [x] **Step 2: Wait for workspace activation**

Verify `workspace-activation-status.json` reaches `activated`.

- [x] **Step 3: Verify runtime health**

Call the manifest health URL and require:

```json
{
  "status": "ready",
  "storeStatus": "ready",
  "projectionStatus": "ready",
  "providerStatus": "ready"
}
```
