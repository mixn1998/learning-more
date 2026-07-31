# Workspace Responsibility Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize Learning MORE into clear product, operations, engineering, documentation, and local-state boundaries while removing obsolete documentation and the retired static UI sample test stage.

**Architecture:** Keep deployable applications under `apps/` and reusable product code under `packages/`. Move operational scripts beside `operations/maintenance`, move repository verification and cross-application tests under `engineering/`, and keep only current human-facing documents under `docs/`. Preserve user data paths during this repository-only migration; consolidate rebuildable output under ignored `.local/` paths.

**Tech Stack:** pnpm workspaces, Node.js ESM, TypeScript, Vitest, Playwright, GitHub Actions, PowerShell.

## Global Constraints

- Do not refactor product-domain internals.
- Do not delete or rewrite `.learning-more-data/`, `.learning-more-backups/`, `.learning-more-runtime/`, or installed-instance data.
- Remove the static `docs/UI视觉预览` sample and audit stage.
- Keep real React-page E2E and accessibility coverage.
- Do not leave compatibility copies, duplicate directories, or dead package scripts.
- Git history is the archive for deleted process documents.

---

## File Structure

- `operations/scripts/`: runtime entry scripts, projection/backfill scripts, and their focused tests.
- `engineering/verification/`: change-aware verification, product-source checks, workspace checks, and policy tests.
- `engineering/tests/e2e/`: cross-application Playwright workflows.
- `engineering/tests/recovery/`: host and maintenance recovery tests.
- `engineering/tests/performance/`: capacity gates.
- `engineering/tests/visual/`: retained React-page and accessibility checks only.
- `engineering/testing/`: Playwright configuration files.
- `engineering/architecture/fixtures/`: executable equivalence contracts.
- `.local/artifacts/`: ignored local reports.
- `.local/generated/release/`: ignored portable release output.
- `.local/cache/`: ignored rebuildable tool caches where commands support an explicit path.
- `docs/`: current architecture/security/maintenance documentation only.

### Task 1: Retire static UI sample verification

**Files:**
- Delete: `docs/UI视觉预览/**`
- Delete: `tests/visual/html-baseline.spec.ts`
- Modify: `tests/visual/design-system-components.spec.ts`
- Modify: `tests/visual/home-mode-themes.spec.ts`
- Modify: `playwright.visual.config.ts`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: React visual routes served by `@learning-more/web` on port `61587`.
- Produces: A visual configuration with no dependency on `docs/UI视觉预览` or port `61586`.

- [ ] **Step 1: Identify tests that still open the retired HTML sample server**

Run:

```powershell
rg -n "61586|UI视觉预览|htmlBaseUrl|html-baseline|ui-samples" tests package.json .github playwright.visual.config.ts
```

Expected: only the files listed in this task are reported.

- [ ] **Step 2: Remove HTML-only assertions and server configuration**

Set the retained visual configuration to one server:

```ts
webServer: externalServers
  ? undefined
  : {
      command: 'corepack pnpm --filter @learning-more/web dev:visual',
      port: 61_587,
      reuseExistingServer: true,
      timeout: 30_000,
    },
```

Delete HTML-sample branches from mixed tests; keep their React assertions.

- [ ] **Step 3: Remove the retired command from package and CI composition**

`frontend:acceptance:checks` must become:

```json
"frontend:acceptance:checks": "corepack pnpm supply-chain:check && corepack pnpm product-ui:check && corepack pnpm playwright:test && corepack pnpm playwright:runtime && corepack pnpm visual:test"
```

Delete `ui-samples:verify` and the dedicated CI step that runs it.

- [ ] **Step 4: Delete sample files and verify no references remain**

Run:

```powershell
rg -n "61586|UI视觉预览|ui-samples:verify|html-baseline" . --glob "!node_modules/**" --glob "!.git/**"
```

Expected: no matches.

### Task 2: Move cross-application tests and configurations into engineering

**Files:**
- Move: `tests/e2e/**` → `engineering/tests/e2e/**`
- Move: `tests/recovery/**` → `engineering/tests/recovery/**`
- Move: `tests/performance/**` → `engineering/tests/performance/**`
- Move: `tests/support/**` → `engineering/tests/support/**`
- Move: retained `tests/visual/**` → `engineering/tests/visual/**`
- Move: `playwright.config.ts` → `engineering/testing/playwright.config.ts`
- Move: `playwright.runtime.config.ts` → `engineering/testing/playwright.runtime.config.ts`
- Move: `playwright.visual.config.ts` → `engineering/testing/playwright.visual.config.ts`
- Modify: `package.json`
- Modify: `vitest.config.ts`
- Modify: `.github/workflows/*.yml`
- Modify: `engineering/architecture/src/report-equivalence.ts`
- Modify: tests that assert repository paths

**Interfaces:**
- Consumes: repository root as `process.cwd()`.
- Produces: all cross-application tests below `engineering/tests`, invoked through explicit configs.

- [ ] **Step 1: Move tracked test trees with Git-preserving renames**

Use exact source and destination paths inside the repository and verify each resolved path begins with the repository root before moving.

- [ ] **Step 2: Rewrite Playwright configs for their new location**

Use root-relative test paths:

```ts
testDir: path.join(process.cwd(), 'engineering/tests/e2e')
```

Use root-relative support imports:

```ts
import { resolveE2eEnvironment } from '../tests/support/e2e-environment.js';
```

- [ ] **Step 3: Update package scripts**

Use:

```json
"playwright:test": "corepack pnpm --filter @learning-more/contracts build && corepack pnpm --filter @learning-more/ui build && playwright test --config engineering/testing/playwright.config.ts",
"playwright:runtime": "corepack pnpm --filter @learning-more/contracts build && corepack pnpm --filter @learning-more/ui build && corepack pnpm --filter @learning-more/server build && playwright test --config engineering/testing/playwright.runtime.config.ts",
"a11y:test": "playwright test --config engineering/testing/playwright.visual.config.ts engineering/tests/visual/accessibility.spec.ts",
"test:capacity": "vitest run engineering/tests/performance/capacity-gate.test.ts",
"test:recovery": "vitest run engineering/tests/recovery/full-fault-matrix.test.ts engineering/tests/recovery/runtime-activation-flow.test.ts operations/maintenance/src/maintenance/doctor.test.ts operations/maintenance/src/maintenance/restore.test.ts"
```

- [ ] **Step 4: Update Vitest and report path rules**

Replace root `tests/**` patterns with `engineering/tests/**`. Preserve generated report paths until Task 5 changes them atomically.

- [ ] **Step 5: Run path-focused tests**

Run:

```powershell
corepack pnpm exec vitest run engineering/architecture/src/report-equivalence.test.ts engineering/architecture/src/check-equivalence.test.ts
```

Expected: PASS.

### Task 3: Separate operations scripts from engineering verification

**Files:**
- Move: `tools/start-learning-more.mjs` → `operations/scripts/start-learning-more.mjs`
- Move: `tools/interactive-start.mjs` → `operations/scripts/interactive-start.mjs`
- Move: `tools/interactive-start.test.mjs` → `operations/scripts/interactive-start.test.mjs`
- Move: projection/backfill scripts and semantic-source helper/tests → `operations/scripts/`
- Move: `tools/verify-change.mjs` and tests → `engineering/verification/`
- Move: `tools/verify-product-ui.mjs` → `engineering/verification/`
- Move: `tools/test-suite-policy.test.mjs` → `engineering/verification/`
- Move: `scripts/verify-workspace.mjs` → `engineering/verification/verify-workspace.mjs`
- Modify: `package.json`
- Modify: `vitest.config.ts`
- Modify: `apps/host/src/launcher-process.test.ts`
- Modify: path assertions in moved tests

**Interfaces:**
- Consumes: `process.cwd()` as repository root.
- Produces: `pnpm start` through `operations/scripts/start-learning-more.mjs` and `pnpm verify` through `engineering/verification/verify-change.mjs`.

- [ ] **Step 1: Move runtime-facing scripts**

Update relative imports after moving. A script that previously used `../tests/` must use `../engineering/tests/` or a repository-root `path.resolve`.

- [ ] **Step 2: Move verification scripts**

Update self-path checks:

```js
file === 'engineering/verification/verify-change.mjs'
```

Update path families:

```js
file.startsWith('engineering/tests/')
```

- [ ] **Step 3: Update package entry commands**

Use:

```json
"start": "corepack pnpm build && node operations/scripts/start-learning-more.mjs",
"start:open": "corepack pnpm build && node operations/scripts/start-learning-more.mjs --open",
"product-ui:check": "node engineering/verification/verify-product-ui.mjs",
"verify": "node engineering/verification/verify-change.mjs"
```

- [ ] **Step 4: Run moved script tests**

Run:

```powershell
corepack pnpm exec vitest run operations/scripts engineering/verification
```

Expected: PASS.

### Task 4: Move executable contracts and release assets beside their owners

**Files:**
- Move: `docs/架构方案/equivalence-matrix.yaml` → `engineering/architecture/fixtures/equivalence-matrix.yaml`
- Move: `docs/基础模块功能等价清单与回归基线.md` → `engineering/architecture/fixtures/equivalence-baseline.md`
- Move: `release/README.txt` → `operations/release/assets/README.txt`
- Move: `release/release-manifest.json` → `operations/release/assets/release-manifest.json`
- Modify: `engineering/architecture/src/check-equivalence.ts`
- Modify: `engineering/architecture/src/data-definition-sync.test.ts`
- Modify: `operations/release/src/build-portable.ts`
- Modify: tests and CI paths

**Interfaces:**
- Consumes: fixture paths owned by their executing workspace.
- Produces: architecture checks and portable builds without root `docs/` or `release/` dependencies.

- [ ] **Step 1: Move executable contracts**

Update architecture resolution:

```ts
const matrixPath = path.join(repositoryRoot, 'engineering/architecture/fixtures/equivalence-matrix.yaml');
const sourcePath = path.join(repositoryRoot, 'engineering/architecture/fixtures/equivalence-baseline.md');
```

- [ ] **Step 2: Move portable README and manifest template**

Update `build-portable.ts`:

```ts
await cp(
  path.join(projectRoot, 'operations', 'release', 'assets', 'README.txt'),
  path.join(expandedRoot, 'README.txt'),
);
```

Use the moved manifest template wherever the repository template is read.

- [ ] **Step 3: Run owner tests**

Run:

```powershell
corepack pnpm --filter @learning-more/architecture test
corepack pnpm --filter @learning-more/release test
```

Expected: PASS.

### Task 5: Consolidate rebuildable local output

**Files:**
- Modify: `.gitignore`
- Modify: `package.json`
- Modify: `engineering/testing/*.ts`
- Modify: `operations/release/src/build-portable.ts`
- Modify: `operations/release/src/check-supply-chain.ts`
- Modify: `operations/release/src/fetch-node-runtime.ts`
- Modify: `operations/release/src/release-drill.ts`
- Modify: `.github/workflows/*.yml`
- Modify: report readers under `engineering/architecture/`

**Interfaces:**
- Consumes: repository-local ignored `.local/`.
- Produces: `.local/artifacts`, `.local/generated/release`, `.local/cache/playwright`, and `.local/cache/release`.

- [ ] **Step 1: Define local output paths**

Use:

```text
.local/artifacts/tests/
.local/artifacts/visual/
.local/artifacts/release/
.local/artifacts/supply-chain/
.local/generated/release/
.local/cache/playwright/
.local/cache/release/
```

Add `.local/` to `.gitignore`; remove obsolete separate generated-output ignore entries after references are switched.

- [ ] **Step 2: Update report and browser paths**

Use:

```ts
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(process.cwd(), '.local/cache/playwright');
```

Reporters write below `.local/artifacts/`.

- [ ] **Step 3: Update release output and CI artifact paths**

Portable output defaults to `.local/generated/release`; work files use `.local/generated/release/.work`; release cache uses `.local/cache/release`.

- [ ] **Step 4: Preserve runtime/user state**

Do not move or delete:

```text
.learning-more-data/
.learning-more-backups/
.learning-more-runtime/
.learning-more-local/
```

These paths are runtime compatibility boundaries, not source-tree content.

### Task 6: Delete obsolete documents and repair the repository entry

**Files:**
- Delete: `docs/superpowers/**`
- Delete: `docs/项目2.0现状/**`
- Delete: `docs/教学范例集/**`
- Delete: obsolete profile/portrait documents and screenshots
- Delete: `PROJECT_CONTEXT.md`
- Delete: `SANITIZATION_REPORT.md`
- Move or merge: `CONTEXT.md` and `SECURITY_AND_PRIVACY.md` into current `docs/`
- Modify: `README.md`
- Modify: any remaining source references

**Interfaces:**
- Consumes: current product behavior and code-owned contracts.
- Produces: a concise README and current security/maintenance documents without stale cross-links.

- [ ] **Step 1: Search every candidate before deletion**

Run:

```powershell
rg -n "PROJECT_CONTEXT|SANITIZATION_REPORT|教学范例集|项目2.0现状|learning-portrait|学习画像" . --glob "!node_modules/**" --glob "!.git/**"
```

Update or remove each live reference.

- [ ] **Step 2: Rewrite README links and workspace map**

README must describe:

```text
apps — product applications
packages — shared product packages
operations — runtime, maintenance, release
engineering — architecture, verification, tests, benchmarks
docs — current human documentation
.local — ignored rebuildable output
```

- [ ] **Step 3: Delete process documents**

Delete this plan and its design spec with the rest of `docs/superpowers`; the commits retain their contents.

### Task 7: Validate the migration and remove empty roots

**Files:**
- Delete empty roots: `tools/`, `scripts/`, `tests/`, `release/`, `artifacts/`
- Verify: all modified files

**Interfaces:**
- Consumes: migrated paths.
- Produces: a clean, runnable repository.

- [ ] **Step 1: Check for stale paths**

Run:

```powershell
rg -n "docs/UI视觉预览|tools/|scripts/verify-workspace|tests/(e2e|visual|recovery|performance|support)|release/dist|artifacts/" . --glob "!node_modules/**" --glob "!.git/**"
```

Expected: only intentional product data strings or GitHub artifact API names remain.

- [ ] **Step 2: Run repository verification**

Run:

```powershell
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck:all
corepack pnpm architecture:check
corepack pnpm test:all
corepack pnpm build:all
```

Expected: PASS.

- [ ] **Step 3: Run focused workflow tests**

Run:

```powershell
corepack pnpm playwright:test
corepack pnpm playwright:runtime
corepack pnpm a11y:test
```

Expected: PASS.

- [ ] **Step 4: Smoke-test local startup without modifying user data**

Run the existing status/start check, verify the course API is responsive, and stop only the process created by this check.

- [ ] **Step 5: Verify final tree and Git state**

Run:

```powershell
Get-ChildItem -Force | Select-Object Mode,Name
git status --short
git diff --check
git fsck --connectivity-only --no-reflogs
```

Expected: responsibility roots are clear, no whitespace errors, and Git reports no missing objects.
