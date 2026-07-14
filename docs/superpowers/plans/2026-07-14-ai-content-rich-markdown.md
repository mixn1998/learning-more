# AI Rich Markdown Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the shared AI Markdown renderer display tables, math, and code safely across every AI surface, with Mermaid/diagram fences preserved as readable code fallback.

**Architecture:** Extend `@learning-more/ui`'s `AiContent` with remark/rehype plugins and an explicit Mermaid code-fence fallback marker. Keep the renderer as the sole output boundary; diagram source remains readable without adding a heavyweight runtime, while Markdown content remains unconstrained.

**Tech Stack:** React 19, react-markdown, remark-gfm, remark-math, rehype-katex, katex, rehype-sanitize, CSS.

## Global Constraints

- Do not add a teaching prompt or constrain AI content shape.
- Do not create page-specific Markdown renderers.
- Do not enable raw HTML or Mermaid HTML labels.
- Preserve ordinary Markdown and code-fence behavior.

---

### Task 1: Add rich Markdown dependencies and parser regression tests

**Files:**
- Modify: `packages/ui/package.json`
- Modify: `pnpm-lock.yaml`
- Test: `packages/ui/src/ai-content.test.tsx`

- [ ] Add `remark-gfm`, `remark-math`, `rehype-katex`, and `katex` to the UI package.
- [ ] Add tests asserting a table renders a `<table>`, math renders KaTeX output, and code remains a `<pre><code>` block.
- [ ] Add a Mermaid test seam that verifies diagram fences preserve the source code as a safe fallback.

### Task 2: Implement the shared safe renderer

**Files:**
- Modify: `packages/ui/src/ai-content.tsx`
- Create: `packages/ui/src/mermaid-diagram.tsx`
- Modify: `packages/ui/src/index.ts`

- [ ] Configure `ReactMarkdown` with GFM and math plugins, sanitize before KaTeX output, and provide explicit code/table class names.
- [ ] Detect `language-mermaid` fences and mark them as a diagram code fallback.
- [ ] Keep diagram source copyable and do not execute HTML, scripts, or links from AI output.
- [ ] Keep all non-Mermaid fences as normal code blocks.

### Task 3: Add shared visual styles

**Files:**
- Modify: `packages/ui/src/styles.css` (or the existing UI stylesheet imported by `AiContent`)

- [ ] Style tables with semantic header/body spacing and an overflow wrapper.
- [ ] Style KaTeX blocks and diagram code fallbacks with horizontal scrolling and readable empty/error states.
- [ ] Ensure code blocks preserve wrapping/scroll behavior without altering prose typography.

### Task 4: Verify all consumers

**Files:**
- Test: `apps/web/src/features/course-authoring/authoring-page.test.tsx`
- Test: `apps/web/src/features/learning/session-page.test.tsx`
- Test: `apps/web/src/features/review/review-dialog.test.tsx`
- Test: `apps/web/src/features/profile/portrait-view.test.tsx`

- [ ] Add one consumer-level assertion that a candidate table renders semantically rather than as pipe text.
- [ ] Run UI tests, web typecheck/build, and server typecheck.
- [ ] Confirm no page imports a second Markdown renderer.
