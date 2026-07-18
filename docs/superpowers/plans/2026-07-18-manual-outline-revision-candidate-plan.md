# Manual Outline Revision Candidate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make formal-course outline conversations reply-only and require explicit user actions to generate, cancel, and publish a revised outline candidate.

**Architecture:** Keep the existing immutable candidate/version pipeline and publish transaction. Split adjustment conversation from candidate generation at the course-authoring facade, prepare patch/regenerate scope only inside the explicit generation command, and replace the revision page's single busy flag with explicit UI phases. Reuse the new-course generation overlay on the revision candidate panel.

**Tech Stack:** TypeScript, React, Fastify application facade, Vitest, Testing Library, pnpm workspace.

## Global Constraints

- Sending a revision conversation message must never generate or replace a candidate.
- Only the explicit “生成新候选” action may start candidate generation.
- Explicit generation scope may be `patch` or `regenerate`; `clarify` must not block a user-authorized generation.
- The generation overlay must retain “取消生成”.
- “确认并发布 vN” moves below the left composer; the right candidate panel has no publish footer.
- A candidate remains publishable after later conversation, with a visible warning that it does not include the latest conversation.
- New-course authoring and formal outline publish/version/lesson/schedule behavior must not change.

---

### Task 1: Separate adjustment conversation from generation authorization

**Files:**
- Modify: `apps/server/src/modules/course-authoring/implementation/course-authoring-facade.ts`
- Modify: `apps/server/src/modules/course-authoring/model/commands.ts`
- Modify: `apps/server/src/modules/course-authoring/model/events.ts`
- Modify: `apps/server/src/modules/course-authoring/model/outline-session.ts`
- Test: `apps/server/src/modules/course-authoring/tests/outline-session.test.ts`
- Test: `apps/server/src/modules/course-authoring/tests/course-authoring-facade.test.ts`

**Interfaces:**
- Consumes: `CandidateAlignmentPlanner.plan(context)` and existing `candidateGeneration.generate(...)`.
- Produces: a domain command/event that stores an explicit `patch | regenerate` generation plan while the session remains `candidate-ready`; adjustment message append returns after the assistant reply without starting generation.

- [ ] **Step 1: Add failing facade tests**

```ts
it('keeps an adjustment conversation reply-only until generation is explicitly requested', async () => {
  await module.execute({ type: 'AppendOutlineSessionMessage', outlineSessionId, content: '缩短第二模块' }, context);
  expect(candidateAlignmentPlanner.plan).not.toHaveBeenCalled();
  expect(candidateGeneration.generate).not.toHaveBeenCalled();
});

it('plans and starts an adjustment candidate only after explicit generation', async () => {
  await module.execute({ type: 'RequestCandidateGeneration', outlineSessionId }, context);
  expect(candidateAlignmentPlanner.plan).toHaveBeenCalledTimes(1);
  expect(candidateGeneration.generate).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `pnpm --filter @learning-more/server test -- course-authoring-facade.test.ts outline-session.test.ts`

Expected: FAIL because adjustment append currently invokes the planner and generation automatically, and explicit generation does not prepare adjustment scope.

- [ ] **Step 3: Add an explicit generation-plan transition**

```ts
type OutlineSessionCommand =
  | Readonly<{
      type: 'planCandidateGeneration';
      action: 'patch' | 'regenerate';
      targetModuleIds: readonly string[];
    }>;

type OutlineSessionEvent =
  | Readonly<{
      type: 'CandidateGenerationPlanned';
      action: 'patch' | 'regenerate';
      targetModuleIds: readonly string[];
    }>;
```

`decide` accepts this command only from `candidate-ready`; `evolve` stores it as `pendingAlignment` without starting a task.

- [ ] **Step 4: Make adjustment append reply-only**

Replace the adjustment branch's `Promise.all([planner.plan, authoringAgent.respond])` and automatic `candidateGeneration.generate` call with one assistant response, persisted through the existing alignment-turn completion using `clarify` solely as the no-generation domain transition. The HTTP response remains `candidate-ready`.

- [ ] **Step 5: Plan scope inside explicit generation**

In `RequestCandidateGeneration`, when `record.session.adjustmentCourseId` exists:

```ts
const context = await assembleAuthoringContext(record.session.outlineSessionId);
const planned = await options.candidateAlignmentPlanner.plan(context);
const plan = planned.action === 'clarify'
  ? { action: 'patch' as const, targetModuleIds: ['outline:root'] }
  : { action: planned.action, targetModuleIds: planned.targetModuleIds };
```

Persist `pendingAlignment` and attach the plan metadata to the latest assistant adjustment message before calling `candidateGeneration.generate`. Keep the non-adjustment branch unchanged.

- [ ] **Step 6: Run focused tests**

Run: `pnpm --filter @learning-more/server test -- course-authoring-facade.test.ts outline-session.test.ts`

Expected: PASS.

---

### Task 2: Extract and reuse the candidate generation overlay

**Files:**
- Create: `apps/web/src/features/course-authoring/candidate-generation-pending.tsx`
- Modify: `apps/web/src/features/course-authoring/outline-workspace-view.tsx`
- Modify: `apps/web/src/features/course-authoring/outline-workspace-view.css`
- Modify: `apps/web/src/features/course/outline-revision-workspace.tsx`
- Modify: `apps/web/src/features/course/outline-revision-workspace.css`

**Interfaces:**
- Produces: `CandidateGenerationPending({ cancelBusy, onCancel })` shared by new-course and revision workspaces.
- Consumes: existing `Button` and `ow-candidate-pending*` CSS classes.

- [ ] **Step 1: Extract the existing overlay without changing new-course behavior**

```tsx
export function CandidateGenerationPending(props: {
  readonly cancelBusy?: boolean;
  readonly onCancel: () => void;
}) {
  return (
    <div aria-label="候选大纲生成状态" className="ow-candidate-pending" role="status">
      {/* existing indicator and copy */}
      <Button busy={props.cancelBusy === true} onClick={props.onCancel}>
        {props.cancelBusy ? '正在取消…' : '取消生成'}
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Render the shared overlay in the revision outline panel**

Add revision workspace props for `phase`, `generationCancelBusy`, and `onCancelGeneration`. During `generating`, retain the current formal outline or previous candidate and render `CandidateGenerationPending` above it.

- [ ] **Step 3: Move generation and publish controls below the left composer**

Add `onGenerate`, `onPublish`, and disabled/busy state props. Render “生成新候选” and “确认并发布 vN” beneath `ChatComposer`; remove the right `ow-footer`. Keep the publish confirmation dialog.

- [ ] **Step 4: Add unapplied conversation warning**

When messages were added after the visible candidate generation checkpoint, show “当前候选未包含生成后的最新对话” beside the left controls without disabling publish.

---

### Task 3: Implement explicit revision phases and manual generation controls

**Files:**
- Modify: `apps/web/src/features/review/course-page.tsx`
- Modify: `apps/web/src/client/course-authoring-client.ts` only if existing client type exports need adjustment
- Test: `apps/web/src/features/review/course-page.test.tsx`

**Interfaces:**
- Consumes: `requestCandidateGeneration`, `cancelCandidateGeneration`, `getOutlineSession`, and existing revision publish methods.
- Produces: `RevisionPhase = 'opening' | 'ready' | 'thinking' | 'generating' | 'candidate-ready' | 'failed'` and authoritative session refresh after generation/cancellation.

- [ ] **Step 1: Add failing UI workflow tests**

```ts
it('does not generate a candidate when a revision message receives an AI reply', async () => {
  fireEvent.click(screen.getByRole('button', { name: '发送调整要求' }));
  await screen.findByText('已记录这项调整想法。');
  expect(requestCandidateGeneration).not.toHaveBeenCalled();
});

it('generates and cancels only from the explicit candidate controls', async () => {
  fireEvent.click(screen.getByRole('button', { name: '生成新候选' }));
  expect(requestCandidateGeneration).toHaveBeenCalledTimes(1);
  expect(await screen.findByRole('status', { name: '候选大纲生成状态' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '取消生成' }));
  expect(cancelCandidateGeneration).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the focused web test and verify failure**

Run: `pnpm --filter @learning-more/web test -- course-page.test.tsx`

Expected: FAIL because message append currently waits for and displays an automatically generated candidate and the controls are in the right footer.

- [ ] **Step 3: Replace `revisionBusy` with explicit phases**

```ts
type RevisionPhase =
  | 'opening'
  | 'ready'
  | 'thinking'
  | 'generating'
  | 'candidate-ready'
  | 'failed';
```

Opening a `candidate-ready` session maps to `candidate-ready` only when it has a candidate different from the current formal source; otherwise it maps to `ready`. Restored `alignment-turn-running` maps to `thinking`; restored `generating-candidates` maps to `generating`.

- [ ] **Step 4: Make send refresh only the reply**

Optimistically append the user message, set `thinking`, await `appendMessage`, immediately fetch the authoritative session, update the conversation, and return to `ready` or `candidate-ready` without polling candidate changes.

- [ ] **Step 5: Add explicit generate and cancellation handlers**

`generateRevisionCandidate` calls `requestCandidateGeneration`, updates the authoritative session resource version, sets `generating`, and polls/reconnects until the candidate changes or reaches a terminal failure. `cancelRevisionGeneration` calls `cancelCandidateGeneration`, reloads the session, and restores `ready` or `candidate-ready`.

- [ ] **Step 6: Preserve publish behavior from the left control**

Pass the current candidate ID to the existing `publishRevision`. Keep optimistic course version conflict handling and post-publish course reload unchanged.

- [ ] **Step 7: Run focused web tests**

Run: `pnpm --filter @learning-more/web test -- course-page.test.tsx`

Expected: PASS.

---

### Task 4: Regression, commit, activation, and runtime verification

**Files:**
- Test: all files changed in Tasks 1-3
- Verify: workspace scripts and active local runtime metadata

**Interfaces:**
- Consumes: project test/build/activation scripts discovered from the current root `package.json` and runtime scripts.
- Produces: committed master revision and a ready active runtime reporting that revision/build.

- [ ] **Step 1: Run formatting and static checks for changed packages**

Run the repository-provided lint/typecheck commands for server and web. Expected: exit 0.

- [ ] **Step 2: Run focused regression suites**

Run the server course-authoring tests, web course-page tests, and new-course authoring tests. Expected: exit 0 with no failed tests.

- [ ] **Step 3: Run the repository build gate**

Run the current workspace build command. Expected: exit 0 and generated artifacts updated without source drift.

- [ ] **Step 4: Review the final diff**

Run: `git diff --check` and `git status --short`.

Expected: no whitespace errors; only intended implementation, tests, and plan files are changed.

- [ ] **Step 5: Commit the implementation**

```bash
git add <intended files>
git commit -m "feat: make outline revision generation explicit"
```

- [ ] **Step 6: Activate the committed build**

Use the repository's current activation command, then verify launcher health, provider readiness, projection/store readiness, and active revision/build metadata.

- [ ] **Step 7: Complete the goal only after the audit proves every acceptance condition**

Check the nine design acceptance conditions against tests, source, committed state, and active runtime evidence.
