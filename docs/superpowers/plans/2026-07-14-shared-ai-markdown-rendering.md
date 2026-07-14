# Shared AI Markdown Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every raw user-visible AI response use one sanitized Markdown renderer and one semantic spacing system, while removing the old AI-specific serif/heading fonts and global bold prose.

**Architecture:** `AiContent` becomes a Markdown-only boundary backed by `ReactMarkdown` and `rehype-sanitize`; a separate `AiSurface` marks already-validated structured AI layouts without pretending to sanitize raw strings. Shared UI CSS owns Markdown hierarchy and spacing, while feature CSS owns only layout, color, and container treatment.

**Tech Stack:** React 19, TypeScript 5.9, `react-markdown`, `rehype-sanitize`, CSS design tokens, Vitest, Testing Library, Playwright.

## Global Constraints

- Do not change prompts, model output, generation count, streaming, persistence, teaching observation, teaching ledger, or Review state.
- Do not add a format-repair Agent, output observer, regex Markdown rewriter, raw HTML renderer, or `dangerouslySetInnerHTML`.
- Raw AI strings must enter `AiContent` through `markdown`; structured React layouts must enter `AiSurface` as React elements.
- `AiContent` must not accept `children`; TypeScript must reject `<AiContent>raw text</AiContent>`.
- Keep `ReactMarkdown` and `rehype-sanitize`; do not enable `rehype-raw`.
- Remove `--lm-font-ai-heading`, `--lm-font-ai-serif`, and AI prose weight 700 from production CSS.
- Keep `--lm-font-code` for code semantics.
- Preserve the dirty worktree; every commit stages only the exact files listed in its task.
- All user messages remain ordinary text; only assistant/AI output uses the shared Markdown boundary.

---

## File Structure

- `packages/ui/src/ai-content.tsx`: only raw Markdown rendering and sanitization.
- `packages/ui/src/ai-surface.tsx`: only the wrapper for already-structured, domain-validated AI layouts.
- `packages/ui/src/styles/typography.css`: the single Markdown hierarchy and spacing contract.
- Feature `.tsx` files: choose `AiContent` for strings or `AiSurface` for structured elements.
- Feature `.css` files: retain layout/color rules but no AI-specific font family or base prose weight.

---

### Task 1: Enforce the Shared Rendering Boundary

**Files:**
- Modify: `packages/ui/src/ai-content.tsx`
- Modify: `packages/ui/src/ai-content.test.tsx`
- Create: `packages/ui/src/ai-surface.tsx`
- Create: `packages/ui/src/ai-surface.test.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Produces: `AiContent(props: { markdown: string; className?: string }): JSX.Element`
- Produces: `AiSurfaceContent = ReactElement | readonly AiSurfaceContent[]`
- Produces: `AiSurface(props: { children: AiSurfaceContent; className?: string }): ReactElement`
- Preserves: `.lm-ai-content[data-ai-content="true"]`
- Adds: `.lm-ai-surface[data-ai-surface="true"]`

- [ ] **Step 1: Write failing renderer and type-boundary tests**

Replace the `AiContent` test body and add the type assertion:

```tsx
it('renders semantic Markdown and removes unsafe HTML', () => {
  const { container } = render(
    <AiContent
      markdown={'## 结论\n\n这是 **重点**。\n\n- 第一项\n- 第二项\n\n> 有边界的引用\n\n<script>alert(1)</script>'}
    />,
  );
  expect(screen.getByRole('heading', { name: '结论' })).toBeVisible();
  expect(screen.getByText('重点')).toHaveProperty('tagName', 'STRONG');
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
  expect(container.querySelector('blockquote')).toHaveTextContent('有边界的引用');
  expect(container.querySelector('script')).toBeNull();
});

// @ts-expect-error raw strings must use the markdown property
const invalidAiContent = <AiContent>raw AI text</AiContent>;
void invalidAiContent;
```

Create `ai-surface.test.tsx`:

```tsx
it('marks a validated structured AI layout without parsing its elements', () => {
  const { container } = render(
    <AiSurface>
      <section><h2>结构化结果</h2><p>已由领域 Schema 校验</p></section>
    </AiSurface>,
  );
  expect(container.querySelector('[data-ai-surface="true"]')).toBeVisible();
  expect(screen.getByRole('heading', { name: '结构化结果' })).toBeVisible();
});
```

- [ ] **Step 2: Run the focused tests and typecheck to verify failure**

Run:

```powershell
node node_modules/vitest/vitest.mjs run packages/ui/src/ai-content.test.tsx packages/ui/src/ai-surface.test.tsx
corepack pnpm --filter @learning-more/ui typecheck
```

Expected: the missing `AiSurface` module and the existing `AiContent.children` API cause failure.

- [ ] **Step 3: Make `AiContent` Markdown-only**

Use this component signature and implementation:

```tsx
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';

export function AiContent(props: {
  readonly markdown: string;
  readonly className?: string;
}) {
  const className = ['lm-ai-content', props.className].filter(Boolean).join(' ');
  return (
    <div className={className} data-ai-content="true">
      <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{props.markdown}</ReactMarkdown>
    </div>
  );
}
```

- [ ] **Step 4: Add `AiSurface` and export it**

Create:

```tsx
import type { ReactElement } from 'react';

export type AiSurfaceContent = ReactElement | readonly AiSurfaceContent[];

export function AiSurface(props: {
  readonly children: AiSurfaceContent;
  readonly className?: string;
}) {
  const className = ['lm-ai-surface', props.className].filter(Boolean).join(' ');
  return (
    <div className={className} data-ai-surface="true">
      {props.children}
    </div>
  );
}
```

Add `export * from './ai-surface.js';` to `packages/ui/src/index.ts`.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
node node_modules/vitest/vitest.mjs run packages/ui/src/ai-content.test.tsx packages/ui/src/ai-surface.test.tsx
```

Expected: both files pass; full UI typecheck may still fail until Tasks 3–5 migrate callers.

- [ ] **Step 6: Commit only the shared component boundary**

```powershell
git add packages/ui/src/ai-content.tsx packages/ui/src/ai-content.test.tsx packages/ui/src/ai-surface.tsx packages/ui/src/ai-surface.test.tsx packages/ui/src/index.ts
git commit -m "refactor: enforce shared AI rendering boundary"
```

---

### Task 2: Replace the AI Font Identity with Semantic Markdown Typography

**Files:**
- Modify: `packages/ui/src/styles/typography.css`
- Modify: `packages/ui/src/styles/typography.test.ts`

**Interfaces:**
- Consumes: `.lm-ai-content` from Task 1.
- Produces: one shared semantic contract for headings, paragraphs, lists, blockquotes, tables, inline code, and fenced code.

- [ ] **Step 1: Replace the old bold-font test with the new contract**

```ts
it('inherits the product font, uses regular prose, and keeps semantic spacing', () => {
  expect(css).not.toContain('--lm-font-ai-heading');
  expect(css).not.toContain('--lm-font-ai-serif');
  expect(css).not.toContain('--lm-ai-prose-weight');
  expect(css).toMatch(/\.lm-ai-content[\s\S]*?font-family:\s*inherit/);
  expect(css).toMatch(/\.lm-ai-content[\s\S]*?font-weight:\s*400/);
  expect(css).toMatch(/\.lm-ai-content :where\(p, ul, ol, blockquote, pre, table\)/);
  expect(css).toMatch(/\.lm-ai-content :where\(li \+ li\)/);
  expect(css).toMatch(/\.lm-ai-content :where\(code, pre, kbd, samp\)[\s\S]*?var\(--lm-font-code\)/);
});
```

- [ ] **Step 2: Run the typography test and verify it fails**

Run:

```powershell
node node_modules/vitest/vitest.mjs run packages/ui/src/styles/typography.test.ts
```

Expected: FAIL because the serif/heading variables and 700 prose weight still exist.

- [ ] **Step 3: Implement the shared semantic styles**

Keep the product and code variables, then use this base contract:

```css
:root {
  --lm-font-product: Inter, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  --lm-font-code: 'Cascadia Mono', Consolas, monospace;
  --lm-ai-block-gap: 0.8em;
  --lm-ai-section-gap: 1.35em;
}

.lm-ai-content,
.lm-ai-surface {
  min-width: 0;
  font-family: inherit;
  color: inherit;
  overflow-wrap: anywhere;
}

.lm-ai-content {
  font-size: 15px;
  font-weight: 400;
  line-height: 1.75;
  font-kerning: normal;
  letter-spacing: normal;
  text-rendering: optimizelegibility;
}

.lm-ai-content :where(h1, h2, h3, h4, h5, h6) {
  margin: var(--lm-ai-section-gap) 0 0.55em;
  font-family: inherit;
  font-weight: 700;
  color: var(--lm-ink);
}

.lm-ai-content h1 { font-size: 24px; line-height: 1.35; }
.lm-ai-content h2 { font-size: 20px; line-height: 1.4; }
.lm-ai-content h3 { font-size: 17px; line-height: 1.45; }
.lm-ai-content :where(h4, h5, h6) { font-size: 15px; line-height: 1.5; }

.lm-ai-content :where(p, ul, ol, blockquote, pre, table) {
  margin: 0 0 var(--lm-ai-block-gap);
}

.lm-ai-content :where(ul, ol) { padding-inline-start: 1.55em; }
.lm-ai-content :where(li + li) { margin-top: 0.35em; }
```

Retain the existing sanitized blockquote, table, code, and first/last-child rules, replacing only removed font variables. Set tables to `display: block; max-width: 100%; overflow-x: auto;` so wide output cannot break the page.

- [ ] **Step 4: Run focused tests**

Run:

```powershell
node node_modules/vitest/vitest.mjs run packages/ui/src/styles/typography.test.ts packages/ui/src/ai-content.test.tsx packages/ui/src/ai-surface.test.tsx
```

Expected: all pass.

- [ ] **Step 5: Commit the typography contract**

```powershell
git add packages/ui/src/styles/typography.css packages/ui/src/styles/typography.test.ts
git commit -m "style: unify semantic AI Markdown typography"
```

---

### Task 3: Migrate Course Creation and Outline Adjustment

**Files:**
- Modify: `apps/web/src/features/course-authoring/outline-workspace-view.tsx`
- Modify: `apps/web/src/features/course-authoring/outline-workspace-view.css`
- Modify: `apps/web/src/features/course-authoring/authoring-page.test.tsx`
- Modify: `apps/web/src/features/course/outline-revision-workspace.tsx`
- Modify: `apps/web/src/features/review/course-page.test.tsx`

**Interfaces:**
- Consumes: `AiContent({ markdown })` and `AiSurface({ children })` from Task 1.
- Preserves: current course-authoring transcript, candidate parser, confirmation controls, and outline-adjustment behavior.

- [ ] **Step 1: Add a failing course-creation Markdown regression test**

Change the restored assistant fixture to:

```ts
content:
  '这个问题先分清 **token 类型**：\n\n- 区块链 Token\n- AI Token\n\n> 玩法只是关注点。',
```

Then assert:

```ts
expect(await screen.findByText('token 类型')).toHaveProperty('tagName', 'STRONG');
expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
  '区块链 Token',
  'AI Token',
]);
expect(document.querySelector('.ow-ai blockquote')).toHaveTextContent('玩法只是关注点。');
expect(document.body).not.toHaveTextContent('**token 类型**');
```

- [ ] **Step 2: Run the authoring test and verify it fails**

Run:

```powershell
node node_modules/vitest/vitest.mjs run apps/web/src/features/course-authoring/authoring-page.test.tsx
```

Expected: the assistant string is not parsed into `strong`, `li`, and `blockquote` elements.

- [ ] **Step 3: Route assistant messages through Markdown**

Replace the assistant branch with:

```tsx
<AiContent
  key={message.messageId}
  className="ow-ai"
  markdown={message.content}
/>
```

Do not change the user bubble branch.

- [ ] **Step 4: Move structured candidate layouts to `AiSurface`**

Import `AiSurface`. In `outline-workspace-view.tsx`, change the structured candidate panel's opening `<AiContent className="ow-outline">` and matching closing tag to `AiSurface` without changing its existing title, chip, module, lesson, or source children. In `outline-revision-workspace.tsx`, make the same exact opening/closing-tag replacement for its empty/current/candidate structured layouts. Keep raw assistant adjustment messages on the existing `AiContent` call with `markdown={message.markdown}`.

- [ ] **Step 5: Remove course-authoring AI font overrides**

Delete every `font-family: var(--lm-font-ai-heading)` declaration from `outline-workspace-view.css`. Preserve sizes, layout, colors, borders, and spacing.

- [ ] **Step 6: Run course-authoring and outline-revision coverage**

Run:

```powershell
node node_modules/vitest/vitest.mjs run apps/web/src/features/course-authoring/authoring-page.test.tsx apps/web/src/features/review/course-page.test.tsx
corepack pnpm --filter @learning-more/web typecheck
```

Expected: tests and web typecheck pass for migrated callers or report only callers assigned to Tasks 4–5.

- [ ] **Step 7: Commit only course creation and outline adjustment files**

```powershell
git add apps/web/src/features/course-authoring/outline-workspace-view.tsx apps/web/src/features/course-authoring/outline-workspace-view.css apps/web/src/features/course-authoring/authoring-page.test.tsx apps/web/src/features/course/outline-revision-workspace.tsx apps/web/src/features/review/course-page.test.tsx
git commit -m "fix: render course authoring AI Markdown"
```

---

### Task 4: Migrate Formal Teaching, History, and Review

**Files:**
- Modify: `apps/web/src/features/learning/lesson-session-workspace.tsx`
- Modify: `apps/web/src/features/learning/lesson-session-workspace.css`
- Modify: `apps/web/src/features/learning/session-page.test.tsx`
- Modify: `apps/web/src/features/history/lesson-record-view.tsx`
- Modify: `apps/web/src/features/history/lesson-record-view.css`
- Modify: `apps/web/src/features/history/lesson-record.test.tsx`
- Modify: `apps/web/src/features/review/review-dialog.tsx`
- Modify: `apps/web/src/features/review/review-dialog.css`
- Modify: `apps/web/src/features/review/review-dialog.test.tsx`
- Modify: `apps/web/src/features/review/course-review-view.tsx`
- Modify: `apps/web/src/features/review/course-review-view.css`
- Modify: `apps/web/src/features/review/course-page.test.tsx`

**Interfaces:**
- Consumes: the Markdown-only `AiContent` and structured `AiSurface`.
- Preserves: teaching stream behavior, partial/interrupted messages, lesson archive immutability, Review actions, and course Review navigation.

- [ ] **Step 1: Add failing teaching, history, and Review semantic tests**

Use Markdown fixtures containing all required structures:

```ts
const markdown = '## 核心解释\n\n这是 **重点**。\n\n- 证据一\n- 证据二\n\n> 仍需验证';
```

Add assertions in the existing feature tests:

```ts
expect(screen.getByRole('heading', { name: '核心解释' })).toBeVisible();
expect(screen.getByText('重点')).toHaveProperty('tagName', 'STRONG');
expect(screen.getAllByRole('listitem')).toHaveLength(2);
expect(document.querySelector('blockquote')).toHaveTextContent('仍需验证');
```

For lesson records, prefix the fixture with `导师：`; for ReviewDialog, pass it through `markdown`.

- [ ] **Step 2: Run the focused tests and verify the plain-history branch fails**

Run:

```powershell
node node_modules/vitest/vitest.mjs run apps/web/src/features/learning/session-page.test.tsx apps/web/src/features/history/lesson-record.test.tsx apps/web/src/features/review/review-dialog.test.tsx apps/web/src/features/review/course-page.test.tsx
```

Expected: lesson history or child-based Review paths fail semantic assertions or TypeScript migration checks.

- [ ] **Step 3: Remove the lesson-history Markdown bypass**

Replace `ReadonlyMessage` with:

```tsx
function ReadonlyMessage({ value }: { readonly value: string }) {
  const assistant = value.startsWith('导师：');
  const content = assistant ? value.slice('导师：'.length) : value.replace(/^你：/u, '');
  return assistant ? (
    <div className="learn-ai">
      <AiContent markdown={content} />
    </div>
  ) : (
    <div className="learn-user">{content}</div>
  );
}
```

Delete `isPlainMarkdown`; every assistant message must take the same safe path.

- [ ] **Step 4: Separate static/structured content from raw Markdown**

- Replace the static “开始提问后…” placeholder in `lesson-session-workspace.tsx` with an ordinary `<p>`.
- Keep live and stored assistant strings on `AiContent`, passing the existing message string through its `markdown` property.
- In `LessonRecordView`, render `reviewContent` with `<AiSurface className="review-content">` and `finalReviewMarkdown` with `AiContent`.
- In `ReviewDialog`, render `content` with `<AiSurface className="review-markdown">` and `markdown` with `AiContent`.
- In `CourseReviewView`, replace the structured outer `AiContent` with `AiSurface`.

Change the optional structured props from `ReactNode` to the exported `AiSurfaceContent` so plain strings cannot enter `AiSurface`:

```tsx
import { AiContent, AiSurface, type AiSurfaceContent } from '@learning-more/ui';

readonly content?: AiSurfaceContent;
readonly reviewContent?: AiSurfaceContent;
```

- [ ] **Step 5: Remove feature-specific AI font declarations**

Delete all references to `--lm-font-ai-serif` and `--lm-font-ai-heading` from:

```text
apps/web/src/features/learning/lesson-session-workspace.css
apps/web/src/features/history/lesson-record-view.css
apps/web/src/features/review/review-dialog.css
apps/web/src/features/review/course-review-view.css
```

Retain container layout, padding, colors, and local section sizes.

- [ ] **Step 6: Run focused tests and web typecheck**

Run:

```powershell
node node_modules/vitest/vitest.mjs run apps/web/src/features/learning/session-page.test.tsx apps/web/src/features/history/lesson-record.test.tsx apps/web/src/features/review/review-dialog.test.tsx apps/web/src/features/review/course-page.test.tsx
corepack pnpm --filter @learning-more/web typecheck
```

Expected: all pass or identify only portrait callers assigned to Task 5.

- [ ] **Step 7: Commit the formal-course migration**

```powershell
git add apps/web/src/features/learning/lesson-session-workspace.tsx apps/web/src/features/learning/lesson-session-workspace.css apps/web/src/features/learning/session-page.test.tsx apps/web/src/features/history/lesson-record-view.tsx apps/web/src/features/history/lesson-record-view.css apps/web/src/features/history/lesson-record.test.tsx apps/web/src/features/review/review-dialog.tsx apps/web/src/features/review/review-dialog.css apps/web/src/features/review/review-dialog.test.tsx apps/web/src/features/review/course-review-view.tsx apps/web/src/features/review/course-review-view.css apps/web/src/features/review/course-page.test.tsx
git commit -m "fix: unify teaching and Review Markdown rendering"
```

---

### Task 5: Audit Weekly Reports, Portraits, and Every Remaining AI Caller

**Files:**
- Modify: `apps/web/src/features/profile/portrait-workspace.css`
- Modify: `apps/web/src/features/profile/portrait-view.test.tsx`
- Modify: `apps/web/src/features/history/history.test.tsx`

**Interfaces:**
- Consumes: `AiContent` for all weekly/portrait/evidence Markdown.
- Produces: zero production references to removed AI font variables and zero raw-string `AiContent` children.

- [ ] **Step 1: Strengthen weekly-report and portrait semantic tests**

Use Markdown-rich summaries and claims:

```ts
summary: '## 本周变化\n\n保持 **连续学习**。\n\n- 已完成复盘\n- 已调整计划',
markdown: '### 思维倾向\n\n> 当前证据有限。',
```

Assert the heading, `strong`, list items, and blockquote elements exist and their Markdown markers are absent from visible text.

- [ ] **Step 2: Run the profile/history tests and confirm the strengthened assertions**

Run:

```powershell
node node_modules/vitest/vitest.mjs run apps/web/src/features/profile/portrait-view.test.tsx apps/web/src/features/history/history.test.tsx
```

Expected: existing `markdown` callers should already pass; any failure identifies a remaining bypass to migrate in Step 4.

- [ ] **Step 3: Remove profile font identity overrides**

Delete every declaration using `--lm-font-ai-heading` or `--lm-font-ai-serif` from `portrait-workspace.css`. Preserve its workspace-specific section sizes, evidence layout, chips, and responsive behavior.

- [ ] **Step 4: Audit every production caller and migrate any remaining bypass**

Run:

```powershell
rg -n "<AiContent" apps/web/src packages/ui/src --glob "*.tsx"
rg -n "ReactMarkdown|dangerouslySetInnerHTML|rehypeRaw" apps/web/src packages/ui/src --glob "*.tsx"
rg -n "var\(--lm-font-ai-(heading|serif)\)|--lm-ai-prose-weight|font-weight:\s*700" apps/web/src packages/ui/src --glob "*.css"
```

Required interpretation:

- Every raw AI string appears as the value of the `markdown` property on `AiContent`.
- Every structured AI layout uses `AiSurface`.
- `ReactMarkdown` appears only in `packages/ui/src/ai-content.tsx`.
- `dangerouslySetInnerHTML`, `rehypeRaw`, removed AI font variables, and the AI prose-weight variable have zero production matches.
- A local heading may retain `font-weight: 700`; no `.lm-ai-content`, `.learn-ai`, `.review-markdown`, or `.review-content` base container may force all prose to 700.

- [ ] **Step 5: Run all renderer and affected feature tests**

Run:

```powershell
node node_modules/vitest/vitest.mjs run packages/ui/src/ai-content.test.tsx packages/ui/src/ai-surface.test.tsx packages/ui/src/styles/typography.test.ts apps/web/src/features/course-authoring/authoring-page.test.tsx apps/web/src/features/learning/session-page.test.tsx apps/web/src/features/history/lesson-record.test.tsx apps/web/src/features/review/review-dialog.test.tsx apps/web/src/features/review/course-page.test.tsx apps/web/src/features/profile/portrait-view.test.tsx apps/web/src/features/history/history.test.tsx
```

Expected: all pass.

- [ ] **Step 6: Commit the final caller/font audit**

Stage only files actually changed in this task, beginning with:

```powershell
git add apps/web/src/features/profile/portrait-workspace.css apps/web/src/features/profile/portrait-view.test.tsx apps/web/src/features/history/history.test.tsx
git commit -m "style: complete AI Markdown caller audit"
```

If Step 4 changed additional production callers, add those exact paths to the same `git add` command after reviewing `git diff --name-only`.

---

### Task 6: Full Regression and Visual Acceptance

**Files:**
- Modify: `tests/visual/react-pages.spec.ts`
- Update: affected PNG files under `tests/visual/baselines/`
- Update after verified success: `docs/superpowers/reports/2026-07-14-ai-control-chain-vertical-slices-implementation.md`

**Interfaces:**
- Consumes: completed Tasks 1–5.
- Produces: repository-wide proof that the rendering boundary did not alter AI business control chains.

- [ ] **Step 1: Run formatting and static gates**

Run:

```powershell
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
```

Expected: exit `0` for all three.

- [ ] **Step 2: Run schema, architecture, and equivalence gates**

Run:

```powershell
corepack pnpm schema:check
corepack pnpm architecture:check
corepack pnpm equivalence:check
```

Expected: exit `0`; no data contract or business-boundary change is required by this presentation-only feature.

- [ ] **Step 3: Run all unit tests and production builds**

Run:

```powershell
corepack pnpm test
corepack pnpm build
```

Expected: exit `0`; no cancelled task or fake AI result path is introduced.

- [ ] **Step 4: Run UI and browser acceptance**

First ensure ports `43120` and `5173` are not occupied by stale test processes. Replace the legacy SimHei/SimSun/Times font-readiness assertion in `tests/visual/react-pages.spec.ts` with a computed-style assertion on pages that contain `.lm-ai-content`:

```ts
const aiContent = page.locator('.lm-ai-content').first();
if ((await aiContent.count()) > 0) {
  const typography = await aiContent.evaluate((element) => {
    const style = getComputedStyle(element);
    return { fontFamily: style.fontFamily, fontWeight: style.fontWeight };
  });
  expect(typography.fontFamily).not.toMatch(/SimHei|SimSun|Times New Roman|黑体|宋体/iu);
  expect(typography.fontWeight).toBe('400');
}
```

Run functional UI checks:

```powershell
corepack pnpm product-ui:check
corepack pnpm playwright:test
```

Expected: exit `0`. The course-creation transcript shows `strong`, `ul/li`, and `blockquote` DOM elements; no literal `**` markers are visible.

Regenerate only the affected visual states and inspect every changed image before accepting it:

```powershell
corepack pnpm visual:react -- --update-snapshots -g "authoring-|course-revision|course-review|weekly-report|portrait|lesson-session|lesson-review-dialog|lesson-record"
corepack pnpm visual:react
```

Expected: both commands exit `0`; formal teaching, Review, weekly report, portrait, and course-authoring pages remain usable at desktop, tablet, and mobile widths.

- [ ] **Step 5: Record verified evidence, not expected results**

Update the implementation report only with the exact current test-file/test-count output and the actual results of every gate above. Add the rendering invariant:

```markdown
- 原始 AI 文本统一经 `AiContent -> ReactMarkdown -> rehype-sanitize`；结构化 AI 结果使用 `AiSurface`。
- 生产 CSS 不再包含 AI 专属宋体、Times New Roman、黑体或 AI 正文 700 字重。
```

- [ ] **Step 6: Review scope and commit acceptance evidence**

Run:

```powershell
git diff --check
git status --short
```

Stage the visual assertion, affected baselines, and acceptance report:

```powershell
git add tests/visual/react-pages.spec.ts tests/visual/baselines docs/superpowers/reports/2026-07-14-ai-control-chain-vertical-slices-implementation.md
git commit -m "docs: verify shared AI Markdown rendering"
```

Do not stage unrelated dirty-worktree files.
