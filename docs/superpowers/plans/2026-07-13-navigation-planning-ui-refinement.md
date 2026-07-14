# Navigation and Planning UI Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the current HTML samples for course switching, compact scheduling with an anchored date layer, derived schedule states, dynamic plan duration, calendar overflow, consistent statistics cards, and explanatory-copy cleanup.

**Architecture:** Keep each sample self-contained and reuse one course-selection dialog contract across the homepage and formal outline. In the course-planning sample, keep lesson lifecycle as source data and derive schedule state from `scheduledDate`, lifecycle and the fixed sample date; never persist a second mutable status field. Date cards remain compact overview components; complete lesson lists stay in the existing agenda/detail regions.

**Tech Stack:** HTML, CSS, browser JavaScript, native `<dialog>`, native `<input type="date">`, Playwright regression scripts.

**Execution status (2026-07-13):** Tasks 1–6 已完成并通过交互、接线、几何、排版、页面加载、UI 审计和三视口视觉完整性验证。项目工作树已有其他未提交修改，因此本计划不提交混合页面改动。

## Global Constraints

- Modify only current-final UI resources under `docs/UI视觉预览`; do not create alternate page versions.
- Course cards in the chooser always enter a formal course outline, never a lesson session.
- Daily target duration is one shared value for all selected weekdays.
- Scheduling uses an anchored, non-modal in-page date layer; it does not use the browser-native picker or a blocking scheduling modal.
- Planning status is derived only: `待规划` for no date, `已安排` for today/future dates, `已逾期` for past dates; completed and abandoned lessons are excluded.
- Date overview cards never gain internal scrollbars.
- Remove explanatory UI copy without inserting replacement placeholders.
- Preserve existing user changes and unrelated dirty-worktree files.

---

### Task 1: Shared Course Selection Behavior

**Files:**
- Modify: `docs/UI视觉预览/01-主页与全局导航/主页.html`
- Modify: `docs/UI视觉预览/02-课程创建与大纲/正式课程大纲.html`
- Test: `docs/UI视觉预览/00-设计系统/tests/run-interaction-regression.mjs`

**Interfaces:**
- Consumes: sample course records `{ id, title, mode, updatedAt, hasInProgress, href }`.
- Produces: `openCourseChooser(currentCourseId?: string)` and course-card navigation to `href`.

- [ ] **Step 1: Write failing chooser tests**

Add Playwright assertions that the homepage continue button opens `#courseChooser` for two or more courses, that cards are ordered by `data-updated-at`, and that the first `data-has-in-progress="true"` card is visually marked. On the outline page, click `#switchCourse`, verify the current card is disabled/labelled, and verify another card points to a formal outline URL.

Also assert both chooser contexts can filter the open-course list by `disciplineTag` and course mode without changing the source ordering of the remaining cards.

- [ ] **Step 2: Run the interaction suite and confirm failure**

Run: `node docs/UI视觉预览/00-设计系统/tests/run-interaction-regression.mjs` with the project Playwright `NODE_PATH`.

Expected: FAIL because `#courseChooser` and `#switchCourse` do not exist.

- [ ] **Step 3: Implement the shared chooser contract in both samples**

Use the same markup and record shape in both files:

```js
const openCourses = [
  { id: 'game-loop', title: '从反馈到核心循环', updatedAt: '2026-07-12T10:42:00+08:00', hasInProgress: true, href: '正式课程大纲.html?course=game-loop' },
  { id: 'data-structures', title: '数据结构：从约束理解操作代价', updatedAt: '2026-07-10T20:15:00+08:00', hasInProgress: false, href: '正式课程大纲.html?course=data-structures' }
].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

function continueCourse() {
  if (openCourses.length === 1) location.href = openCourses[0].href;
  else renderCourseChooser();
}
```

The chooser card itself is the only navigation action. Mark the current course with `aria-current="page"` and prevent its navigation. Hide `#switchCourse` when `openCourses.length < 2`.

Render two `<select>` controls inside both chooser dialogs: “全部学科 / 领域” filters by the course `disciplineTag`; “全部玩法模式” filters by `courseMode`. Re-render the same sorted source collection after either selection changes.

- [ ] **Step 4: Run the focused interaction checks**

Expected: homepage and outline chooser assertions PASS; existing homepage week and outline interactions remain PASS.

- [ ] **Step 5: Commit the task**

Commit only the two pages and updated interaction test with message `feat: add formal course chooser`.

---

### Task 2: Week and Learning Calendar Overflow

**Files:**
- Modify: `docs/UI视觉预览/01-主页与全局导航/主页.html`
- Modify: `docs/UI视觉预览/06-历史统计与学习画像/学习日历.html`
- Test: `docs/UI视觉预览/00-设计系统/tests/run-interaction-regression.mjs`
- Test: `docs/UI视觉预览/00-设计系统/tests/run-visual-integrity.mjs`

**Interfaces:**
- Produces: compact previews with `.overflow-count` and existing full agenda/detail rendering.

- [ ] **Step 1: Add failing overflow assertions**

Assert that a homepage date with more than the preview capacity contains `.overflow-count`, and clicking the date renders all lessons in `#agenda`. Assert that a learning-calendar day with more than two completed lessons shows `.overflow-count`, while the right detail panel renders the full collection.

- [ ] **Step 2: Run interaction tests and confirm failure**

Expected: FAIL because no overflow summary is rendered.

- [ ] **Step 3: Implement bounded previews**

Use a helper local to each page:

```js
function previewLessons(items, limit) {
  return {
    visible: items.slice(0, items.length > limit ? limit - 1 : limit),
    hiddenCount: Math.max(0, items.length - (items.length > limit ? limit - 1 : limit))
  };
}
```

Homepage week cards use a capacity that preserves one final overflow row; learning calendar cells use `limit = 3`, producing two titles plus one overflow row. Titles use single-line ellipsis. The full agenda/detail arrays must remain untruncated.

- [ ] **Step 4: Run interaction and visual-integrity suites**

Expected: overflow assertions PASS at desktop, tablet, and mobile; no internal card scrollbar or grid expansion.

- [ ] **Step 5: Commit the task**

Commit the two pages and tests with message `feat: add calendar overflow summaries`.

---

### Task 3: Compact Planning Cards and Derived Scheduling

**Files:**
- Modify: `docs/UI视觉预览/03-课程规划与排期/课程规划.html`
- Test: `docs/UI视觉预览/00-设计系统/tests/run-interaction-regression.mjs`
- Test: `docs/UI视觉预览/00-设计系统/tests/run-control-geometry.mjs`
- Test: `docs/UI视觉预览/00-设计系统/tests/run-typography-spacing.mjs`

**Interfaces:**
- Consumes: lesson records with `lifecycle` and `scheduledDate` plus `renderLessons()`.
- Produces: `getScheduleStatus(lesson)`, `schedulableLessons()`, anchored date selection, and compact date-card headings.

- [ ] **Step 1: Add failing scheduling tests**

Assert that a pending lesson renders “点击安排学习日期” and no cancel button; choose a date in the anchored date layer and assert the date plus cancel button appear; click cancel and assert the prompt returns. Assert a past-dated unfinished lesson appears only in the “已逾期” filter. Assert course name, estimated duration, schedule-state tag and topic tag share the adaptive metadata flow, while no date appears there.

- [ ] **Step 2: Run focused tests and confirm failure**

Expected: FAIL because the current date button uses a modal workflow.

- [ ] **Step 3: Implement native date inputs and compact cards**

Use one lesson record shape with no mutable `status` field:

```js
const lesson = {
  lifecycle: 'not_started',
  scheduledDate: '2026-07-12' // or ''
};

function getScheduleStatus(lesson) {
  if (['completed', 'abandoned'].includes(lesson.lifecycle)) return 'excluded';
  if (!lesson.scheduledDate) return '待规划';
  return lesson.scheduledDate < today ? '已逾期' : '已安排';
}
```

Render an anchored, non-modal date selection layer from the date trigger. Choosing a date updates `lesson.scheduledDate`; cancelling clears that value directly without a second confirmation. Keep the date only in the right operation area. Lay out course name, estimated duration, derived schedule-state tag and topic tag as one wrapping metadata flow below the title.

Update the seven-day sidebar date heading to one line, e.g. `周日 · 今天 07/12`, with one typography rule and lesson names below it.

- [ ] **Step 4: Run interaction, control-geometry, and typography-spacing tests**

Expected: scheduling state cycle PASS; no clipped controls, malformed buttons, or spacing violations.

- [ ] **Step 5: Commit the task**

Commit page and tests with message `feat: simplify lesson scheduling interaction`.

---

### Task 4: Dynamic Plan-Flow Duration

**Files:**
- Modify: `docs/UI视觉预览/03-课程规划与排期/计划流向导与管理.html`
- Test: `docs/UI视觉预览/00-设计系统/tests/run-interaction-regression.mjs`

**Interfaces:**
- Produces: `selectedWeekdayCount()`, `dailyTargetMinutes()`, `formatDuration(minutes)`, and `updateWeeklyEstimate()`.

- [ ] **Step 1: Add failing duration tests**

Toggle one weekday off and assert the weekly estimate changes. Select 90 minutes with seven days selected and assert “10 小时 30 分钟”. Choose “自定义时长”, enter 120, and assert the estimate updates. Verify zero selected days blocks next-step progression.

- [ ] **Step 2: Run interaction tests and confirm failure**

Expected: FAIL because the summary is hard-coded to 225 minutes and custom duration is unavailable.

- [ ] **Step 3: Implement dynamic calculation and custom minutes**

```js
const formatDuration = minutes => {
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
};

function updateWeeklyEstimate() {
  weeklyEstimate.textContent = `预计每周 ${formatDuration(selectedWeekdayCount() * dailyTargetMinutes())}`;
}
```

Add a custom option and a numeric input with `min="15" step="15"`. Invalid values keep the last valid duration and show field-level feedback. Do not add per-weekday duration controls.

- [ ] **Step 4: Run interaction tests**

Expected: all duration and wizard-step assertions PASS.

- [ ] **Step 5: Commit the task**

Commit page and test with message `feat: calculate plan flow duration dynamically`.

---

### Task 5: Statistics Consistency and Explanatory-Copy Cleanup

**Files:**
- Modify: `docs/UI视觉预览/06-历史统计与学习画像/历史统计.html`
- Modify: `docs/UI视觉预览/02-课程创建与大纲/正式课程大纲.html`
- Modify: `docs/UI视觉预览/02-课程创建与大纲/正式课程大纲.html`
- Modify: `docs/UI视觉预览/02-课程创建与大纲/修改大纲.html`
- Modify: `docs/UI视觉预览/03-课程规划与排期/计划流向导与管理.html`
- Test: `docs/UI视觉预览/00-设计系统/tests/report-instructional-copy.mjs`
- Test: `docs/UI视觉预览/00-设计系统/tests/run-visual-integrity.mjs`

**Interfaces:**
- Produces: four visually equal `.metric` cards and no product-external instructional copy.

- [ ] **Step 1: Add failing copy/style assertions**

Assert the history page has no `.metric.primary`, the outline page does not contain “推荐但不锁课”, and the instructional-copy report contains no newly forbidden explanatory strings.

- [ ] **Step 2: Run checks and confirm failure**

Expected: FAIL on `.metric.primary` and “推荐但不锁课”.

- [ ] **Step 3: Remove visual and copy exceptions**

Remove the `primary` class/style from the first metric. Remove the outline pill. Review all HTML matches from the instructional-copy report and delete only design/sample/implementation explanations; retain real state, action, error, recovery, and empty-state text. Do not insert replacement placeholders.

- [ ] **Step 4: Run copy and visual tests**

Expected: copy report has no blocking findings; visual-integrity PASS.

- [ ] **Step 5: Commit the task**

Commit changed pages and tests with message `style: unify statistics and remove explanatory copy`.

---

### Task 6: Documentation Sync and Full Regression

**Files:**
- Modify: `PROJECT_CONTEXT.md`
- Modify: `docs/基础模块功能等价清单与回归基线.md`
- Modify: `docs/UI视觉方案与最终稿清单.md`
- Modify: `docs/设计文档/UI全页面控件交互验收矩阵.md`
- Modify: `docs/superpowers/plans/2026-07-13-navigation-planning-ui-refinement.md`

**Interfaces:**
- Produces: one consistent project-wide product and UI rule set.

- [ ] **Step 1: Synchronize the confirmed rules**

Record single/multiple-course routing, outline course switching, native scheduling, unified/custom duration, weekly estimate formula, calendar overflow, metric-card equality, and explanatory-copy removal.

- [ ] **Step 2: Run the complete UI audit**

Run:

```powershell
node docs/UI视觉预览/00-设计系统/tests/run-interaction-regression.mjs
node docs/UI视觉预览/00-设计系统/tests/run-control-wiring.mjs
node docs/UI视觉预览/00-设计系统/tests/run-control-geometry.mjs
node docs/UI视觉预览/00-设计系统/tests/run-module-geometry.mjs
node docs/UI视觉预览/00-设计系统/tests/run-typography-spacing.mjs
node docs/UI视觉预览/00-设计系统/tests/run-page-smoke.mjs
node docs/UI视觉预览/00-设计系统/tests/run-visual-integrity.mjs
```

Expected: every suite exits 0 and all 27 pages pass applicable desktop/tablet/mobile checks.

- [ ] **Step 3: Remove generated test state and verify initial samples**

Confirm tests leave no local-storage, generated JSON, temporary screenshots, or modified sample fixture state in the project. Reload homepage, planning, plan flow, outline, history, and calendar pages and verify their intended initial state.

- [ ] **Step 4: Mark this implementation plan complete**

Change all completed task checkboxes to `[x]` only after their corresponding tests pass.

- [ ] **Step 5: Commit documentation and plan status**

Commit only synchronized documentation and this plan with message `docs: sync navigation and planning UI behavior`.
