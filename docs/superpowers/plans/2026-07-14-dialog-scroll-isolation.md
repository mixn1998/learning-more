# Dialog Scroll Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make standard dialog content scroll independently while the background remains fixed.

**Architecture:** Keep the existing shared Dialog markup. Correct its grid sizing and scroll containment in the shared stylesheet, with a CSS-driven page scroll lock while a standard backdrop exists.

**Tech Stack:** React, CSS Grid, Vitest, Playwright

## Global Constraints

- Do not redesign course cards or business screens.
- Preserve fixed dialog header/footer behavior.
- Restore background scrolling automatically when the dialog closes.

---

### Task 1: Shared dialog scroll contract

**Files:**
- Modify: `packages/ui/src/styles/components.css`
- Test: `.superpowers/visual-qa/repro-course-chooser-scroll.mjs`

**Interfaces:**
- Consumes: existing `.lm-dialog`, `.lm-dialog__body`, and `.lm-dialog-backdrop` markup
- Produces: a bounded `.lm-dialog__body` scroll container and background scroll isolation

- [ ] **Step 1: Run the failing browser reproduction**

Run: `node .superpowers/visual-qa/repro-course-chooser-scroll.mjs`
Expected: FAIL because `window.scrollY` changes and modal `scrollTop` remains zero.

- [ ] **Step 2: Constrain the dialog grid**

Add `grid-template-rows: auto minmax(0, 1fr) auto` to `.lm-dialog` and `overscroll-behavior: contain` to `.lm-dialog__body`.

- [ ] **Step 3: Lock the background while a standard backdrop exists**

Add `body:has(.lm-dialog-backdrop) { overflow: hidden; }` without changing custom dialog markup.

- [ ] **Step 4: Run the browser reproduction**

Run: `node .superpowers/visual-qa/repro-course-chooser-scroll.mjs`
Expected: PASS with unchanged background `scrollY` and increased modal `scrollTop`.

- [ ] **Step 5: Run UI package tests**

Run: `pnpm --filter @learning-more/ui test`
Expected: PASS.

