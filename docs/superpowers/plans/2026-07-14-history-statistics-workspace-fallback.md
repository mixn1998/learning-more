# History Statistics Workspace Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Execute this plan task-by-task in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the sample-aligned history statistics workspace visible when the course catalog request fails.

**Architecture:** Treat the home dashboard as optional enrichment for statistics. The statistics, calendar, and history-fact responses remain the authoritative sources for metrics; catalog failure becomes a local course-panel state.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library

## Global Constraints

- Preserve `docs/UI视觉预览/06-历史统计与学习画像/历史统计.html` as the visual baseline.
- Never substitute sample numbers for real data.
- Do not expose raw course or lesson IDs when catalog enrichment is unavailable.
- Do not alter calendar or portrait navigation.

---

### Task 1: Add the catalog-failure regression test

**Files:**
- Modify: `apps/web/src/features/history/history.test.tsx`

**Interfaces:**
- Consumes: `HistoryPage` with `HistoryClient.getDashboard` rejected and other history requests fulfilled
- Produces: a user-visible regression test for stable workspace selection

- [ ] Add this catalog-failure test:

```tsx
const api = client();
vi.mocked(api.getDashboard).mockRejectedValue(new Error('catalog_unavailable'));
renderHistory(api);
expect(await screen.findByRole('heading', { level: 1, name: '历史统计' })).toBeInTheDocument();
expect(screen.getByRole('button', { name: '本年' })).toBeInTheDocument();
expect(screen.getByRole('alert')).toHaveTextContent('课程目录暂不可用');
expect(screen.queryByRole('heading', { name: '学习时间线' })).not.toBeInTheDocument();
```
- [ ] Run `& '.\node_modules\.bin\vitest.CMD' run apps/web/src/features/history/history.test.tsx -t "keeps the statistics workspace"` and verify it fails by rendering the legacy page.

### Task 2: Make catalog enrichment optional

**Files:**
- Modify: `apps/web/src/features/history/history-statistics-model.ts`
- Modify: `apps/web/src/features/history/history-page.tsx`
- Modify: `apps/web/src/features/history/history-statistics-workspace.tsx`
- Test: `apps/web/src/features/history/history-statistics-model.test.ts`
- Test: `apps/web/src/features/history/history.test.tsx`

**Interfaces:**
- `buildStatisticsSnapshot({ dashboard?: HomeDashboardView, ... })`
- `buildStatisticsCourses({ dashboard?: HomeDashboardView, entries })`
- `HistoryStatisticsWorkspace({ catalogError?: string, ... })`

- [ ] Change model inputs to accept an optional dashboard; initialize enrichment maps as follows and add direct completion-fact course IDs to `completedCourseIds`:

```ts
readonly dashboard?: HomeDashboardView | undefined;
const lessonCourse = new Map(
  input.dashboard?.lessons.map((lesson) => [lesson.lessonId, lesson.courseId]) ?? [],
);
const courseTitle = new Map(
  input.dashboard?.courses.map((course) => [course.courseId, course.title]) ?? [],
);
```

- [ ] Make `buildStatisticsCourses` return `[]` when the dashboard is absent:

```ts
if (input.dashboard === undefined) return [];
```

- [ ] Render `HistoryStatisticsWorkspace` whenever `statistics` exists and pass the optional catalog error:

```tsx
if (section === 'statistics' && statistics !== undefined) {
  return <HistoryStatisticsWorkspace catalogError={errors.catalog} {...workspaceProps} />;
}
```

- [ ] In the history-course panel, replace the table with a local alert when `catalogError` exists:

```tsx
{props.catalogError === undefined ? (
  <table className="history-stat-course-table">...</table>
) : (
  <div className="history-stat-catalog-error" role="alert">
    <strong>课程目录暂不可用</strong>
    <p>统计数据仍可查看，课程列表可稍后重试。</p>
  </div>
)}
```
- [ ] Run the focused history tests and model tests; expected result is all passing.

### Task 3: Verify both fixes together

**Files:**
- Test: all files changed by the draft restore and history fallback fixes

**Interfaces:**
- Produces: combined regression confidence for both user-reported paths

- [ ] Run the focused authoring, home, router, history, and history-statistics-model test files.
- [ ] Run Prettier, ESLint, and `git diff --check` on all changed implementation and test files.
- [ ] Visually verify the restore loading/failure states and the catalog-failure statistics workspace without modifying the new-course form.
