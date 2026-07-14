# AI Response Immediate Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every in-scope user-triggered AI action visible immediately, then reconcile temporary UI state with the server-authoritative result.

**Architecture:** Keep existing backend commands and persistence unchanged. Add a UI-only `AuthoringStartIntent` handoff and local pending-turn View Models at the React page seams; canonical server snapshots replace temporary messages after success. Candidate and formal-session generation reuse their current streams, but enter busy/thinking state before task acceptance.

**Tech Stack:** React 19, React Router 7, TypeScript, Vitest, Testing Library, existing Learning MORE UI package.

## Global Constraints

- Temporary user messages, opening guidance, and “正在思考中……” never enter shared domain contracts, Repository storage, statistics, global learning profile, or portrait evidence.
- The homepage topic must not appear in the URL.
- Duplicate commands remain prevented independently of button disabled state.
- Existing server snapshots remain authoritative and replace temporary messages without duplication.
- Existing candidate failure distinctions and formal-session stop/recovery behavior remain intact.
- All changes are made on `master`; pre-existing uncommitted work is preserved and not reverted.

---

### Task 1: Immediate homepage-to-authoring handoff

**Files:**
- Create: `apps/web/src/state/authoring-start-intent.ts`
- Modify: `apps/web/src/features/home/home-page.tsx`
- Modify: `apps/web/src/features/home/home-page.test.tsx`
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/routes/course-authoring-route.tsx`
- Test: `apps/web/src/features/home/home-page.test.tsx`

**Interfaces:**
- Produces: `AuthoringStartIntent` with `topic`, `courseMode`, and optional `materialFile`.
- Produces: `HomePage.onStartAuthoring(intent)`; this callback must be invoked synchronously after validation.
- Consumes: React Router location state `{ authoringStartIntent }`.

- [x] **Step 1: Write the failing homepage test**

```tsx
it('hands off the start intent immediately without waiting for session creation', () => {
  const createOutlineSession = vi.fn(() => new Promise(() => undefined));
  const onStartAuthoring = vi.fn();
  render(<HomePage client={client(createOutlineSession)} onNavigate={vi.fn()} onStartAuthoring={onStartAuthoring} />);
  fireEvent.change(screen.getByLabelText('学习主题'), { target: { value: '证据推理' } });
  fireEvent.click(screen.getByRole('button', { name: /开始/ }));
  expect(onStartAuthoring).toHaveBeenCalledWith(
    expect.objectContaining({ topic: '证据推理', courseMode: 'standard' }),
  );
  expect(createOutlineSession).not.toHaveBeenCalled();
});
```

- [x] **Step 2: Run the test and verify RED**

Run: `corepack pnpm exec vitest run apps/web/src/features/home/home-page.test.tsx`  
Expected: FAIL because `onStartAuthoring` does not exist and HomePage waits on `createOutlineSession`.

- [x] **Step 3: Add the handoff Interface and minimal implementation**

```ts
export type AuthoringStartIntent = Readonly<{
  topic: string;
  courseMode: CourseMode;
  materialFile?: File;
}>;
```

HomePage validates required input, then calls `onStartAuthoring` synchronously. `HomeRoute` navigates to `/courses/new` with location state. `CourseAuthoringRoute` reads the state and passes it to `AuthoringPage`; after session creation it replaces the route with `?outlineSessionId=...` and clears location state.

- [x] **Step 4: Run homepage and router tests and verify GREEN**

Run: `corepack pnpm exec vitest run apps/web/src/features/home/home-page.test.tsx apps/web/src/router.test.tsx`  
Expected: PASS.

### Task 2: Authoring start and conversation optimistic state

**Files:**
- Modify: `apps/web/src/features/course-authoring/authoring-page.tsx`
- Modify: `apps/web/src/features/course-authoring/outline-workspace-view.tsx`
- Modify: `apps/web/src/features/course-authoring/outline-workspace-view.css`
- Modify: `apps/web/src/features/course-authoring/authoring-workspace-model.ts`
- Test: `apps/web/src/features/course-authoring/authoring-page.test.tsx`

**Interfaces:**
- Consumes: `AuthoringPage.initialStartIntent?: AuthoringStartIntent`.
- Produces: authoring View Model fields `assistantPending` and local message status `submitting | complete | failed`.
- Reconciles: `session-loaded` replaces local messages with the server snapshot and clears pending state.

- [x] **Step 1: Write failing tests for immediate first paint and subsequent send**

```tsx
it('shows opening guidance, the homepage message, and thinking while creation is pending', () => {
  render(<AuthoringPage client={client({ createOutlineSession: vi.fn(() => new Promise(() => undefined)) })}
    initialStartIntent={{ topic: '概率论', courseMode: 'standard' }} />);
  expect(screen.getByText('概率论')).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent('正在思考中');
});

it('shows a submitted assessment immediately and reconciles after the server reply', async () => {
  let resolveAppend!: (value: {
    outlineSessionId: string;
    state: string;
    resourceVersion: number;
  }) => void;
  const appendMessage = vi.fn(
    () =>
      new Promise<{
        outlineSessionId: string;
        state: string;
        resourceVersion: number;
      }>((resolve) => {
        resolveAppend = resolve;
      }),
  );
  const getOutlineSession = vi
    .fn()
    .mockResolvedValueOnce({
      outlineSessionId: 'session_01',
      resourceVersion: 2,
      state: 'assessing',
      topic: '概率论',
      courseMode: 'standard',
      messages: [],
    })
    .mockResolvedValueOnce({
      outlineSessionId: 'session_01',
      resourceVersion: 4,
      state: 'assessing',
      topic: '概率论',
      courseMode: 'standard',
      messages: [
        {
          messageId: 'user_02',
          role: 'user',
          content: '用于风险判断',
          status: 'complete',
          createdAt: '2026-07-14T00:00:02.000Z',
        },
        {
          messageId: 'assistant_02',
          role: 'assistant',
          content: '你希望先处理哪类风险？',
          status: 'complete',
          createdAt: '2026-07-14T00:00:03.000Z',
        },
      ],
    });
  render(
    <AuthoringPage
      client={client({ appendMessage, getOutlineSession })}
      initialOutlineSessionId="session_01"
    />,
  );
  const input = await screen.findByLabelText('补充需求');
  fireEvent.change(input, { target: { value: '用于风险判断' } });
  fireEvent.click(screen.getByRole('button', { name: '完成评估' }));
  expect(screen.getByText('用于风险判断')).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent('正在思考中');
  resolveAppend({ outlineSessionId: 'session_01', state: 'assessing', resourceVersion: 4 });
  expect(await screen.findByText('你希望先处理哪类风险？')).toBeVisible();
});
```

- [x] **Step 2: Run the authoring test and verify RED**

Run: `corepack pnpm exec vitest run apps/web/src/features/course-authoring/authoring-page.test.tsx`  
Expected: FAIL because creation renders the old form and messages appear only after the request.

- [x] **Step 3: Implement local pending messages and reconciliation**

Reducer actions:

```ts
type OptimisticAuthoringAction =
  | { type: 'creating'; content: string; messageId: string; createdAt: string }
  | { type: 'assessment-submitted'; content: string; messageId: string; createdAt: string }
  | { type: 'turn-failed'; content: string; versionConflict: boolean };
```

`creating` and `assessment-submitted` append a local user message, clear the composer where applicable, and set `assistantPending=true`. `session-loaded` replaces messages and clears pending state. Failure marks the local message failed, removes thinking, and restores the input.

- [x] **Step 4: Render opening guidance and one thinking placeholder**

`OutlineWorkspaceView` renders stable opening guidance before messages and one `role="status"` thinking item after the latest local/server message. It never places the placeholder inside Markdown content.

- [x] **Step 5: Run authoring tests and verify GREEN**

Run: `corepack pnpm exec vitest run apps/web/src/features/course-authoring/authoring-page.test.tsx`  
Expected: PASS, including existing restore, version-conflict, deletion, Markdown, and confirmation tests.

### Task 3: Candidate generation feedback before acceptance

**Files:**
- Modify: `apps/web/src/features/course-authoring/authoring-page.tsx`
- Modify: `apps/web/src/features/course-authoring/outline-workspace-view.tsx`
- Test: `apps/web/src/features/course-authoring/authoring-page.test.tsx`

**Interfaces:**
- Produces: reducer action `generation-requested` that enters `generating` before `requestCandidateGeneration` resolves.
- Preserves: existing `generating`, stream event, and failure actions after acceptance.

- [x] **Step 1: Write the failing pre-acceptance feedback test**

```tsx
it('shows candidate generation feedback before the request is accepted', async () => {
  let accept!: (value: {
    taskId: string;
    state: string;
    resourceVersion: number;
  }) => void;
  const requestCandidateGeneration = vi.fn(
    () =>
      new Promise<{ taskId: string; state: string; resourceVersion: number }>((resolve) => {
        accept = resolve;
      }),
  );
  render(
    <AuthoringPage
      client={client({
        getOutlineSession: vi.fn().mockResolvedValue({
          outlineSessionId: 'session_01',
          resourceVersion: 3,
          state: 'assessment-ready',
          topic: '概率论',
          courseMode: 'standard',
          completedAssessmentRounds: 3,
          canGenerateCandidate: true,
          messages: [],
        }),
        requestCandidateGeneration,
      })}
      initialOutlineSessionId="session_01"
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: '生成候选大纲' }));
  expect(screen.getByText('正在生成候选大纲…')).toBeVisible();
  expect(screen.getByRole('button', { name: '正在生成…' })).toHaveAttribute(
    'aria-busy',
    'true',
  );
  accept({ taskId: 'task_01', state: 'running', resourceVersion: 4 });
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run: `corepack pnpm exec vitest run apps/web/src/features/course-authoring/authoring-page.test.tsx -t "before the request is accepted"`  
Expected: FAIL because `generating` is dispatched after acceptance.

- [x] **Step 3: Dispatch request state synchronously and preserve failure distinctions**

`generate()` dispatches `generation-requested` before awaiting the client. The candidate panel renders its existing pending state immediately. Acceptance updates the resource version and starts streaming; request rejection transitions to recoverable `generation_interrupted` without losing the previous candidate.

- [x] **Step 4: Run authoring tests and verify GREEN**

Run: `corepack pnpm exec vitest run apps/web/src/features/course-authoring/authoring-page.test.tsx`  
Expected: PASS.

### Task 4: Formal learning conversation optimistic turn

**Files:**
- Modify: `apps/web/src/features/learning/session-page.tsx`
- Modify: `apps/web/src/features/learning/lesson-session-workspace.tsx`
- Modify: `apps/web/src/features/learning/lesson-session-workspace.css`
- Modify: `apps/web/src/features/learning/message-stream.tsx`
- Test: `apps/web/src/features/learning/session-page.test.tsx`

**Interfaces:**
- Produces: local message status `submitting | complete | failed` and assistant state `thinking | streaming`.
- Consumes: existing `LearningClient.sendMessage`, `stream`, and `getSession` Interfaces.
- Reconciles: hydration replaces local user/assistant items with the canonical server snapshot.

- [x] **Step 1: Write the failing immediate-send test**

```tsx
it('shows the user message and thinking before sendMessage is accepted', async () => {
  const sendMessage = vi.fn(() => new Promise(() => undefined));
  render(<SessionPage lessonId="lesson_01" client={client({ sendMessage })} />);
  const input = await screen.findByLabelText('学习输入');
  fireEvent.change(input, { target: { value: 'Explain probability' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(screen.getByText('Explain probability')).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent('正在思考中');
  expect(input).toHaveValue('');
});
```

- [x] **Step 2: Run the formal-session test and verify RED**

Run: `corepack pnpm exec vitest run apps/web/src/features/learning/session-page.test.tsx`  
Expected: FAIL because the page waits for task acceptance before changing visible state.

- [x] **Step 3: Implement `send-started`, delta replacement, and failure recovery**

The reducer appends a local user message, clears input, sets `phase='generating'`, and displays thinking before the client call. The first delta replaces thinking in the same assistant item. A pre-acceptance failure restores the input and marks the user item failed; stream failure preserves partial Markdown. Hydration clears temporary items.

- [x] **Step 4: Add visible status and reduced-motion-safe styling**

`LessonSessionWorkspace` renders thinking as one assistant article with `role="status"`, `aria-live="polite"`, and a subtle ellipsis animation disabled by `prefers-reduced-motion`.

- [x] **Step 5: Run formal-session tests and verify GREEN**

Run: `corepack pnpm exec vitest run apps/web/src/features/learning/session-page.test.tsx`  
Expected: PASS, including duplicate-send, stop, lease, refresh recovery, and Review tests.

### Task 5: Specification sync and verification

**Files:**
- Modify: `PROJECT_CONTEXT.md`
- Modify: `docs/课程创建通用流程与功能逻辑规则.md`
- Modify: `docs/课程学习与 Review 功能逻辑规则.md`
- Modify: `docs/基础模块功能等价清单与回归基线.md`
- Modify: `docs/UI视觉方案与最终稿清单.md`

**Interfaces:**
- Produces: one authoritative cross-page rule for immediate AI feedback and server reconciliation.
- Preserves: existing domain definitions for completed rounds, statistics, and portrait evidence.

- [x] **Step 1: Add the confirmed rule and regression assertions**

Document the interaction sequence, local-only status rule, candidate pre-acceptance feedback, formal-session behavior, failure recovery, and the requirement that future AI triggers follow the same contract.

- [x] **Step 2: Run focused tests**

Run: `corepack pnpm exec vitest run apps/web/src/features/home/home-page.test.tsx apps/web/src/router.test.tsx apps/web/src/features/course-authoring/authoring-page.test.tsx apps/web/src/features/learning/session-page.test.tsx`  
Expected: PASS.

- [x] **Step 3: Run web typecheck and full web tests**

Run: `corepack pnpm --filter @learning-more/web typecheck`  
Expected: PASS.

Run: `corepack pnpm --filter @learning-more/web test`  
Expected: PASS.

- [x] **Step 4: Check formatting and changed-file whitespace**

Run: `git diff --check`  
Expected: no whitespace errors introduced by this implementation.
