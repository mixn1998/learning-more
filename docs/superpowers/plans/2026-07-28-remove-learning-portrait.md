# Remove Learning Portrait Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the visible learning portrait and teaching-personalization downstream chain while retaining the global user-profile domain and data.

**Architecture:** Refactor `LocalProfileRuntime` into an upstream-only user-profile runtime, remove portrait routes/schedulers/repositories and personalization projection, then delete all frontend portrait navigation. Finish by purging only downstream local artifacts with verified exact paths.

**Tech Stack:** TypeScript, Fastify, React, Vitest, local JSON storage.

## Global Constraints

- Preserve global-profile facts, evidence candidates, reasoning episodes, analyses and semantic cores.
- Preserve Review, history statistics, calendar and course records.
- Remove all portrait and teaching-personalization outputs, code paths and stored artifacts.
- `portrait-evidence` is retained because it stores upstream user-profile evidence under a legacy path.

---

### Task 1: Remove downstream server runtime and teaching injection

**Files:**
- Modify: `apps/server/src/bootstrap/local-application/profile-runtime.ts`
- Modify: `apps/server/src/bootstrap/local-application/assemble.ts`
- Modify: `apps/server/src/bootstrap/app.ts`
- Modify: `apps/server/src/bootstrap/local-application/course-runtime.ts`
- Modify: `apps/server/src/modules/interactive-teaching/ports/teaching-context-sources.ts`
- Modify: `apps/server/src/modules/interactive-teaching/implementation/context-assembler.ts`
- Modify: `apps/server/src/modules/interactive-teaching/implementation/teaching-fact-context.ts`
- Delete: `apps/server/src/modules/interactive-teaching/implementation/teaching-personalization-prompt.ts`
- Delete: `apps/server/src/http/routes/portraits.ts`
- Delete: `apps/server/src/modules/learning-portrait`
- Delete: `apps/server/src/persistence/portrait-repositories.ts`
- Delete: `apps/server/src/persistence/personalization-digest-repositories.ts`
- Test: related bootstrap, route and teaching tests.

**Interfaces:**
- Consumes: existing upstream profile repositories and checkpoint sinks.
- Produces: upstream-only `LocalProfileRuntime` with no portrait or personalization methods.

- [ ] **Step 1: Change tests to reject portrait registration and personalization prompt content**

```ts
expect(app.printRoutes()).not.toContain('/api/v1/portrait');
expect(teachingPrompt).not.toContain('【可用于个性化的背景】');
expect(localApplication.serverDependencies.portraits).toBeUndefined();
```

- [ ] **Step 2: Run related tests and verify failures**

Run: `node_modules/.bin/vitest related apps/server/src/bootstrap/local-application/profile-runtime.ts apps/server/src/modules/interactive-teaching/implementation/teaching-fact-context.ts --run`

- [ ] **Step 3: Remove portrait/personalization responsibilities and keep upstream profile production**

```ts
export type LocalProfileRuntime = Readonly<{
  checkpointSink: Readonly<{ capture(input: unknown): Promise<void> }>;
  reasoningBehaviorSink: ReturnType<typeof createReasoningBehaviorModule>;
  profileRoutes: ProfileRouteOptions;
  recoverReasoningAnalysis(): Promise<void>;
  getProjectionStatus(): 'ready' | 'degraded';
  close(): Promise<void>;
}>;
```

- [ ] **Step 4: Run focused tests**

Run: `node_modules/.bin/vitest related apps/server/src/bootstrap/local-application/profile-runtime.ts apps/server/src/modules/interactive-teaching/implementation/teaching-fact-context.ts --run`
Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git commit -am "refactor: remove portrait and teaching personalization runtime"`

### Task 2: Remove portrait contracts and frontend

**Files:**
- Modify: `packages/contracts/src/profile.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/course-authoring.ts`
- Modify: generated OpenAPI artifacts through repository scripts.
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/features/history/history-page.tsx`
- Modify: `apps/web/src/features/history/history-section-tabs.tsx`
- Modify: `apps/web/src/features/history/history-calendar-workspace.tsx`
- Modify: `apps/web/src/features/history/history-statistics-workspace.tsx`
- Delete: `apps/web/src/routes/profile-route.tsx`
- Delete: `apps/web/src/client/profile-client.ts`
- Delete: `apps/web/src/features/profile`
- Delete: `apps/web/src/visual/profile-fixture.tsx`
- Test: router, history, course deletion and visual fixture tests.

**Interfaces:**
- Consumes: history statistics and calendar contracts.
- Produces: history UI with only statistics and calendar sections.

- [ ] **Step 1: Update tests to assert portrait UI and route are absent**

```tsx
expect(screen.queryByRole('tab', { name: '学习画像' })).not.toBeInTheDocument();
expect(appRouteDefinitions.some((route) => route.path === 'profile')).toBe(false);
```

- [ ] **Step 2: Run related tests and verify failures**

Run: `node_modules/.bin/vitest related apps/web/src/router.tsx apps/web/src/features/history/history-page.tsx --run`

- [ ] **Step 3: Remove frontend, contracts and portrait refresh response fields**

```ts
export type HistorySection = 'statistics' | 'calendar';
```

- [ ] **Step 4: Run focused tests and contract generation checks**

Run: `corepack pnpm schema:check`
Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git commit -am "refactor: remove learning portrait UI and contracts"`

### Task 3: Purge downstream artifacts and verify retained profile data

**Files:**
- Modify: current product documentation that declares portrait UI or teaching personalization.
- Delete from local data only: `.learning-more-data/portraits`
- Delete from local data only: `.learning-more-data/entities/personalization-digests`
- Delete from local data only: task records whose parsed `data.taskKind` is `learning-portrait`

**Interfaces:**
- Consumes: verified absolute local data paths.
- Produces: no downstream portrait artifacts while upstream profile directories remain untouched.

- [ ] **Step 1: Record pre-purge retained and removed counts**

```powershell
Get-ChildItem '.learning-more-data\portrait-evidence' -Recurse -File | Measure-Object
Get-ChildItem '.learning-more-data\portraits' -Recurse -File | Measure-Object
```

- [ ] **Step 2: Verify every delete target resolves under the repository data root**

Run: `Resolve-Path` on each exact target and compare its prefix with the resolved `.learning-more-data` root.

- [ ] **Step 3: Delete only downstream artifacts**

Use native PowerShell `Remove-Item -LiteralPath` for verified exact paths. Parse task JSON in PowerShell and remove only matching task files.

- [ ] **Step 4: Verify upstream profile evidence and global-profile files still exist**

Run: `Get-ChildItem '.learning-more-data\portrait-evidence','.learning-more-data\global-profile' -Recurse -File | Measure-Object`
Expected: retained counts remain non-zero.

- [ ] **Step 5: Run full change-aware verification and commit**

Run: `corepack pnpm verify`
Expected: PASS.

Run: `git commit -am "chore: remove learning portrait artifacts"`
