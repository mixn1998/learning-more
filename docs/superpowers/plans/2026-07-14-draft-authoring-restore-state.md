# Draft Authoring Restore State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Execute this plan task-by-task in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore an existing outline-authoring session without ever exposing the new-course form while restoration is pending or failed.

**Architecture:** Keep the existing `/courses/new?outlineSessionId=...` route. Add an independent restore-status state to `AuthoringPage`; the existing authoring reducer remains responsible only for loaded authoring data and workflow phases.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library

## Global Constraints

- Do not redesign or modify the existing new-course form.
- Do not create a replacement `OutlineSession` when restoration fails.
- A route without `initialOutlineSessionId` must preserve the existing new-course behavior.
- A route with `initialOutlineSessionId` must show only loading, loaded workspace, or restore failure.

---

### Task 1: Lock the restore states with component tests

**Files:**
- Modify: `apps/web/src/features/course-authoring/authoring-page.test.tsx`

**Interfaces:**
- Consumes: `AuthoringPage({ client, initialOutlineSessionId, onNavigate })`
- Produces: regression coverage for pending and rejected `getOutlineSession` requests

- [ ] **Step 1: Add a pending-restoration test**

Create a deferred `getOutlineSession` promise, render with `initialOutlineSessionId="session_01"`, then assert:

```tsx
expect(screen.getByText('正在恢复大纲建档…')).toBeInTheDocument();
expect(screen.queryByRole('heading', { name: '创建课程' })).not.toBeInTheDocument();
expect(screen.queryByLabelText('学习主题')).not.toBeInTheDocument();
expect(screen.queryByRole('group', { name: '课程模式' })).not.toBeInTheDocument();
```

- [ ] **Step 2: Add a failed-restoration test**

Reject `getOutlineSession`, wait for `无法恢复大纲建档`, click `返回主页`, and assert:

```tsx
expect(screen.queryByRole('heading', { name: '创建课程' })).not.toBeInTheDocument();
expect(api.createOutlineSession).not.toHaveBeenCalled();
expect(navigate).toHaveBeenCalledWith('/');
```

- [ ] **Step 3: Run the focused tests and verify they fail**

Run:

```powershell
& '.\node_modules\.bin\vitest.CMD' run apps/web/src/features/course-authoring/authoring-page.test.tsx
```

Expected: the pending test finds the existing `创建课程` form, and the failure test cannot find a restore-specific error state.

### Task 2: Implement the isolated restore-status state

**Files:**
- Modify: `apps/web/src/features/course-authoring/authoring-page.tsx`
- Test: `apps/web/src/features/course-authoring/authoring-page.test.tsx`

**Interfaces:**
- Consumes: optional `initialOutlineSessionId` and `CourseAuthoringClient.getOutlineSession`
- Produces: `RestoreStatus = 'idle' | 'loading' | 'failed'`

- [ ] **Step 1: Add restore status initialized from the route input**

```tsx
type RestoreStatus = 'idle' | 'loading' | 'failed';

const [restoreStatus, setRestoreStatus] = useState<RestoreStatus>(() =>
  props.initialOutlineSessionId === undefined ? 'idle' : 'loading',
);
```

- [ ] **Step 2: Make the restoration effect explicit and failure-aware**

Replace the fire-and-forget effect with a cancellable effect that sets `loading`, awaits `loadSession`, sets `idle` on success, and sets `failed` on rejection. It must not call `createOutlineSession`.

```tsx
useEffect(() => {
  const outlineSessionId = props.initialOutlineSessionId;
  if (outlineSessionId === undefined) {
    setRestoreStatus('idle');
    return;
  }
  let current = true;
  setRestoreStatus('loading');
  void loadSession(outlineSessionId).then(
    () => current && setRestoreStatus('idle'),
    () => current && setRestoreStatus('failed'),
  );
  return () => {
    current = false;
  };
}, [props.initialOutlineSessionId]);
```

- [ ] **Step 3: Render restore states before the existing empty-state branch**

```tsx
if (restoreStatus === 'loading') {
  return (
    <Page className="authoring-workspace course-authoring-page">
      <ContentState title="正在恢复大纲建档…" />
    </Page>
  );
}

if (restoreStatus === 'failed') {
  return (
    <Page className="authoring-workspace course-authoring-page">
      <ContentState
        action={<Button type="button" onClick={() => props.onNavigate?.('/')}>返回主页</Button>}
        description="原有大纲建档会话未能加载，请返回主页后重试。"
        role="alert"
        title="无法恢复大纲建档"
      />
    </Page>
  );
}
```

- [ ] **Step 4: Run the focused tests and verify they pass**

Run:

```powershell
& '.\node_modules\.bin\vitest.CMD' run apps/web/src/features/course-authoring/authoring-page.test.tsx
```

Expected: all authoring-page tests pass.

### Task 3: Lock the home-card navigation and run regression checks

**Files:**
- Modify: `apps/web/src/features/home/home-page.test.tsx`
- Test: `apps/web/src/features/home/home-page.test.tsx`

**Interfaces:**
- Consumes: the existing unconfirmed-outline card click handler
- Produces: regression assertion for `/courses/new?outlineSessionId=<encoded-id>`

- [ ] **Step 1: Extend the course-card test**

Click the draft card and assert:

```tsx
fireEvent.click(draftCard);
expect(navigate).toHaveBeenCalledWith('/courses/new?outlineSessionId=draft_01');
```

- [ ] **Step 2: Run focused and adjacent tests**

Run:

```powershell
& '.\node_modules\.bin\vitest.CMD' run apps/web/src/features/course-authoring/authoring-page.test.tsx apps/web/src/features/home/home-page.test.tsx apps/web/src/router.test.tsx
```

Expected: all selected tests pass.

- [ ] **Step 3: Run formatting, lint, and diff checks**

Run Prettier and ESLint on the three changed TypeScript files, followed by `git diff --check`. Expected: zero warnings and zero errors.

