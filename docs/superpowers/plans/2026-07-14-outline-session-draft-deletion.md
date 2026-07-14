# Outline Session Draft Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permanently delete an unconfirmed authoring session and all session-owned draft data after explicit confirmation, then return home.

**Architecture:** Add a dedicated deletion command and local transactional store operation. Expose it through the existing course-authoring HTTP/client boundary, then add a danger action and confirmation dialog to the existing authoring workspace.

**Tech Stack:** TypeScript, Fastify, Zod, React, Vitest, local transactional file store

## Global Constraints

- Only unconfirmed outline sessions may be deleted.
- Delete session, candidates, materials, generation tasks, and unshared artifacts atomically.
- Do not change the new-course form or formal-course deletion behavior.
- On success clear local draft cache and navigate to `/`.

---

### Task 1: Deletion contract and persistence

**Files:**
- Create: `apps/server/src/modules/course-authoring/ports/outline-session-draft-store.ts`
- Modify: `apps/server/src/persistence/course-archive-store.ts`
- Test: `apps/server/src/persistence/course-archive-store.contract.test.ts`

**Interfaces:**
- Produces: `OutlineSessionDraftStore.stageDelete(tx, outlineSessionId)`

- [ ] **Step 1: Add a failing contract test** that stores an unconfirmed session, candidates, materials, tasks and artifacts, runs one transaction, and asserts every owned record is gone while unrelated records remain.
- [ ] **Step 2: Implement `createLocalFileOutlineSessionDraftStore`** using the existing safe document scanner and transaction deletion paths.
- [ ] **Step 3: Reject confirmed sessions** with `outline_session_already_confirmed`.
- [ ] **Step 4: Run the contract test** with `pnpm vitest run apps/server/src/persistence/course-archive-store.contract.test.ts` and expect PASS.

### Task 2: Command and HTTP API

**Files:**
- Modify: `packages/contracts/src/course-authoring.ts`
- Modify: `apps/server/src/modules/course-authoring/interface.ts`
- Modify: `apps/server/src/modules/course-authoring/implementation/course-authoring-facade.ts`
- Modify: `apps/server/src/bootstrap/local-application.ts`
- Modify: `apps/server/src/http/routes/course-authoring.ts`
- Test: `apps/server/src/http/routes/course-authoring.test.ts`
- Test: `apps/server/src/modules/course-authoring/tests/course-authoring-facade.test.ts`

**Interfaces:**
- Produces: `DeleteOutlineSessionResponseSchema` and `DeleteOutlineSessionDraft` command

- [ ] **Step 1: Add failing facade and route tests** for success, version checking and confirmed-session rejection.
- [ ] **Step 2: Add the result schema** `{ outlineSessionId, deletedAt }`.
- [ ] **Step 3: Execute the deletion store inside the facade unit of work** after loading the session and checking `If-Match`.
- [ ] **Step 4: Register `DELETE /api/v1/outline-sessions/:sessionId`** and return the parsed response.
- [ ] **Step 5: Run targeted server tests** and expect PASS.

### Task 3: Authoring workspace deletion UI

**Files:**
- Create: `apps/web/src/features/course-authoring/delete-draft-dialog.tsx`
- Modify: `apps/web/src/client/course-authoring-client.ts`
- Modify: `apps/web/src/features/course-authoring/outline-workspace-view.tsx`
- Modify: `apps/web/src/features/course-authoring/authoring-page.tsx`
- Test: `apps/web/src/features/course-authoring/authoring-page.test.tsx`

**Interfaces:**
- Consumes: `CourseAuthoringClient.deleteOutlineSession`
- Produces: danger action, confirmation state, failure feedback, and success navigation

- [ ] **Step 1: Add a failing UI test** that clicks “删除草稿”, confirms, checks API arguments, and expects navigation to `/`.
- [ ] **Step 2: Add client DELETE method** with `If-Match` and response validation.
- [ ] **Step 3: Add the confirmation dialog** with permanent-deletion copy, cancel and danger confirm actions.
- [ ] **Step 4: Wire deletion into `AuthoringPage`** and clear `sessionStorage` only after success.
- [ ] **Step 5: Run authoring page and client tests** and expect PASS.

### Task 4: Regression verification

**Files:**
- Test: `apps/web/src/features/course-authoring/authoring-page.test.tsx`
- Test: `.superpowers/visual-qa/repro-course-chooser-scroll.mjs`

**Interfaces:**
- Consumes: completed backend and frontend deletion flow
- Produces: verified restore, delete and scroll behavior

- [ ] **Step 1: Run targeted server and web test suites.**
- [ ] **Step 2: Run TypeScript checking and linting.**
- [ ] **Step 3: Run the browser scroll reproduction.**
- [ ] **Step 4: Confirm restore-loading and restore-failure tests still pass.**

### Task 5: Home draft-card deletion

**Files:**
- Modify: `apps/web/src/features/home/home-page.tsx`
- Modify: `apps/web/src/features/home/home-page.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: `CourseAuthoringClient.deleteOutlineSession` and dashboard draft `resourceVersion`
- Produces: a card-level danger action that never triggers resume navigation

- [ ] **Step 1: Add a failing UI test** that opens “继续学习”, clicks a draft card’s “删除草稿”, confirms, and asserts the delete client receives the session id and resource version while navigation remains untouched.
- [ ] **Step 2: Split the draft card into separate resume and delete controls** without changing the formal-course card behavior.
- [ ] **Step 3: Reuse `DeleteDraftDialog`** and keep the draft card visible when deletion fails.
- [ ] **Step 4: Remove the deleted card from local chooser state on success** and reopen the chooser with the updated list.
- [ ] **Step 5: Run the home-page test, typecheck, lint, and browser fixture.**
- [ ] **Step 6: Replace the chooser footer close action with a fixed “返回主页” action** and verify it closes the chooser without navigation.
