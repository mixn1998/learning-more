# Planning Date and Plan Flow Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make course planning start without a selected day, save dates from an inline native calendar, and recover plan-flow preview generation from one retryable backend failure.

**Architecture:** Keep date filtering and row-level scheduling inside `PlanningWorkspaceView`, with the existing `PlanningPage` callbacks remaining the authoritative mutation boundary. Add a single retry at the `PlanningPage` plan-preview boundary only when the server returns a structured retryable problem. Repair the E2E launcher so browser and server use one isolated port/build identity, allowing the real plan-flow chain to be tested.

**Tech Stack:** React 19, TypeScript 5.9, Vitest, Testing Library, Playwright, Fastify.

## Global Constraints

- Initial planning selection is empty and displays all candidate lessons.
- Date selection uses native `<input type="date">` and saves immediately.
- A successful row-level save does not change the active date filter.
- Only retry structured problems whose `retryable` field is `true`, at most once automatically.
- Preview retries never confirm or modify the formal schedule.
- Preserve unrelated dirty-worktree changes.

---

### Task 1: Isolate the real E2E runtime

**Files:**
- Modify: `tests/e2e/global-setup.ts`
- Modify: `tests/e2e/start-course-authoring-server.ts`
- Modify: `tests/e2e/planning-history.spec.ts`
- Modify: `tests/e2e/learning-review-closure.spec.ts`
- Modify: `apps/web/vite.config.ts`
- Modify: `playwright.config.ts`
- Test: `tests/e2e/e2e-environment.spec.ts`

**Interfaces:**
- Consumes: `resolveE2eEnvironment(): { serverPort; webPort; buildId; serverBaseUrl; webBaseUrl }`
- Produces: one browser/server pair using the same `buildId` and isolated ports.

- [ ] **Step 1: Run the existing isolation test and retain the red result**

Run:

```powershell
node .\node_modules\@playwright\test\cli.js test tests/e2e/e2e-environment.spec.ts --reporter=line
```

Expected before the fix: `ECONNREFUSED 127.0.0.1:43129` or a build mismatch.

- [ ] **Step 2: Route all E2E startup values through `resolveE2eEnvironment`**

Use the resolved ports and build ID in global setup, Vite, Playwright, restart helpers, and the test server. The server must be started with:

```ts
const environment = resolveE2eEnvironment();
const local = await createLocalApplication({
  dataRoot,
  csrfToken: 'development-csrf',
  allowedOrigin: environment.webBaseUrl,
  mockFailOnce: true,
  runtimeIdentity: {
    instanceId: 'instance_e2e',
    generation: 1,
    startedAt: new Date().toISOString(),
    identityFingerprint: 'e2e-runtime',
    buildId: environment.buildId,
    protocolVersion: '1',
  },
});
await startServer(local.serverDependencies, environment.serverPort);
```

Vite must read `LEARNING_MORE_E2E_WEB_PORT` and `LEARNING_MORE_E2E_SERVER_PORT`, and Playwright `baseURL` must use `environment.webBaseUrl`.

- [ ] **Step 3: Run the isolation test**

Run the command from Step 1.

Expected: one test passes and the course topic input is enabled.

### Task 2: Replace modal scheduling with inline native dates

**Files:**
- Modify: `apps/web/src/features/planning/planning-workspace-view.tsx`
- Modify: `apps/web/src/features/planning/planning-date-filter.tsx`
- Modify: `apps/web/src/features/planning/planning-workspace.css`
- Modify: `apps/web/src/features/planning/planning.test.tsx`
- Create: `apps/web/src/features/planning/planning-workspace-view.test.tsx`
- Modify: `tests/e2e/planning-history.spec.ts`

**Interfaces:**
- Consumes: existing `onCreate(input): Promise<void>` and `onMove(item, draft): Promise<void>` callbacks.
- Produces: row-level `<input aria-label="安排学习日期：{lesson title}" type="date">` with immediate persistence.

- [ ] **Step 1: Add failing component tests**

Cover these assertions:

```ts
expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(0);
expect(screen.getByText('未排期课节')).toBeVisible();
expect(screen.getByText('今日课节')).toBeVisible();
fireEvent.change(screen.getByLabelText('安排学习日期：未排期课节'), {
  target: { value: '2026-07-16' },
});
await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
expect(screen.queryByRole('dialog', { name: /学习日期/u })).not.toBeInTheDocument();
```

Add a rejected `onMove` case asserting the original value is restored and the row contains `排期版本已变化或日期未保存，请重试。`.

- [ ] **Step 2: Run the focused tests and confirm they fail**

```powershell
node .\node_modules\vitest\vitest.mjs run apps/web/src/features/planning/planning.test.tsx apps/web/src/features/planning/planning-workspace-view.test.tsx
```

Expected: failures show today is initially pressed and no row-level date input exists.

- [ ] **Step 3: Implement empty initial selection and row-level async state**

Use:

```ts
const [selectedDate, setSelectedDate] = useState('');
const [pendingDates, setPendingDates] = useState<Readonly<Record<string, string>>>({});
const [savingLessonIds, setSavingLessonIds] = useState<ReadonlySet<string>>(new Set());
const [scheduleErrors, setScheduleErrors] = useState<Readonly<Record<string, string>>>({});
```

Replace the schedule dialog with a controlled date input. On change, set the pending date, call `onCreate` or `onMove`, and clear pending state on success or failure. Do not call `setSelectedDate` after saving.

Update `PlanningDateFilter` so `selection` starts as `''` and its visible list returns all candidates when selection is empty.

- [ ] **Step 4: Update the E2E manual scheduling step**

Replace modal interactions with:

```ts
await manualLesson.getByLabel('安排学习日期：Planning lesson 1').fill('2026-07-16');
await expect(manualLesson.getByLabel('安排学习日期：Planning lesson 1')).toHaveValue(
  '2026-07-16',
);
```

- [ ] **Step 5: Run focused tests**

Run the command from Step 2.

Expected: all focused tests pass.

### Task 3: Recover one retryable plan-preview failure

**Files:**
- Modify: `apps/web/src/features/planning/planning-page.tsx`
- Modify: `apps/web/src/features/planning/planning-page.test.tsx`
- Test: `tests/e2e/planning-history.spec.ts`

**Interfaces:**
- Consumes: structured `ApplicationProblem` values thrown by `planningClient.requestPreview`.
- Produces: `requestPreviewWithRetry`, which retries once with a fresh command attempt only when `retryable === true`.

- [ ] **Step 1: Add a failing retry regression test**

Mock the first call with:

```ts
const retryableProblem = {
  type: 'https://learning-more.local/problems/ai-unavailable',
  status: 409,
  code: 'ai_unavailable',
  messageKey: 'errors.aiUnavailable',
  retryable: true,
  correlationId: 'correlation_01',
};
requestPreview.mockRejectedValueOnce(retryableProblem).mockResolvedValueOnce(previewReady);
```

Drive the four-step wizard, assert `requestPreview` is called twice, assert the two command attempts have different idempotency keys, and assert “确认计划流” becomes visible.

- [ ] **Step 2: Run the regression test and confirm it fails**

```powershell
node .\node_modules\vitest\vitest.mjs run apps/web/src/features/planning/planning-page.test.tsx
```

Expected: only one request is made and the generic failure note is shown.

- [ ] **Step 3: Implement one bounded retry**

Parse caught values with `ApplicationProblemSchema.safeParse`. If the first failure is structured and retryable, call `commands.complete(key)`, obtain a new attempt, and retry once. Complete the registry key after success or a structured terminal second response; keep the same attempt only for ambiguous network failures.

- [ ] **Step 4: Run unit and real E2E checks**

```powershell
node .\node_modules\vitest\vitest.mjs run apps/web/src/features/planning
node .\node_modules\@playwright\test\cli.js test tests/e2e/planning-history.spec.ts --grep 'EQ-SCH-02' --reporter=line
```

Expected: planning unit tests pass; E2E reaches `preview-ready`, confirms the plan flow, and shows the planned lesson.

### Task 4: Final verification

**Files:**
- Verify only; no expected production changes.

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: validated planning UI and plan-flow workflow.

- [ ] **Step 1: Run formatting, lint, type and build checks for touched scope**

```powershell
node .\node_modules\prettier\bin\prettier.cjs --check apps/web/src/features/planning tests/e2e apps/web/vite.config.ts playwright.config.ts
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
```

- [ ] **Step 2: Re-run the original plan-flow chain**

Run Task 3 Step 4 a second time.

Expected: deterministic green result with no build mismatch, modal date dialog, or transient preview dead-end.
