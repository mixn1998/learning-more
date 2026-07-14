# Home Prompt and Course Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved 12px prompt-title inset and the selected action-oriented course cards with real progress and recent-learning data.

**Architecture:** Extend the home lesson contract with one optional activity timestamp, calculate it from persisted learning intervals on the server, and aggregate course-level presentation data in a focused web model. Keep navigation semantics in `HomePage`, while CSS owns the 144px card geometry, progress treatment, responsive layout, and prompt-title alignment.

**Tech Stack:** TypeScript 5.9, Zod 4, React 19, CSS, Vitest, Testing Library, Vite, Playwright

## Global Constraints

- Preserve all unrelated uncommitted workspace changes.
- `.prompt-head strong` receives exactly `12px` left padding and `.prompt-head` uses baseline alignment.
- Formal course cards use a desktop minimum height of `144px` and expose real progress, real recent-learning time, a progress bar, and a next action.
- Draft cards do not claim lesson progress or recent-learning time.
- Recent learning is derived only from lesson learning intervals: `endedAt ?? startedAt`.
- Do not substitute course update, course creation, dashboard generation, or schedule timestamps for learning activity.
- Mobile cards remain single-column, unclipped, and action-oriented.

---

### Task 1: Carry real lesson activity through the home API

**Files:**
- Create: `packages/contracts/src/home.test.ts`
- Modify: `packages/contracts/src/home.ts:5-14`
- Create: `apps/server/src/bootstrap/home-dashboard.ts`
- Create: `apps/server/src/bootstrap/home-dashboard.test.ts`
- Modify: `apps/server/src/bootstrap/local-application.ts:1242-1280`

**Interfaces:**
- Consumes: `LearningTimeInterval` values with `startedAt: string` and optional `endedAt: string`.
- Produces: `latestLearningActivityAt(intervals): string | undefined` and optional `HomeLesson.lastActivityAt`.

- [ ] **Step 1: Add failing contract and projection tests**

Create `packages/contracts/src/home.test.ts` with a valid dashboard fixture whose lesson contains `lastActivityAt: '2026-07-12T12:30:00.000Z'`, and assert `HomeDashboardResponseSchema.parse(fixture).lessons[0].lastActivityAt` equals that value. Add a second assertion that an invalid timestamp throws.

Create `apps/server/src/bootstrap/home-dashboard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { latestLearningActivityAt } from './home-dashboard.js';

describe('home dashboard activity projection', () => {
  it('uses the latest ended or active interval timestamp', () => {
    expect(
      latestLearningActivityAt([
        { id: 'i1', sessionId: 's1', startedAt: '2026-07-12T09:00:00.000Z', endedAt: '2026-07-12T09:30:00.000Z', endReason: 'paused', recovered: false },
        { id: 'i2', sessionId: 's2', startedAt: '2026-07-12T12:30:00.000Z', recovered: false },
      ]),
    ).toBe('2026-07-12T12:30:00.000Z');
  });

  it('returns undefined when no learning interval exists', () => {
    expect(latestLearningActivityAt([])).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the focused tests and confirm red state**

Run:

```powershell
corepack pnpm vitest run packages/contracts/src/home.test.ts apps/server/src/bootstrap/home-dashboard.test.ts
```

Expected: failures because `lastActivityAt` and `latestLearningActivityAt` do not exist.

- [ ] **Step 3: Implement the contract and server projection**

Add to `HomeLessonSchema`:

```ts
lastActivityAt: z.iso.datetime({ offset: true }).optional(),
```

Create `apps/server/src/bootstrap/home-dashboard.ts`:

```ts
import type { LearningTimeInterval } from '../modules/learning-session/implementation/time-intervals.js';

export function latestLearningActivityAt(
  intervals: readonly LearningTimeInterval[],
): string | undefined {
  return intervals
    .map((interval) => interval.endedAt ?? interval.startedAt)
    .sort((left, right) => right.localeCompare(left))[0];
}
```

Import the helper into `local-application.ts`. When building each lesson, calculate:

```ts
const lastActivityAt = latestLearningActivityAt(learning?.intervals ?? []);
```

and spread it only when defined:

```ts
...(lastActivityAt === undefined ? {} : { lastActivityAt }),
```

- [ ] **Step 4: Run contract and server tests**

Run:

```powershell
corepack pnpm vitest run packages/contracts/src/home.test.ts apps/server/src/bootstrap/home-dashboard.test.ts apps/server/src/http/routes/home.test.ts
```

Expected: all selected tests pass.

---

### Task 2: Build a tested course-choice presentation model

**Files:**
- Create: `apps/web/src/features/home/course-choice-model.ts`
- Create: `apps/web/src/features/home/course-choice-model.test.ts`
- Modify: `apps/web/src/features/home/home-page.tsx:12-21, 403-477`
- Modify: `apps/web/src/features/home/home-page.test.tsx`

**Interfaces:**
- Consumes: `courseId` plus `HomeLessonCandidate[]`, including optional `lastActivityAt`.
- Produces: `buildCourseChoiceModel(courseId, lessons)` returning `lessonCount`, `completedLessonCount`, `progressPercent`, `lastActivityAt`, and `nextLesson`.

- [ ] **Step 1: Write failing model tests**

Cover four cases in `course-choice-model.test.ts`:

```ts
expect(buildCourseChoiceModel('course_01', lessons)).toMatchObject({
  lessonCount: 5,
  completedLessonCount: 2,
  progressPercent: 40,
  lastActivityAt: '2026-07-12T12:30:00.000Z',
  nextLesson: expect.objectContaining({ lessonId: 'active' }),
});
```

Also assert: an unstarted course has `progressPercent: 0` and no `lastActivityAt`; the recommended unstarted lesson is selected when no active session exists; lessons from another course are ignored.

- [ ] **Step 2: Run the model test and confirm red state**

Run:

```powershell
corepack pnpm --filter @learning-more/web test -- course-choice-model.test.ts
```

Expected: failure because the model module does not exist.

- [ ] **Step 3: Implement the pure model**

Implement the exact return shape:

```ts
export type HomeLessonCandidate = Readonly<{
  courseId: string;
  lessonId: string;
  title?: string;
  progress: 'not_started' | 'in_progress' | 'abandoned' | 'completed';
  sessionId?: string;
  recommended?: boolean;
  lastActivityAt?: string;
}>;

export type CourseChoiceModel = Readonly<{
  lessonCount: number;
  completedLessonCount: number;
  progressPercent: number;
  lastActivityAt?: string;
  nextLesson?: HomeLessonCandidate;
}>;
```

The model module owns and exports `HomeLessonCandidate`; `home-page.tsx` imports it and re-exports the type so existing visual fixtures keep their current import path. Filter lessons by course, compute completed count and rounded percentage, take the lexically greatest ISO `lastActivityAt`, and choose `nextLesson` by active-session priority followed by recommended-unstarted priority.

- [ ] **Step 4: Render action-oriented formal and draft cards**

In `HomePage`, add `lastActivityAt?: string` to `HomeLessonCandidate`. For each course, build the model and render:

```tsx
<span className="course-choice-content">
  <b>{course.title}</b>
  <span className="course-choice-meta">{progressLabel}</span>
  <span
    aria-label={`课程进度 ${model.progressPercent}%`}
    aria-valuemax={100}
    aria-valuemin={0}
    aria-valuenow={model.progressPercent}
    className="course-choice-progress"
    role="progressbar"
  >
    <span style={{ width: `${model.progressPercent}%` }} />
  </span>
  <span className="course-choice-action">
    {model.nextLesson === undefined ? '查看课程大纲 →' : `下一课：${model.nextLesson.title ?? model.nextLesson.lessonId} →`}
  </span>
</span>
```

Format recent activity as `MM/DD HH:mm` in `Asia/Shanghai`. Draft cards render a state label and `继续完成大纲建档 →` without a progress bar.

- [ ] **Step 5: Add component assertions**

Extend `home-page.test.tsx` to open the chooser and assert:

- `已完成 2/5 节` and `最近学习 07/12 20:30` are visible;
- the progress bar exposes `aria-valuenow="40"`;
- the action contains the active lesson title;
- a draft card contains `继续完成大纲建档` and has no descendant progress bar;
- clicking a formal card still navigates to the active lesson, while a no-target course navigates to its outline.

- [ ] **Step 6: Run web model and component tests**

Run:

```powershell
corepack pnpm --filter @learning-more/web test -- course-choice-model.test.ts home-page.test.tsx
```

Expected: all selected web tests pass.

---

### Task 3: Apply selected C-card styling and prompt-title alignment

**Files:**
- Modify: `apps/web/src/styles.css:78-87, 408-466`
- Verify: `apps/web/src/features/home/home-page.tsx`

**Interfaces:**
- Consumes: `.course-choice-content`, `.course-choice-meta`, `.course-choice-progress`, and `.course-choice-action` from Task 2.
- Produces: 144px desktop cards, responsive mobile cards, selected/in-progress emphasis, and the approved prompt-title geometry.

- [ ] **Step 1: Implement the prompt-title rules**

Change `.prompt-head` to `align-items: baseline` and add `padding-left: 12px` to `.prompt-head strong` without moving the input or badge.

- [ ] **Step 2: Implement the selected C-card geometry**

Set `.course-choice` to `min-height: 144px`, `padding: 22px 24px`, `align-items: start`, and `border-radius: 14px`. Add a 3px inset left accent for `.in-progress`, 17px title text, 12px metadata, a 5px rounded progress track, and an action row separated by a top border. Keep status badges top-aligned and non-wrapping.

- [ ] **Step 3: Add responsive rules**

At `max-width: 720px`, use `min-height: 0`, `padding: 18px`, a smaller inter-column gap, and preserve the two-column title/badge relationship without clipping.

- [ ] **Step 4: Run focused validation**

Run:

```powershell
corepack pnpm --filter @learning-more/contracts test
corepack pnpm --filter @learning-more/server test -- home-dashboard.test.ts home.test.ts
corepack pnpm --filter @learning-more/web test -- course-choice-model.test.ts home-page.test.tsx
corepack pnpm --filter @learning-more/web typecheck
```

Expected: all commands pass.

- [ ] **Step 5: Render and inspect desktop and mobile cards**

Open `/__visual/home-ready`, open the course chooser, and inspect at `1440x1000` and `390x844`. Verify 144px desktop card height, correct progress width, true recent-learning text, no overlap, readable action rows, and the 12px prompt-title inset with baseline alignment.

- [ ] **Step 6: Review the final patch**

Run:

```powershell
git diff --check -- packages/contracts/src/home.ts packages/contracts/src/home.test.ts apps/server/src/bootstrap/home-dashboard.ts apps/server/src/bootstrap/home-dashboard.test.ts apps/server/src/bootstrap/local-application.ts apps/web/src/features/home/course-choice-model.ts apps/web/src/features/home/course-choice-model.test.ts apps/web/src/features/home/home-page.tsx apps/web/src/features/home/home-page.test.tsx apps/web/src/styles.css
```

Expected: no whitespace errors and no unrelated files in the scoped diff.
