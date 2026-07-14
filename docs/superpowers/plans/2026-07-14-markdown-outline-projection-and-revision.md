# Markdown Outline Projection and Revision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Project every outline from its saved Markdown and make course revisions inherit, compare, and publish from the current outline version.

**Architecture:** A pure Markdown projection module becomes the only module/lesson grouping seam for course UI. A revision-specific authoring command seeds an outline session from the current version's source candidate, allowing the existing alignment and generation runtime to create v2 from v1. A pure Markdown diff module drives change labels without persisting structured modules.

**Tech Stack:** TypeScript, React, Zod, Fastify, existing course-authoring aggregates and generation runtime, Vitest.

## Global Constraints

- Do not persist structured `modules` in confirmed course or outline-version storage.
- Do not infer modules from a fixed lesson count.
- Keep lesson name, summary, and keywords as lightweight Markdown readability guidance, not a fixed outline schema.
- Preserve and render complete Markdown even when navigation parsing is partial.
- Do not publish or mutate v1 until the user explicitly publishes v2.
- Preserve every prior outline version as a read-only historical version.

---

### Task 1: Markdown projection and diff

**Files:**
- Create: `apps/web/src/features/course/outline-markdown-projection.ts`
- Create: `apps/web/src/features/course/outline-markdown-projection.test.ts`
- Create: `apps/web/src/features/course/outline-markdown-diff.ts`
- Create: `apps/web/src/features/course/outline-markdown-diff.test.ts`

**Interfaces:**
- Produces: `projectOutlineMarkdown(markdown, lessons?)` and `diffOutlineMarkdown(base, candidate)`.

- [x] Write tests for uneven module sizes, nested headings, list-based lessons, ungrouped fallback, and all four diff states.
- [x] Run the focused tests and verify they fail because the modules do not exist.
- [x] Implement heading-tree parsing, lesson matching, complete-section slicing, and conservative diff matching.
- [x] Run the focused tests and verify they pass.

### Task 2: Formal-course projection

**Files:**
- Modify: `apps/web/src/features/course/outline-view.tsx`
- Modify: `apps/web/src/features/course/formal-course-view.tsx`
- Modify: `apps/web/src/features/review/course-page.tsx`
- Modify: `apps/web/src/visual/course-fixture.tsx`
- Modify: relevant tests under `apps/web/src/features/course` and `apps/web/src/features/review`

**Interfaces:**
- Consumes: `projectOutlineMarkdown(course.outlineMarkdown, course.lessons)`.

- [x] Add a page test with module sizes 1/3/2 and original Markdown module titles.
- [x] Delete `defaultModules`, `offset += 2`, and caller-supplied synthetic module projection.
- [x] Render parsed modules and place unmatched lessons in one “未分组课程” section.
- [x] Verify no two-lesson grouping remains with `rg` and focused tests.

### Task 3: Revision-session baseline

**Files:**
- Modify: `packages/contracts/src/course-authoring.ts`
- Modify: `apps/server/src/modules/course-authoring/interface.ts`
- Modify: `apps/server/src/modules/course-authoring/model/outline-session.ts`
- Modify: `apps/server/src/modules/course-authoring/implementation/course-authoring-facade.ts`
- Modify: `apps/server/src/http/routes/course-authoring.ts`
- Modify: `apps/web/src/client/course-authoring-client.ts`
- Modify: server and client contract tests.

**Interfaces:**
- Produces: `CreateOutlineAdjustmentSession` and `POST /api/v1/courses/:courseId/outline-adjustment-sessions`.

- [x] Add a failing test that creates an adjustment session from the current outline version.
- [x] Add a domain constructor that starts `candidate-ready` with the current source candidate as baseline.
- [x] Implement facade and route loading with course-version precondition checks.
- [x] Add the client method and verify the returned session is ready for alignment.

### Task 4: Revision UI and real change labels

**Files:**
- Modify: `apps/web/src/features/review/course-page.tsx`
- Modify: `apps/web/src/features/course/outline-revision-workspace.tsx`
- Modify: `apps/web/src/features/course/outline-revision-workspace.css`
- Modify: `apps/web/src/features/review/course-page.test.tsx`

**Interfaces:**
- Consumes: current v1 Markdown, candidate v2 Markdown, and `diffOutlineMarkdown`.

- [x] Add tests proving v1 is fully rendered before any user message.
- [x] Replace blank `createOutlineSession` with `createOutlineAdjustmentSession`.
- [x] Replace `candidateFromSession` and hard-coded change labels with Markdown projection/diff.
- [x] Render v1, v2, and unchanged/modified/added/removed badges; keep removed entries visible in comparison.
- [x] Verify publish still uses the v2 candidate ID and retains v1 history.

### Task 5: Full replay verification

**Files:**
- Modify: `apps/server/src/modules/course-authoring/tests/course-authoring-facade.test.ts`
- Modify: `apps/server/src/modules/course-authoring/tests/generation-authoring-agent.test.ts`
- Modify: `apps/server/src/http/routes/course-authoring.test.ts`
- Modify: `apps/web/src/features/review/course-page.test.tsx`

- [x] Prove the adjustment generation prompt includes current v1 Markdown.
- [x] Prove generation failure leaves v1 visible and unchanged.
- [x] Prove publishing v2 leaves v1 readable through the historical-version endpoint.
- [x] Prove concurrent alignment/reply generation atomically claims two different queued tasks.
- [x] Run server tests/typecheck and web tests/typecheck/build.
- [x] Run `git diff --check` and search for all fixed grouping remnants.
