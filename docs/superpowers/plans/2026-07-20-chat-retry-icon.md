# Chat Retry Icon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the font-dependent chat retry glyph with a consistent inline SVG icon and lightweight interaction styling.

**Architecture:** Define one reusable presentational `RetryIcon` in the shared chat component and consume it from both user-message and AI-message retry buttons. Keep retry state and callbacks unchanged; CSS owns sizing, hover, and focus treatment.

**Tech Stack:** React, TypeScript, CSS, Vitest, Testing Library

## Global Constraints

- Use a 16px inline SVG counter-clockwise arrow.
- Keep a 28×28px circular hit area.
- Preserve `aria-label` and `title` semantics for “重新发送” and “重新生成”.
- Add no icon dependency and make no retry business-logic changes.

---

### Task 1: Shared Retry Icon

**Files:**
- Modify: `apps/web/src/components/chat/chat.tsx`
- Modify: `apps/web/src/components/chat/chat.css`
- Modify: `apps/web/src/features/learning/lesson-session-workspace.tsx`
- Test: `apps/web/src/components/chat/chat.test.tsx`
- Test: `apps/web/src/features/learning/session-page.test.tsx`

**Interfaces:**
- Produces: `RetryIcon(): JSX.Element`, a decorative SVG with `aria-hidden="true"`.
- Consumes: existing `chat-user-action` buttons and retry callbacks without changing their signatures.

- [x] **Step 1: Write failing component assertions**

Replace the glyph assertion with:

```tsx
expect(screen.getByRole('button', { name: '重新发送' }).querySelector('svg')).not.toBeNull();
```

Add the equivalent assertion for the AI “重新生成” button in the lesson workspace test.

- [x] **Step 2: Run tests and verify failure**

Run:

```powershell
& '.\node_modules\.bin\vitest.CMD' run apps/web/src/components/chat/chat.test.tsx apps/web/src/features/learning/session-page.test.tsx --maxWorkers=1
```

Expected: FAIL because retry buttons still render the `↻` text glyph.

- [x] **Step 3: Add and reuse the SVG icon**

Add to `chat.tsx`:

```tsx
export function RetryIcon() {
  return (
    <svg aria-hidden="true" className="chat-retry-icon" viewBox="0 0 24 24">
      <path d="M4.75 8.5V4.75H8.5" />
      <path d="M5.1 8.1A8 8 0 1 1 4 14" />
    </svg>
  );
}
```

Replace both retry glyph spans with `<RetryIcon />`.

- [x] **Step 4: Apply lightweight button states**

Add CSS:

```css
.chat-retry-icon {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

.chat-user-action:hover {
  border-color: color-mix(in srgb, var(--lm-accent, var(--accent)) 36%, transparent);
  background: color-mix(in srgb, var(--lm-accent, var(--accent)) 9%, transparent);
}

.chat-user-action:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--lm-accent, var(--accent)) 50%, transparent);
  outline-offset: 2px;
}
```

- [x] **Step 5: Verify and commit**

Run the two focused tests, `corepack pnpm --filter @learning-more/web typecheck`, and `git diff --check`. Commit the plan and implementation together with message `fix(ui): refine chat retry icon`.
