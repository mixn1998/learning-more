# Change-Aware Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the daily full-repository verifier with an explainable affected-file verifier while preserving an explicit full and release pipeline.

**Architecture:** A focused Node CLI discovers or accepts changed files, builds a verification plan, prints the selection, and runs scoped format, lint, related-test, package-typecheck, and conditional-gate commands. Root or ambiguous verification changes escalate to the unchanged full pipeline.

**Tech Stack:** Node.js ESM, Git, pnpm workspaces, Prettier, ESLint, Vitest 4, TypeScript.

## Global Constraints

- `pnpm verify` is affected-file verification.
- `pnpm verify:full` is behaviorally equivalent to the former `pnpm verify`.
- CI, release, portable packaging, and frontend acceptance use full verification.
- Explicit paths take precedence over dirty-worktree discovery.
- The verifier reports selected files, checks, and reasons and never edits source files.

---

### Task 1: Verification planner

**Files:**
- Create: `tools/verify-change.mjs`
- Create: `tools/verify-change.test.mjs`

**Interfaces:**
- Produces: `planAffectedVerification(repositoryRoot, inputPaths)` returning `{ files, formatFiles, lintFiles, testFiles, typecheckPackages, gates, fullReason }`.
- Produces: `discoverChangedFiles(repositoryRoot)` returning normalized repository-relative paths.

- [ ] **Step 1: Write planner tests**

```js
it('keeps documentation changes local', () => {
  expect(planAffectedVerification(root, ['docs/guide.md'])).toMatchObject({
    formatFiles: ['docs/guide.md'],
    lintFiles: [],
    testFiles: [],
    typecheckPackages: [],
    fullReason: undefined,
  });
});

it('includes downstream consumers for a contract change', () => {
  expect(planAffectedVerification(root, ['packages/contracts/src/learning-session.ts']))
    .toMatchObject({
      typecheckPackages: expect.arrayContaining([
        '@learning-more/contracts',
        '@learning-more/server',
        '@learning-more/web',
      ]),
      gates: expect.arrayContaining(['schema', 'architecture']),
    });
});

it('escalates verification-framework changes', () => {
  expect(planAffectedVerification(root, ['tools/verify-change.mjs']).fullReason)
    .toBe('verification_framework_changed');
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `node --test tools/verify-change.test.mjs`

Expected: FAIL because `tools/verify-change.mjs` does not exist.

- [ ] **Step 3: Implement path validation, workspace graph discovery, and plan selection**

```js
export function planAffectedVerification(repositoryRoot, inputPaths) {
  const files = normalizeRepositoryPaths(repositoryRoot, inputPaths);
  const workspaces = readWorkspacePackages(repositoryRoot);
  const owners = new Set(files.map((file) => owningWorkspace(workspaces, file)).filter(Boolean));
  const typecheckPackages = reverseDependencyClosure(workspaces, owners);
  return {
    files,
    formatFiles: files.filter(isPrettierFile),
    lintFiles: files.filter(isLintFile),
    testFiles: files.filter(isTestFile),
    typecheckPackages,
    gates: selectConditionalGates(files),
    fullReason: fullVerificationReason(files),
  };
}
```

- [ ] **Step 4: Implement CLI execution**

```js
const plan = planAffectedVerification(
  repositoryRoot,
  process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : await discoverChangedFiles(repositoryRoot),
);
printPlan(plan);
if (plan.fullReason !== undefined) runPnpm(['verify:full']);
else runAffectedChecks(plan);
```

- [ ] **Step 5: Run the planner tests**

Run: `node --test tools/verify-change.test.mjs`

Expected: PASS for path safety, docs-only, package ownership, downstream closure, conditional gates, and full escalation.

### Task 2: Command policy

**Files:**
- Modify: `package.json`
- Modify: `tools/test-suite-policy.test.mjs`
- Modify: `docs/superpowers/specs/2026-07-26-lightweight-test-suite-design.md`

**Interfaces:**
- Consumes: `node tools/verify-change.mjs [paths...]`.
- Produces: `verify`, `verify:full`, and `verify:release` script layers.

- [ ] **Step 1: Extend policy tests**

```js
expect(packageJson.scripts.verify).toBe('node tools/verify-change.mjs');
expect(packageJson.scripts['verify:full']).toContain('corepack pnpm format:check');
expect(packageJson.scripts['verify:release']).toContain('corepack pnpm verify:full');
expect(packageJson.scripts['ci:local']).toContain('corepack pnpm verify:full');
expect(packageJson.scripts['release:portable']).toContain('corepack pnpm verify:full');
expect(packageJson.scripts['frontend:acceptance']).toContain('corepack pnpm verify:full');
```

- [ ] **Step 2: Run the policy test and confirm it fails**

Run: `node_modules/.bin/vitest run tools/test-suite-policy.test.mjs`

Expected: FAIL because `verify:full` is not defined.

- [ ] **Step 3: Move the former full pipeline and update callers**

```json
{
  "verify": "node tools/verify-change.mjs",
  "verify:full": "corepack pnpm format:check && corepack pnpm lint && corepack pnpm typecheck && corepack pnpm schema:check && corepack pnpm architecture:check && corepack pnpm equivalence:check && corepack pnpm test && corepack pnpm build",
  "verify:release": "corepack pnpm verify:full && corepack pnpm test:capacity && corepack pnpm test:recovery && corepack pnpm frontend:acceptance:checks"
}
```

- [ ] **Step 4: Mark the old design as superseded and run policy tests**

Run: `node_modules/.bin/vitest run tools/test-suite-policy.test.mjs tools/verify-change.test.mjs`

Expected: PASS.

### Task 3: Verifier acceptance

**Files:**
- Test: `tools/verify-change.test.mjs`

- [ ] **Step 1: Run docs-only acceptance**

Run: `corepack pnpm verify -- docs/superpowers/specs/2026-07-27-change-aware-verification-design.md`

Expected: only the named Markdown file is format-checked.

- [ ] **Step 2: Run a scoped web acceptance**

Run: `corepack pnpm verify -- apps/web/src/features/learning/session-page.tsx`

Expected: Prettier, ESLint, related Vitest tests, and `@learning-more/web` typecheck run; unrelated server packages and the full build do not run.

- [ ] **Step 3: Run the mandatory framework-change full gate**

Run: `corepack pnpm verify -- tools/verify-change.mjs package.json`

Expected: the verifier reports `verification_framework_changed` and delegates to `verify:full`.
