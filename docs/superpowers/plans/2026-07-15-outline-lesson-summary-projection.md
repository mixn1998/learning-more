# Outline Lesson Summary Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display each formal-course lesson’s one-sentence summary parsed from that lesson’s saved Markdown outline section instead of joining knowledge-point labels.

**Architecture:** Extend the existing pure Markdown projection seam so every projected lesson carries an optional derived `summary`. `OutlineView` indexes projections by `lessonId` and renders `summary ?? objective`; no backend field, persistence migration, contract change, or AI call is introduced.

**Tech Stack:** TypeScript, React, existing Markdown heading parser, Vitest, Testing Library.

## Global Constraints

- Saved raw Markdown remains the only source for module grouping and projected lesson summaries.
- Do not add an AI call, backend field, storage migration, or shared-contract field.
- Never build directory summaries from `coreKnowledgePoints`.
- If no usable Markdown summary exists, render the formal lesson `objective`.
- Stay inside the matched lesson section and ignore metadata, lists, tables, code, quotes, and nested headings.

---

### Task 1: Pure lesson-summary extraction

**Files:**
- Modify: `apps/web/src/features/course/outline-markdown-projection.ts`
- Test: `apps/web/src/features/course/outline-markdown-projection.test.ts`

**Interfaces:**
- Consumes: lesson-section Markdown returned by `nodeMarkdown(...)`.
- Produces: `extractOutlineLessonSummary(markdown: string): string | undefined` and `OutlineProjectionLesson.summary?: string`.

- [x] **Step 1: Write failing extraction tests**

Add these cases:

```ts
expect(
  extractOutlineLessonSummary(`### Token 是企业 AI 成本的“电表”吗？

**一句话摘要：** 理解 token、模型服务、算力商品、预付额度与货币之间的区别，并拆解模型费用如何进入企业账单。

**关键词：** token、模型服务、企业账单`),
).toBe(
  '理解 token、模型服务、算力商品、预付额度与货币之间的区别，并拆解模型费用如何进入企业账单。',
);

expect(
  extractOutlineLessonSummary(`### 市场为何产生

理解模型厂商、云平台和企业客户如何共同形成 AI 成本市场。第二句不进入目录。

- 模型厂商
- 云平台`),
).toBe('理解模型厂商、云平台和企业客户如何共同形成 AI 成本市场。');

expect(
  extractOutlineLessonSummary(`### 只有元数据

关键词：token、账单

| 知识点 | 说明 |
| --- | --- |
| token | 计量 |`),
).toBeUndefined();
```

- [x] **Step 2: Run the projection test and verify red state**

```powershell
.\node_modules\.bin\vitest.CMD run --root . apps/web/src/features/course/outline-markdown-projection.test.ts --no-file-parallelism
```

Expected: FAIL because the extractor and `summary` projection do not exist.

- [x] **Step 3: Implement the extractor and projection field**

Add:

```ts
function firstSummarySentence(value: string): string | undefined {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (normalized === '') return undefined;
  const end = normalized.search(/[。！？!?]/u);
  return end < 0 ? normalized : normalized.slice(0, end + 1);
}

export function extractOutlineLessonSummary(markdown: string): string | undefined {
  const lines = markdown.replace(/\r\n?/gu, '\n').split('\n');
  const paragraphs: string[] = [];
  let paragraph: string[] = [];
  let fenced = false;
  let sawLessonHeading = false;

  const flush = () => {
    if (paragraph.length > 0) paragraphs.push(paragraph.join(' '));
    paragraph = [];
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (/^```/u.test(trimmed)) {
      fenced = !fenced;
      flush();
      continue;
    }
    if (fenced) continue;
    if (/^#{1,6}\s+/u.test(trimmed)) {
      if (sawLessonHeading) break;
      sawLessonHeading = true;
      continue;
    }
    if (trimmed === '') {
      flush();
      continue;
    }
    if (/^(?:>|\||[-+*]\s|\d+[.)、]\s)/u.test(trimmed)) {
      flush();
      continue;
    }

    const plain = stripInlineMarkdown(trimmed).replace(/\s+/gu, ' ').trim();
    const labelled = /^(?:一句话摘要|本节摘要|课节摘要|摘要)\s*[:：]\s*(.+)$/u.exec(plain);
    if (labelled?.[1] !== undefined) return firstSummarySentence(labelled[1]);
    if (/^(?:关键词|核心知识点|知识节点|前置知识|学习目标|目标|时长|预计时长)\s*[:：]/u.test(plain)) {
      flush();
      continue;
    }
    paragraph.push(plain);
  }
  flush();
  return firstSummarySentence(paragraphs[0] ?? '');
}
```

Use `[。！？!?]` as sentence terminators and retain the terminator. If no terminator exists, return the normalized paragraph. Strip inline links and emphasis with the existing helper and never truncate by character count.

Compute the lesson Markdown and summary once:

```ts
const markdown = nodeMarkdown(parsed, node, nodeIndex);
const summary = extractOutlineLessonSummary(markdown);
const projected = {
  key: lesson.lessonId,
  lessonId: lesson.lessonId,
  title: lesson.title,
  markdown,
  ...(summary === undefined ? {} : { summary }),
} satisfies OutlineProjectionLesson;
```

Apply the same derivation to unconfirmed candidate lesson projections.

- [x] **Step 4: Run the projection tests and verify green state**

Run the command from Step 2. Expected: all projection tests PASS without changing module or lesson ownership.

---

### Task 2: Course-directory summary consumption

**Files:**
- Modify: `apps/web/src/features/course/outline-view.tsx`
- Modify: `apps/web/src/features/course/formal-course-view.tsx`
- Modify: `apps/web/src/visual/course-fixture.tsx`
- Test: `apps/web/src/features/course/outline-view.test.tsx`
- Test: `apps/web/src/features/course/formal-course-view.test.tsx`

**Interfaces:**
- Consumes: `OutlineProjectionLesson.summary?: string`.
- Produces: directory copy with exact precedence `projected.summary ?? lesson.objective`.

- [x] **Step 1: Write failing directory tests**

Use Markdown containing the requested sentence and lesson data with visibly different knowledge nodes. Assert the card shows:

```ts
expect(screen.getByText('理解 token、模型服务、算力商品、预付额度与货币之间的区别，并拆解模型费用如何进入企业账单。')).toBeVisible();
expect(screen.queryByText('token 计量、模型调用、企业账单。')).not.toBeInTheDocument();
```

Add another matched lesson with no usable prose and assert its `objective` appears.

- [x] **Step 2: Run directory tests and verify red state**

```powershell
.\node_modules\.bin\vitest.CMD run --root . apps/web/src/features/course/outline-view.test.tsx apps/web/src/features/course/formal-course-view.test.tsx --no-file-parallelism
```

Expected: FAIL because `OutlineView` still joins `coreKnowledgePoints`.

- [x] **Step 3: Index projections and render summary/objective**

Build an index:

```ts
const projectedLessonById = new Map(
  [...projection.modules.flatMap((module) => module.lessons), ...projection.ungroupedLessons]
    .filter((lesson) => lesson.lessonId !== undefined)
    .map((lesson) => [lesson.lessonId!, lesson] as const),
);
```

Render:

```tsx
<p>{projectedLessonById.get(lesson.lessonId)?.summary ?? lesson.objective}</p>
```

Remove `toLessonKnowledgeSummary`. Remove `lessonDescriptions` from `OutlineView`, `FormalCourseView`, and the visual fixture so alternate copy cannot override the saved-outline projection.

- [x] **Step 4: Run focused directory tests and verify green state**

Run the command from Step 2. Expected: both files PASS and joined knowledge-node copy is absent.

---

### Task 3: Regression and completion audit

**Files:**
- Modify: `docs/superpowers/plans/2026-07-15-outline-lesson-summary-projection.md`

**Interfaces:**
- Consumes: completed projection and directory behavior.
- Produces: verified repository state and one implementation commit.

- [x] **Step 1: Run course and page regressions**

```powershell
.\node_modules\.bin\vitest.CMD run --root . apps/web/src/features/course apps/web/src/features/review/course-page.test.tsx --no-file-parallelism
```

Expected: all selected tests PASS.

- [x] **Step 2: Run web typecheck and lint**

```powershell
.\node_modules\.bin\tsc.CMD --noEmit -p apps/web/tsconfig.json
.\node_modules\.bin\eslint.CMD apps/web/src/features/course apps/web/src/visual/course-fixture.tsx
```

Expected: both commands exit 0.

- [x] **Step 3: Prove the mechanical fallback is gone**

```powershell
rg -n "toLessonKnowledgeSummary|coreKnowledgePoints\.join|lessonDescriptions" apps/web/src/features/course apps/web/src/features/review/course-page.tsx
```

Expected: no directory-rendering matches.

- [x] **Step 4: Run format and diff checks**

```powershell
.\node_modules\.bin\prettier.CMD --check apps/web/src/features/course/outline-markdown-projection.ts apps/web/src/features/course/outline-markdown-projection.test.ts apps/web/src/features/course/outline-view.tsx apps/web/src/features/course/outline-view.test.tsx apps/web/src/features/course/formal-course-view.tsx apps/web/src/features/course/formal-course-view.test.tsx apps/web/src/visual/course-fixture.tsx docs/superpowers/plans/2026-07-15-outline-lesson-summary-projection.md
git diff --check
```

Expected: both commands exit 0.

- [x] **Step 5: Commit the implementation slice**

```powershell
git add -- apps/web/src/features/course/outline-markdown-projection.ts apps/web/src/features/course/outline-markdown-projection.test.ts apps/web/src/features/course/outline-view.tsx apps/web/src/features/course/outline-view.test.tsx apps/web/src/features/course/formal-course-view.tsx apps/web/src/features/course/formal-course-view.test.tsx apps/web/src/visual/course-fixture.tsx docs/superpowers/plans/2026-07-15-outline-lesson-summary-projection.md
git commit -m "feat: project lesson summaries from outlines"
```

Expected: one commit containing only this implementation slice.
