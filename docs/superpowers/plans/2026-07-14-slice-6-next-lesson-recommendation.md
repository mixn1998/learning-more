# Slice 6: Next-Lesson Recommendation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace first-lesson defaults with an AI recommendation that considers course state and learner evidence while leaving the start decision to the user.

**Architecture:** A recommendation module builds a bounded candidate set, asks AI to rank it, deterministically validates eligibility, stores an expiring recommendation, and exposes explicit user selection/start actions.

**Tech Stack:** TypeScript, Zod, Fastify, React, Vitest.

---

### Task 1: Define eligible candidates and recommendation output

**Files:**
- Modify: `packages/contracts/src/home.ts`
- Create: `apps/server/src/modules/next-lesson/model/next-lesson-recommendation.ts`
- Create: `apps/server/src/modules/next-lesson/implementation/eligible-lessons.ts`
- Create: `apps/server/src/modules/next-lesson/tests/eligible-lessons.test.ts`

- [ ] Test prerequisite, completion, archive, availability, and already-active-session filters.
- [ ] Define recommendation versions with ranked eligible ids, rationale, evidence refs, confidence, expiry, and source snapshot hash.

### Task 2: Generate and commit recommendations at valid triggers

**Files:**
- Create: `apps/server/src/modules/next-lesson/implementation/ai-next-lesson-service.ts`
- Create: `apps/server/src/modules/next-lesson/tests/ai-next-lesson-service.test.ts`
- Modify: `apps/server/src/modules/course-authoring/implementation/confirm-course.ts`
- Modify: `apps/server/src/modules/course-authoring/implementation/revise-course-outline.ts`
- Modify: `apps/server/src/modules/review-closure/implementation/final-review-service.ts`

- [ ] Test triggers after course confirmation, outline revision, lesson completion/final Review, and schedule changes.
- [ ] Test AI rankings that include ineligible ids are rejected or filtered deterministically with an auditable warning.
- [ ] Replace `lessons[0]` defaults and store a recommendation; do not auto-start a lesson.

### Task 3: Expose choice and stale behavior

**Files:**
- Modify: `apps/server/src/bootstrap/http-routes.ts`
- Modify: `apps/web/src/features/home/home-page.tsx`
- Modify: `apps/web/src/features/home/home-page.test.tsx`

- [ ] Show recommendation rationale and alternatives; provide explicit start/select actions.
- [ ] Regenerate or mark stale when its source snapshot changes.
- [ ] Run focused tests and `rg -n "lessons\[0\]" apps/server/src/modules/course-authoring`; verify no default recommendation remains.
- [ ] Stage only Slice 6 files and commit with `git commit -m "feat: add evidence-aware next lesson recommendations"`.
