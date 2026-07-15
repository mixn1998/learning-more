# Course Introduction Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the course-detail keyword dump with the saved outline title and formatted course introduction, with a deterministic introduction when legacy Markdown has no introduction.

**Architecture:** Extend the existing outline Markdown projection so it owns course-level title and introduction extraction alongside module and lesson projection. Keep fallback composition deterministic and local to the course view model: it uses only the saved course title, projected module names, lesson names, and lesson summaries. Render the resulting introduction through the existing sanitized `AiContent` component.

**Tech Stack:** TypeScript, React 19, Vitest, Testing Library, existing `@learning-more/ui` Markdown renderer.

## Global Constraints

- Prefer the H1 saved in `outlineMarkdown` over `course.title`.
- Preserve Markdown paragraphs, line breaks, and bold emphasis in the introduction.
- Never render the full `topicTags` list in the course hero.
- When no introduction is recognized, compose relevant copy deterministically without an AI call.
- Preserve unrelated worktree changes and do not widen contracts or persistence schemas.

---

### Task 1: Project the saved course introduction

**Files:**
- Modify: `apps/web/src/features/course/outline-markdown-projection.ts`
- Test: `apps/web/src/features/course/outline-markdown-projection.test.ts`

**Interfaces:**
- Consumes: Saved `outlineMarkdown` and the existing parsed heading hierarchy.
- Produces: `OutlineMarkdownProjection.introductionMarkdown?: string`.

- [ ] **Step 1: Write failing extraction tests**

```ts
it('extracts the Markdown between the course title and first module', () => {
  const projection = projectOutlineMarkdown(`# 微积分：从直观变化到严格推导

第一段课程介绍。

**直观问题 → 数学定义 → 公式推导**

## 模块一
### 极限是什么`);

  expect(projection.title).toBe('微积分：从直观变化到严格推导');
  expect(projection.introductionMarkdown).toBe(
    '第一段课程介绍。\n\n**直观问题 → 数学定义 → 公式推导**',
  );
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `corepack pnpm exec vitest run apps/web/src/features/course/outline-markdown-projection.test.ts`

Expected: FAIL because `introductionMarkdown` is not projected.

- [ ] **Step 3: Implement course-level Markdown extraction**

Add `introductionMarkdown?: string` to `OutlineMarkdownProjection`. Slice from the line after the first H1 through the line before the first later heading with level 1 or 2, trim it, and omit the property when the result is empty.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `corepack pnpm exec vitest run apps/web/src/features/course/outline-markdown-projection.test.ts`

Expected: PASS.

### Task 2: Compose a deterministic legacy-course fallback

**Files:**
- Modify: `apps/web/src/features/course/outline-markdown-projection.ts`
- Test: `apps/web/src/features/course/outline-markdown-projection.test.ts`

**Interfaces:**
- Consumes: `OutlineMarkdownProjection`, fallback course title, module titles, lesson titles, and available lesson summaries.
- Produces: `resolveCourseIntroduction(projection, fallbackTitle): { title: string; introductionMarkdown: string }`.

- [ ] **Step 1: Write failing fallback tests**

Verify that an existing introduction is returned unchanged, and that an outline containing only headings produces copy naming the course and representative saved modules or lessons without keyword tags.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `corepack pnpm exec vitest run apps/web/src/features/course/outline-markdown-projection.test.ts`

Expected: FAIL because `resolveCourseIntroduction` does not exist.

- [ ] **Step 3: Implement the resolver**

Use the saved H1 when non-empty. If the extracted introduction is empty, compose two short Markdown paragraphs: a course overview using the resolved title, then a learning-route sentence using up to three projected module or lesson titles. Do not use `disciplineTag`, `topicTags`, network requests, or generation runtime dependencies.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `corepack pnpm exec vitest run apps/web/src/features/course/outline-markdown-projection.test.ts`

Expected: PASS.

### Task 3: Render the title and introduction in the course hero

**Files:**
- Modify: `apps/web/src/features/course/formal-course-view.tsx`
- Modify: `apps/web/src/features/course/formal-course-view.css`
- Test: `apps/web/src/features/course/formal-course-view.test.tsx`

**Interfaces:**
- Consumes: `resolveCourseIntroduction(projectOutlineMarkdown(...), course.title)`.
- Produces: An H1 with the outline title and a sanitized Markdown introduction block.

- [ ] **Step 1: Write the failing rendering tests**

Render a course whose outline H1 differs from `course.title`, includes multiple introduction paragraphs and bold text, and whose current outline has many topic tags. Assert that the outline H1, paragraphs, and `<strong>` content are present and that the joined keyword string is absent. Add a second case asserting deterministic fallback copy for a heading-only outline.

- [ ] **Step 2: Run the component test and verify RED**

Run: `corepack pnpm exec vitest run apps/web/src/features/course/formal-course-view.test.tsx`

Expected: FAIL because the hero still renders `course.title` and keyword metadata.

- [ ] **Step 3: Replace hero metadata rendering**

Compute the projection once with `useMemo`, reuse it for lesson summaries, and resolve hero copy from it. Render `<h1>{resolved.title}</h1>` and `<AiContent className="course-hero__introduction" markdown={resolved.introductionMarkdown} />`. Keep compact mode and lesson-count chips; remove the full topic-tag metadata paragraph.

- [ ] **Step 4: Style readable introduction content**

Give the introduction a readable maximum width, normal body font size, paragraph spacing, and strong-text weight. Ensure generic `.course-hero p` rules no longer shrink the introduction to 11px.

- [ ] **Step 5: Run component and parser tests and verify GREEN**

Run: `corepack pnpm exec vitest run apps/web/src/features/course/outline-markdown-projection.test.ts apps/web/src/features/course/formal-course-view.test.tsx`

Expected: PASS.

### Task 4: Regression and runtime verification

**Files:**
- Verify only: affected web package and active local runtime.

**Interfaces:**
- Consumes: Completed parser and hero changes.
- Produces: Passing package checks and verified visible behavior for the real calculus course.

- [ ] **Step 1: Run web typecheck and focused test suite**

Run: `corepack pnpm --filter @learning-more/web typecheck`

Run: `corepack pnpm exec vitest run apps/web/src/features/course/outline-markdown-projection.test.ts apps/web/src/features/course/formal-course-view.test.tsx`

Expected: all commands exit 0.

- [ ] **Step 2: Build the web package/runtime using the repository's existing launch workflow**

Run the existing verified local build/reconnect command discovered from package scripts or runtime documentation; do not replace user configuration.

- [ ] **Step 3: Verify the real calculus page**

Open `/courses/course_cc659864-f3ee-427e-91b9-981b99015be3` and assert:

- H1 is `微积分：从直观变化到严格推导`.
- The introduction contains `这是一门以一元微积分为主线的系统入门课。`.
- The bold learning path is rendered.
- The 27-keyword metadata string is absent from the hero.

