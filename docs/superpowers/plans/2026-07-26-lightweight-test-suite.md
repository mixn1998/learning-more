# Lightweight Test Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make daily full verification fast and side-effect free while preserving capacity, recovery, browser, and visual checks as explicit release gates.

**Architecture:** Root Vitest remains the single unit/integration runner, but daily scripts exclude dedicated performance and recovery directories. Capacity validation remains an explicit suite and verifies logical limits, cardinality, memory, and latency without allocating a 20 GiB file. Release verification composes daily verification with the dedicated heavy suites without recursive script calls.

**Tech Stack:** pnpm scripts, Vitest 4, TypeScript, Node.js 24

## Global Constraints

- `pnpm test` must include all unit and lightweight integration tests.
- Daily tests must exclude `tests/performance/**` and `tests/recovery/**`.
- Daily verification must not create large files, launch browsers, or run recovery drills.
- Capacity validation must preserve the 20 GiB logical boundary without allocating a 20 GiB file.
- Existing feature tests must remain discoverable.

---

### Task 1: Lock the test-layer policy

**Files:**
- Create: `tools/test-suite-policy.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: root `package.json` scripts.
- Produces: `test`, `test:ci`, `test:capacity`, `test:recovery`, `frontend:acceptance:checks`, `frontend:acceptance`, and `verify:release` script contracts.

- [x] **Step 1: Add a failing policy test**

Create a test that loads `package.json` and asserts:

```js
expect(scripts.test).toContain('--exclude tests/performance/**');
expect(scripts.test).toContain('--exclude tests/recovery/**');
expect(scripts['test:ci']).toContain('--exclude tests/performance/**');
expect(scripts['test:ci']).toContain('--exclude tests/recovery/**');
expect(scripts['verify:release']).toContain('frontend:acceptance:checks');
expect(scripts['frontend:acceptance:checks']).not.toContain('verify');
```

- [x] **Step 2: Run the policy test and verify failure**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run tools/test-suite-policy.test.mjs
```

Expected: failure because the daily scripts do not exclude the dedicated suites and `verify:release` does not exist.

- [x] **Step 3: Update root scripts**

Set the daily runners to two bounded workers and explicit exclusions:

```json
"test": "vitest run --passWithNoTests --maxWorkers=2 --exclude tests/performance/** --exclude tests/recovery/**",
"test:ci": "vitest run --passWithNoTests --maxWorkers=2 --exclude tests/performance/** --exclude tests/recovery/** --reporter=default --reporter=json --outputFile=artifacts/tests/unit.json"
```

Split frontend acceptance so the shared heavy checks do not recursively invoke `verify`:

```json
"frontend:acceptance:checks": "corepack pnpm supply-chain:check && corepack pnpm product-ui:check && corepack pnpm playwright:test && corepack pnpm playwright:runtime && corepack pnpm ui-samples:verify && corepack pnpm visual:test",
"frontend:acceptance": "corepack pnpm verify && corepack pnpm frontend:acceptance:checks",
"verify:release": "corepack pnpm verify && corepack pnpm test:capacity && corepack pnpm test:recovery && corepack pnpm frontend:acceptance:checks"
```

- [x] **Step 4: Run the policy test**

Expected: pass.

### Task 2: Remove the 20 GiB filesystem side effect

**Files:**
- Modify: `tests/performance/capacity-gate.test.ts`

**Interfaces:**
- Consumes: benchmark latency helpers.
- Produces: a standalone capacity gate with no filesystem writes.

- [x] **Step 1: Add a source-policy assertion**

Extend `tools/test-suite-policy.test.mjs` to read the capacity test source and assert:

```js
expect(capacitySource).not.toContain('truncate(');
expect(capacitySource).not.toContain('mkdtemp(');
expect(capacitySource).toContain('logicalBytes: 20 * 1024 ** 3');
```

- [x] **Step 2: Run the policy test and verify failure**

Expected: failure because the current capacity test calls `truncate`.

- [x] **Step 3: Rewrite the capacity test**

Remove filesystem imports and temporary-file lifecycle. Keep cardinality traversal, memory budget, elapsed-time budget, latency checks, and this logical-boundary assertion:

```ts
expect(CAPACITY.logicalBytes).toBe(20 * 1024 ** 3);
```

- [x] **Step 4: Run capacity and policy tests**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run tools/test-suite-policy.test.mjs tests/performance/capacity-gate.test.ts --maxWorkers=1
```

Expected: all tests pass without creating a capacity file.

### Task 3: Validate daily and release boundaries

**Files:**
- Modify: `docs/superpowers/plans/2026-07-26-lightweight-test-suite.md`

**Interfaces:**
- Consumes: the scripts and capacity gate from Tasks 1–2.
- Produces: verified daily commands and a documented validation result.

- [x] **Step 1: Run daily tests**

Run:

```powershell
corepack pnpm test
```

Expected: all discovered daily tests pass; output does not include `tests/performance/capacity-gate.test.ts` or `tests/recovery/`.

- [x] **Step 2: Run the standalone capacity gate**

Run:

```powershell
corepack pnpm test:capacity
```

Expected: both capacity tests pass without disk-space errors.

- [x] **Step 3: Run daily verification**

Run:

```powershell
corepack pnpm verify
```

Expected: format, lint, typecheck, schema, architecture, equivalence, daily tests, and build pass.

- [x] **Step 4: Review and commit**

Run `git diff --check`, review the final script graph, and commit the implementation with:

```powershell
git add package.json tests/performance/capacity-gate.test.ts tools/test-suite-policy.test.mjs docs/superpowers/plans/2026-07-26-lightweight-test-suite.md
git commit -m "test: make daily verification lightweight"
```
