# Runtime Recovery State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep AppShell and Runtime Center truthful during controlled Server replacement, showing recovering instead of red until final verification succeeds or fails.

**Architecture:** A framework-neutral `RuntimeRecoveryCoordinator` owns an operation-id-guarded snapshot and executes the four recovery stages. React provides that snapshot through the existing Runtime context; periodic readiness probes become observations and cannot overwrite an active recovery operation.

**Tech Stack:** TypeScript, React 19 Context, Vitest fake timers, React Testing Library.

## Global Constraints

- Local service and AI health remain independent.
- Temporary readiness 502 responses during controlled recovery are amber/recovering, not red/offline.
- Only an awaited verified readiness refresh can return the UI to green.
- Stable identity mismatch, external port ownership, timeout, or final health failure is red.
- Keep the public site address at `http://127.0.0.1:43119/`.

---

## File Structure

- `apps/web/src/state/runtime-recovery-coordinator.ts`: deterministic public recovery state machine.
- `apps/web/src/state/runtime-recovery-coordinator.test.ts`: transient failure, timeout, stale result and AI separation behavior.
- `apps/web/src/state/runtime-state-context.tsx`: React context contract with awaited refresh and recover methods.
- `apps/web/src/layouts/app-shell.tsx`: creates/co-ordinates one runtime controller and polls it.
- `apps/web/src/features/runtime/runtime-center.tsx`: renders and starts the shared operation.
- `apps/web/src/features/runtime/runtime-center.test.tsx`, `apps/web/src/router.test.tsx`: integration rendering.

### Task 1: Build the deterministic coordinator seam

**Files:**
- Create: `apps/web/src/state/runtime-recovery-coordinator.ts`
- Create: `apps/web/src/state/runtime-recovery-coordinator.test.ts`

**Interfaces:**
- Produces: `RuntimeRecoverySnapshot`
- Produces: `createRuntimeRecoveryCoordinator(dependencies)` with `snapshot`, `subscribe`, `observeReadiness`, `recover`.

- [ ] **Step 1: Write the transient-502 failing test**

```ts
it('stays recovering through transient readiness failures and becomes ready after verification', async () => {
  const snapshots: RuntimeRecoverySnapshot[] = [];
  const coordinator = createRuntimeRecoveryCoordinator({
    reconnect: vi.fn().mockResolvedValue({ state: 'healthy', crashCount: 0 }),
    waitUntilReady: vi.fn().mockResolvedValue(readyFixture),
    refreshAi: vi.fn().mockResolvedValue(undefined),
    readProviderStatus: vi.fn().mockResolvedValue(providerFixture),
  });
  coordinator.subscribe((snapshot) => snapshots.push(snapshot));
  const recovery = coordinator.recover();
  for (let index = 0; index < 7; index += 1) coordinator.observeReadiness(undefined);
  await recovery;
  expect(snapshots.some((snapshot) => snapshot.kind === 'offline')).toBe(false);
  expect(coordinator.snapshot().kind).toBe('ready');
});
```

- [ ] **Step 2: Run and observe RED**

Run: `corepack pnpm vitest run apps/web/src/state/runtime-recovery-coordinator.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the minimal public state machine**

Use this union and operation-id rule:

```ts
export type RuntimeRecoverySnapshot =
  | { kind: 'loading'; operationId: number }
  | { kind: 'ready'; operationId: number; readiness: RuntimeReady }
  | { kind: 'offline'; operationId: number }
  | { kind: 'recovering'; operationId: number; stage: 'verifying' | 'reconnecting' | 'waiting' | 'refreshing'; readiness?: RuntimeReady }
  | { kind: 'degraded'; operationId: number; reason: string; readiness?: RuntimeReady };
```

`observeReadiness(undefined)` must be ignored only while the current snapshot is `recovering`; outside recovery it publishes `offline`. `recover()` increments `operationId`, emits four stages, awaits each dependency, and ignores completion from an obsolete id.

- [ ] **Step 4: Add timeout/stale-result/AI-separation tests one at a time**

Add and run one RED/GREEN cycle for each behavior:

- rejected `waitUntilReady` becomes `degraded`;
- a prior operation cannot overwrite a newer operation;
- rejected `refreshAi` records separate Provider failure metadata but final local snapshot remains `ready`.

Run after each cycle: `corepack pnpm vitest run apps/web/src/state/runtime-recovery-coordinator.test.ts`

Expected: PASS after each minimal implementation.

### Task 2: Make Runtime context awaitable

**Files:**
- Create: `apps/web/src/state/runtime-state-context.tsx`
- Modify: `apps/web/src/layouts/app-shell.tsx`

**Interfaces:**
- Consumes: coordinator from Task 1.
- Produces: `refresh(): Promise<RuntimeUiState>` and `recover(): Promise<void>`.

- [ ] **Step 1: Move the current context type into the focused file**

```tsx
export type RuntimeStateContextValue = Readonly<{
  state: RuntimeUiState;
  recovery: RuntimeRecoverySnapshot;
  refresh(): Promise<RuntimeUiState>;
  recover(): Promise<void>;
}>;
export const RuntimeStateContext = createContext<RuntimeStateContextValue | undefined>(undefined);
```

- [ ] **Step 2: Add an AppShell test for controlled poll failures**

Drive a recovery and make the next readiness poll reject. Assert the header contains `本地服务 · 重连中` and does not contain `本地服务 · 需要处理`.

Run: `corepack pnpm vitest run apps/web/src/router.test.tsx`

Expected: RED against current immediate-offline behavior.

- [ ] **Step 3: Wire AppShell to a single coordinator**

Replace the fire-and-forget `refresh(): void` counter with an async function that fetches readiness, evaluates version, updates coordinator observation and returns the resulting `RuntimeUiState`. The 2-second interval calls this method. During `recovery.kind === 'recovering'`, banner status and text use amber/rebuilding semantics.

- [ ] **Step 4: Run AppShell tests**

Run: `corepack pnpm vitest run apps/web/src/router.test.tsx apps/web/src/layouts/app-shell.test.tsx`

Expected: PASS; if the second path does not exist, Vitest reports only the matched router suite and exits successfully.

### Task 3: Runtime Center consumes the shared operation

**Files:**
- Modify: `apps/web/src/features/runtime/runtime-center.test.tsx`
- Modify: `apps/web/src/features/runtime/runtime-center.tsx`

**Interfaces:**
- Consumes: `RuntimeStateContextValue.recovery` and `.recover()`.
- Produces: step list derived from shared state rather than private `stage` state.

- [ ] **Step 1: Change the existing four-stage test to use context `recover`**

Provide a context value whose `recover` emits verifying/reconnecting/waiting/refreshing/ready snapshots and assert each label. Also assert reopening reads the current snapshot without resetting it.

- [ ] **Step 2: Run and observe RED**

Run: `corepack pnpm vitest run apps/web/src/features/runtime/runtime-center.test.tsx`

Expected: FAIL because Runtime Center owns a private stage and calls client methods directly.

- [ ] **Step 3: Remove private recovery orchestration**

The button calls `void runtime.recover()`. Step labels map from `runtime.recovery.stage`. Diagnostics and Provider reconnect remain independent Runtime Center operations.

- [ ] **Step 4: Run focused React tests**

Run: `corepack pnpm vitest run apps/web/src/state/runtime-recovery-coordinator.test.ts apps/web/src/features/runtime/runtime-center.test.tsx apps/web/src/router.test.tsx`

Expected: PASS.

### Task 4: Runtime recovery integration gate

- [ ] **Step 1: Run web typecheck and tests**

Run: `corepack pnpm --filter @learning-more/web typecheck`

Expected: PASS.

Run: `corepack pnpm vitest run apps/web/src/state/runtime-recovery-coordinator.test.ts apps/web/src/features/runtime/runtime-center.test.tsx apps/web/src/router.test.tsx apps/web/src/client/runtime-client.test.ts`

Expected: PASS.

- [ ] **Step 2: Run runtime Playwright**

Run: `corepack pnpm playwright:runtime`

Expected: PASS, including controlled reconnect behavior.

- [ ] **Step 3: Commit the slice**

```bash
git add apps/web/src/state/runtime-recovery-coordinator.ts apps/web/src/state/runtime-recovery-coordinator.test.ts apps/web/src/state/runtime-state-context.tsx apps/web/src/layouts/app-shell.tsx apps/web/src/features/runtime/runtime-center.tsx apps/web/src/features/runtime/runtime-center.test.tsx apps/web/src/router.test.tsx
git commit -m "fix: keep controlled runtime recovery truthful"
```
