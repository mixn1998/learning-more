# Learning Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add independent, cross-course learning notes with classroom capture and a grouped notebook page.

**Architecture:** Add a `learning-notes` aggregate and local-file repository, expose a small CRUD HTTP API, then consume it through a focused web client. Keep the classroom workspace presentational by passing note state and actions from `SessionPage`; use a dedicated page for global grouping.

**Tech Stack:** TypeScript, Zod, Fastify, React, Vitest, Testing Library, local JSON aggregate storage.

## Global Constraints

- Every save creates one independent note.
- Server derives course, lesson and discipline metadata.
- Browser storage contains only the unsaved lesson draft.
- Notes survive course deletion through metadata snapshots.
- Do not write notes into teaching, Review, history or user-profile data.

---

### Task 1: Contracts, aggregate, repository and API

**Files:**
- Create: `packages/contracts/src/learning-notes.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/server/src/modules/learning-notes/interface.ts`
- Create: `apps/server/src/modules/learning-notes/ports/learning-note-repository.ts`
- Create: `apps/server/src/modules/learning-notes/implementation/learning-notes.ts`
- Create: `apps/server/src/persistence/learning-note-repositories.ts`
- Create: `apps/server/src/http/routes/learning-notes.ts`
- Modify: `apps/server/src/persistence/paths.ts`
- Modify: `apps/server/src/bootstrap/app.ts`
- Modify: `apps/server/src/bootstrap/local-application/assemble.ts`
- Test: `apps/server/src/http/routes/learning-notes.test.ts`
- Test: `apps/server/src/persistence/learning-note-repositories.contract.test.ts`

**Interfaces:**
- Consumes: authoritative course and lesson repository reads plus `UnitOfWork`.
- Produces: `LearningNote`, `LearningNotePage`, and CRUD route options.

- [ ] **Step 1: Write failing repository and route tests**

```ts
expect(await repository.list({ lessonId: 'lesson_1' })).toEqual([
  expect.objectContaining({ markdown: '关键判据', courseTitle: '微积分', lessonTitle: '单侧极限' }),
]);
expect(createResponse.statusCode).toBe(201);
expect(conflictingUpdate.statusCode).toBe(409);
```

- [ ] **Step 2: Run tests and verify missing-module failures**

Run: `node_modules/.bin/vitest run apps/server/src/http/routes/learning-notes.test.ts apps/server/src/persistence/learning-note-repositories.contract.test.ts`

- [ ] **Step 3: Implement contracts, versioned aggregate, repository and routes**

```ts
export type LearningNoteRepository = Readonly<{
  get(noteId: string): Promise<LearningNote | undefined>;
  list(filter: { courseId?: string; lessonId?: string }): Promise<readonly LearningNote[]>;
  save(tx: TransactionContext, note: LearningNote, expectedVersion: number): Promise<void>;
  remove(tx: TransactionContext, note: LearningNote, expectedVersion: number): Promise<void>;
}>;
```

- [ ] **Step 4: Run focused tests**

Run: `node_modules/.bin/vitest run apps/server/src/http/routes/learning-notes.test.ts apps/server/src/persistence/learning-note-repositories.contract.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git commit -am "feat: add learning note persistence and API"`

### Task 2: Web client and global notebook page

**Files:**
- Create: `apps/web/src/client/learning-notes-client.ts`
- Create: `apps/web/src/features/notes/learning-notes-page.tsx`
- Create: `apps/web/src/features/notes/learning-notes-page.css`
- Create: `apps/web/src/features/notes/learning-notes-page.test.tsx`
- Create: `apps/web/src/routes/learning-notes-route.tsx`
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/features/home/home-page.tsx`
- Modify: `apps/web/src/features/home/home-page.test.tsx`

**Interfaces:**
- Consumes: learning-note HTTP contracts.
- Produces: `/notes` route grouped by discipline and course.

- [ ] **Step 1: Write failing route, grouping, edit and delete tests**

```tsx
expect(await screen.findByRole('heading', { name: '数学' })).toBeVisible();
expect(screen.getByRole('heading', { name: '微积分' })).toBeVisible();
fireEvent.click(screen.getByRole('button', { name: '学习笔记' }));
expect(navigate).toHaveBeenCalledWith('/notes');
```

- [ ] **Step 2: Run focused web tests and verify failures**

Run: `node_modules/.bin/vitest run apps/web/src/features/notes/learning-notes-page.test.tsx apps/web/src/features/home/home-page.test.tsx`

- [ ] **Step 3: Implement client, route, grouped page and home entry**

```ts
export interface LearningNotesClient {
  list(filter?: { courseId?: string; lessonId?: string }): Promise<LearningNotePage>;
  create(input: CreateLearningNoteRequest): Promise<LearningNote>;
  update(noteId: string, input: UpdateLearningNoteRequest): Promise<LearningNote>;
  remove(noteId: string, resourceVersion: number): Promise<void>;
}
```

- [ ] **Step 4: Run focused tests**

Run: `node_modules/.bin/vitest run apps/web/src/features/notes/learning-notes-page.test.tsx apps/web/src/features/home/home-page.test.tsx apps/web/src/router.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git commit -am "feat: add cross-course notebook"`

### Task 3: Classroom notes and toolbar layout

**Files:**
- Create: `apps/web/src/features/learning/lesson-notes-panel.tsx`
- Create: `apps/web/src/features/learning/lesson-notes-panel.test.tsx`
- Modify: `apps/web/src/features/learning/session-page.tsx`
- Modify: `apps/web/src/features/learning/lesson-session-workspace.tsx`
- Modify: `apps/web/src/features/learning/lesson-session-workspace.css`
- Modify: `apps/web/src/features/learning/session-page.test.tsx`

**Interfaces:**
- Consumes: `LearningNotesClient`, current `courseId`, `lessonId`, and lesson metadata.
- Produces: classroom note draft, current-lesson list, and compact conversation toolbar.

- [ ] **Step 1: Write failing classroom interaction and layout tests**

```tsx
fireEvent.change(screen.getByLabelText('新笔记'), { target: { value: '左右极限必须一致' } });
fireEvent.click(screen.getByRole('button', { name: '保存笔记' }));
expect(await screen.findByText('左右极限必须一致')).toBeVisible();
expect(screen.getByText('实际学习时长')).toBeInTheDocument();
expect(screen.getByRole('heading', { name: '本课笔记' })).toBeVisible();
```

- [ ] **Step 2: Run focused tests and verify failures**

Run: `node_modules/.bin/vitest run apps/web/src/features/learning/lesson-notes-panel.test.tsx apps/web/src/features/learning/session-page.test.tsx`

- [ ] **Step 3: Implement panel, draft recovery and toolbar relocation**

```ts
const draftKey = `learning-note-draft:${courseId}:${lessonId}`;
localStorage.setItem(draftKey, draft);
```

- [ ] **Step 4: Run focused and change-aware verification**

Run: `corepack pnpm verify`
Expected: format, lint, related tests, server/web typecheck and architecture checks pass.

- [ ] **Step 5: Commit**

Run: `git commit -am "feat: capture notes during lessons"`
