# Course Permanent Delete UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the delete-course visual control and its front-end-only confirmation loop in the formal-course previews.

**Architecture:** The formal outline owns the danger button and dialog. Confirmation only redirects with a preview query flag; the homepage consumes that flag and shows a simulated result toast. No persistent records or local files are deleted.

**Tech Stack:** Static HTML, CSS, browser JavaScript, `SampleUI`, Playwright interaction regression.

## Global Constraints

- The danger control remains separate from normal course navigation.
- Confirmation has no course-name typing requirement.
- The simulation must not call a backend, write storage, or delete real data.
- Finish with an explicit boundary audit before the unified commit.

---

### Task 1: Wire the deletion-dialog simulation

**Files:**

- Modify: `D:\workspace\Growth OS\Learning MORE\docs\UI视觉预览\02-课程创建与大纲\正式课程大纲.html`
- Test: `D:\workspace\Growth OS\Learning MORE\docs\UI视觉预览\00-设计系统\tests\run-interaction-regression.mjs`

**Interfaces:**

- Consumes: `SampleUI.openDialog(dialog, trigger)` and `SampleUI.closeDialog(dialog)`.
- Produces: `#deleteCourse`, `#deleteCourseDialog`, `#cancelDeleteCourse`, `#confirmDeleteCourse`.

- [ ] **Step 1: Add a failing test for opening and cancelling the dialog**

```js
await page.locator('#deleteCourse').click();
expect(await page.locator('#deleteCourseDialog').evaluate((dialog) => dialog.open));
await page.locator('#cancelDeleteCourse').click();
expect(!(await page.locator('#deleteCourseDialog').evaluate((dialog) => dialog.open)));
```

- [ ] **Step 2: Add dialog open and close listeners**

```js
deleteCourse.addEventListener('click', () => SampleUI.openDialog(deleteCourseDialog, deleteCourse));
cancelDeleteCourse.addEventListener('click', () => SampleUI.closeDialog(deleteCourseDialog));
```

- [ ] **Step 3: Run the regression test**

Run: `node docs/UI视觉预览/00-设计系统/tests/run-interaction-regression.mjs`

Expected: the dialog opens and closes without changing the course page.

### Task 2: Simulate confirmation and hand off to homepage

**Files:**

- Modify: `D:\workspace\Growth OS\Learning MORE\docs\UI视觉预览\02-课程创建与大纲\正式课程大纲.html`
- Modify: `D:\workspace\Growth OS\Learning MORE\docs\UI视觉预览\01-主页与全局导航\主页.html`
- Test: `D:\workspace\Growth OS\Learning MORE\docs\UI视觉预览\00-设计系统\tests\run-interaction-regression.mjs`

**Interfaces:**

- Consumes: `activeCourse.id`, `URLSearchParams`, `SampleUI.showToast(message, tone)`.
- Produces: `?simDeletedCourse=<courseId>` and a single simulated-deletion toast.

- [ ] **Step 1: Add a failing redirect assertion**

```js
await page.locator('#confirmDeleteCourse').click();
await page.waitForURL(/主页\.html\?simDeletedCourse=game-loop/);
```

- [ ] **Step 2: Implement the explicit simulation redirect**

```js
confirmDeleteCourse.addEventListener('click', () => {
  confirmDeleteCourse.disabled = true;
  confirmDeleteCourse.textContent = '正在删除…';
  window.setTimeout(() => {
    location.href = `../01-主页与全局导航/主页.html?simDeletedCourse=${encodeURIComponent(activeCourse.id)}`;
  }, 360);
});
```

- [ ] **Step 3: Add the homepage result notice and remove the query from the address bar**

```js
const deletedCourse = new URLSearchParams(location.search).get('simDeletedCourse');
if (deletedCourse) {
  SampleUI.showToast('课程及其关联学习记录已永久删除（模拟）', 'success');
  history.replaceState({}, '', location.pathname);
}
```

- [ ] **Step 4: Run the regression test**

Run: `node docs/UI视觉预览/00-设计系统/tests/run-interaction-regression.mjs`

Expected: confirmation reaches the homepage and displays the simulation result.

### Task 3: Format and audit the unified change boundary

**Files:**

- Modify: `D:\workspace\Growth OS\Learning MORE\docs\UI视觉预览\02-课程创建与大纲\正式课程大纲.html`
- Modify: `D:\workspace\Growth OS\Learning MORE\docs\UI视觉预览\01-主页与全局导航\主页.html`
- Modify: `D:\workspace\Growth OS\Learning MORE\docs\UI视觉预览\00-设计系统\tests\run-interaction-regression.mjs`

- [ ] **Step 1: Format changed files**

Run: `node_modules\\.bin\\prettier.cmd --write "docs/UI视觉预览/02-课程创建与大纲/正式课程大纲.html" "docs/UI视觉预览/01-主页与全局导航/主页.html" "docs/UI视觉预览/00-设计系统/tests/run-interaction-regression.mjs"`

Expected: all files are formatted.

- [ ] **Step 2: Run interaction regression**

Run: `node docs/UI视觉预览/00-设计系统/tests/run-interaction-regression.mjs`

Expected: all checks pass.

- [ ] **Step 3: Audit changed paths before committing**

Run: `git -C "D:\workspace\Growth OS\Learning MORE" diff --check`

Expected: no whitespace errors. Review all changed paths and commit only the approved scope.
