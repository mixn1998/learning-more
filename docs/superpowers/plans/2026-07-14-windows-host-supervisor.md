# Windows Host Supervisor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install a per-user Windows logon task that runs a stable Host Supervisor independent of Codex, restarts Launcher crashes, enforces one instance, and rolls back failed releases.

**Architecture:** A new `@learning-more/host` package exposes small Host Manager and Supervisor interfaces. Platform-independent policies use injected file/process/task adapters; the Windows adapter registers one fixed Task Scheduler definition. A versioned activation repository selects candidate/active/previous releases and commits only after Launcher identity and readiness pass.

**Tech Stack:** Node.js 24, TypeScript, Windows Task Scheduler PowerShell cmdlets, Vitest, existing Launcher and portable release tooling.

## Global Constraints

- Task runs only for the current interactive user at logon so Codex browser authentication remains possible.
- Public URL remains `http://127.0.0.1:43119/`; no port scanning or port drift.
- `MultipleInstancesPolicy = IgnoreNew`; Host and Launcher also keep verified leases.
- Never terminate an unknown process or an externally owned port.
- Candidate release is immutable, checksum-verified, and health-gated before activation.
- Uninstall never deletes course data, Provider configuration, secrets, logs, or backups.
- System registration is performed only after tests/builds pass and must be inspected after creation.

---

## File Structure

- `apps/host/package.json`, `apps/host/tsconfig.json`: workspace package.
- `apps/host/src/task-scheduler.ts`: task definition port and fixed desired definition.
- `apps/host/src/windows-task-scheduler.ts`: encoded PowerShell adapter.
- `apps/host/src/host-manager.ts`: idempotent install/status/repair/uninstall reconciliation.
- `apps/host/src/host-lease.ts`: verified singleton lease.
- `apps/host/src/activation-repository.ts`: atomic active/previous/candidate journal.
- `apps/host/src/supervisor.ts`: Launcher process monitoring and bounded recovery.
- `apps/host/src/main.ts`: `run`, `install`, `status`, `repair`, `uninstall` CLI.
- Tests beside every public module.
- `tools/release/src/build-portable.ts`: includes stable Host and install entrypoints.
- `tools/release/src/check-layout.ts`: enforces Host layout.
- `package.json`: host management scripts.

### Task 1: Create the task definition and manager seam

**Files:**
- Create: `apps/host/package.json`
- Create: `apps/host/tsconfig.json`
- Create: `apps/host/src/task-scheduler.ts`
- Create: `apps/host/src/host-manager.ts`
- Create: `apps/host/src/host-manager.test.ts`

**Interfaces:**
- Produces: `TaskSchedulerPort`, `HostTaskDefinition`, `createHostManager()`.

- [ ] **Step 1: Add package scaffolding**

Use the Launcher package scripts and tsconfig shape, changing package name and build info path to `@learning-more/host` and `dist/host.tsbuildinfo`.

- [ ] **Step 2: Write the failing reconciliation test**

```ts
it('installs and repairs the exact per-user logon task idempotently', async () => {
  const scheduler = new InMemoryTaskScheduler();
  const manager = createHostManager({ scheduler, desired: desiredFixture });
  await expect(manager.install()).resolves.toMatchObject({ state: 'installed', matches: true });
  await expect(manager.install()).resolves.toMatchObject({ state: 'installed', matches: true });
  scheduler.mutate({ restartCount: 0 });
  await expect(manager.status()).resolves.toMatchObject({ matches: false });
  await expect(manager.repair()).resolves.toMatchObject({ matches: true });
});
```

- [ ] **Step 3: Run and observe RED**

Run: `corepack pnpm vitest run apps/host/src/host-manager.test.ts`

Expected: FAIL because the package/modules do not exist.

- [ ] **Step 4: Implement the fixed contract**

```ts
export type HostTaskDefinition = Readonly<{
  name: 'Learning MORE';
  executable: string;
  arguments: readonly string[];
  userId: string;
  trigger: 'logon';
  startWhenAvailable: true;
  multipleInstances: 'ignore-new';
  restartIntervalMinutes: 1;
  restartCount: number;
  executionTimeLimit: 'PT0S';
}>;

export interface TaskSchedulerPort {
  read(name: string): Promise<HostTaskDefinition | undefined>;
  replace(definition: HostTaskDefinition): Promise<void>;
  remove(name: string): Promise<void>;
  start(name: string): Promise<void>;
}
```

`install()` and `repair()` call `replace()` only when the actual normalized definition differs; `uninstall()` only removes `Learning MORE`.

- [ ] **Step 5: Run and observe GREEN**

Run: `corepack pnpm vitest run apps/host/src/host-manager.test.ts`

Expected: PASS.

### Task 2: Add verified Host singleton lease

**Files:**
- Create: `apps/host/src/host-lease.ts`
- Create: `apps/host/src/host-lease.test.ts`

**Interfaces:**
- Produces: `acquireHostLease(options): Promise<HostLease>`.

- [ ] **Step 1: Write one failing lease test per behavior**

Cover: fresh acquisition; live same executable/release is `already-running`; dead PID is quarantined then acquired; live mismatched identity is `blocked-foreign-owner`; release only deletes a lease with its own instanceId.

Use literal fixtures such as PID 43119 and paths under `C:\Program Files\Learning MORE`; inject `observeProcess(pid)` rather than calling the OS in policy tests.

- [ ] **Step 2: Run the lease tests and observe RED**

Run: `corepack pnpm vitest run apps/host/src/host-lease.test.ts`

Expected: FAIL because the lease module does not exist.

- [ ] **Step 3: Implement atomic `wx` acquisition and verified stale recovery**

The persisted strict record contains `schemaVersion`, `instanceId`, `pid`, `executablePath`, `releaseRoot`, `startedAt`. Parse unknown/invalid data as blocked, never as stale. Rename only a lease whose observed owner is absent.

- [ ] **Step 4: Run and observe GREEN**

Run: `corepack pnpm vitest run apps/host/src/host-lease.test.ts`

Expected: PASS.

### Task 3: Implement activation journal and rollback policy

**Files:**
- Create: `apps/host/src/activation-repository.ts`
- Create: `apps/host/src/activation-repository.test.ts`

**Interfaces:**
- Produces: `ActivationRepository.prepare`, `.commit`, `.rollback`, `.recover`.

- [ ] **Step 1: Write failing transaction tests**

```ts
it('keeps active unchanged until candidate health commits and recovers prepared crashes', async () => {
  const repository = await fixture({ activeBuildId: 'build-a' });
  await repository.prepare({ candidateBuildId: 'build-b' });
  expect(await repository.current()).toMatchObject({ activeBuildId: 'build-a', candidateBuildId: 'build-b', phase: 'prepared' });
  await expect(repository.recover()).resolves.toMatchObject({ activeBuildId: 'build-a', phase: 'stable' });
});
```

Add separate tests that commit sets previous to old active, rollback restores previous, and unknown candidate directories are never selected.

- [ ] **Step 2: Run and observe RED**

Run: `corepack pnpm vitest run apps/host/src/activation-repository.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement strict state and atomic replace**

Use a temporary sibling file and `rename`. Persist only build IDs/phases/timestamps. The release root is derived from the fixed Host state root plus validated build ID; reject path separators and traversal.

- [ ] **Step 4: Run and observe GREEN**

Run: `corepack pnpm vitest run apps/host/src/activation-repository.test.ts`

Expected: PASS.

### Task 4: Supervise Launcher and health-gate activation

**Files:**
- Create: `apps/host/src/supervisor.ts`
- Create: `apps/host/src/supervisor.test.ts`

**Interfaces:**
- Consumes: Activation repository and verified Launcher process/health ports.
- Produces: `createHostSupervisor(dependencies)` with `run()` and `activateCandidate()`.

- [ ] **Step 1: Write the Launcher crash recovery test**

Use a scripted process port: first Launcher exits unexpectedly, second remains running. Assert delays `500` then a second start; a controlled stop must not restart. Add a sixth-crash-in-ten-minutes test that produces `blocked_restart_storm`.

- [ ] **Step 2: Run and observe RED**

Run: `corepack pnpm vitest run apps/host/src/supervisor.test.ts`

Expected: FAIL because the Supervisor does not exist.

- [ ] **Step 3: Implement bounded Supervisor recovery**

Reuse the numerical restart policy from Launcher without importing Launcher application code: `[500, 1000, 2000, 4000, 8000]`, maximum five automatic restarts in ten minutes. Spawn with argument arrays, `shell: false`, `windowsHide: true`, and the selected release root as cwd.

- [ ] **Step 4: Add candidate activation RED/GREEN tests**

Test successful identity/readiness commits build-b; failed readiness stops only the verified candidate and starts build-a; data migration rollback invokes the injected verified-backup restore before the old Launcher.

Run after each loop: `corepack pnpm vitest run apps/host/src/supervisor.test.ts`

Expected: PASS.

### Task 5: Implement Windows Task Scheduler adapter

**Files:**
- Create: `apps/host/src/windows-task-scheduler.ts`
- Create: `apps/host/src/windows-task-scheduler.test.ts`

**Interfaces:**
- Implements: `TaskSchedulerPort` from Task 1.

- [ ] **Step 1: Write a command-boundary test**

Inject `execFile` and assert calls use the absolute Windows PowerShell executable, `-EncodedCommand`, `shell: false`, `windowsHide: true`; decoded script must contain fixed `New-ScheduledTaskTrigger -AtLogOn`, `MultipleInstances IgnoreNew`, `RestartInterval (New-TimeSpan -Minutes 1)`, `ExecutionTimeLimit 'PT0S'`, and the exact quoted executable/action arguments. Assert user values cannot create extra PowerShell statements because all values are encoded as JSON/Base64 literals.

- [ ] **Step 2: Run and observe RED**

Run: `corepack pnpm vitest run apps/host/src/windows-task-scheduler.test.ts`

Expected: FAIL because the Windows adapter does not exist.

- [ ] **Step 3: Implement read/replace/remove/start**

Use Task Scheduler cmdlets and serialize a normalized JSON definition from `read`. Treat only the documented task-not-found error as `undefined`; propagate access and malformed output errors.

- [ ] **Step 4: Run and observe GREEN**

Run: `corepack pnpm vitest run apps/host/src/windows-task-scheduler.test.ts`

Expected: PASS.

### Task 6: Add CLI and stable portable layout

**Files:**
- Create: `apps/host/src/main.ts`
- Create: `apps/host/src/main.test.ts`
- Modify: `tools/release/src/build-portable.ts`
- Modify: `tools/release/src/check-layout.ts`
- Modify: `tools/release/src/check-layout.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces CLI: `run | install | status | repair | uninstall`.
- Produces scripts: `host:install`, `host:status`, `host:repair`, `host:uninstall`.

- [ ] **Step 1: Write failing CLI dispatch tests**

Assert each exact command calls only its manager/supervisor method, unknown commands exit nonzero, and JSON status contains no secrets or data content.

- [ ] **Step 2: Run and observe RED**

Run: `corepack pnpm vitest run apps/host/src/main.test.ts`

Expected: FAIL because CLI does not exist.

- [ ] **Step 3: Implement CLI and portable entries**

The portable release contains stable `host/runtime/node.exe`, `host/app/dist/main.js`, `INSTALL-AUTOSTART.cmd`, `REPAIR-AUTOSTART.cmd`, and versioned application content. `START.cmd` calls Host `run` rather than Launcher directly. Root scripts build Host before invoking its command.

- [ ] **Step 4: Extend layout test**

Require the Host files and ensure release manifest/checksums include them.

Run: `corepack pnpm vitest run apps/host tools/release/src/check-layout.test.ts`

Expected: PASS.

### Task 7: Workspace installation and system verification

**Files:**
- Modify if required: `.gitignore` for Host runtime state only.
- Do not commit generated `%LOCALAPPDATA%` state.

- [ ] **Step 1: Run package and release gates**

Run: `corepack pnpm --filter @learning-more/host typecheck`

Expected: PASS.

Run: `corepack pnpm vitest run apps/host apps/launcher tools/release/src/check-layout.test.ts`

Expected: PASS.

Run: `corepack pnpm build`

Expected: PASS.

- [ ] **Step 2: Install the real per-user task**

Run from an approved elevated system mutation:

`corepack pnpm host:install`

Expected JSON: `{"state":"installed","matches":true,...}`.

- [ ] **Step 3: Inspect authoritative Task Scheduler state**

Run: `corepack pnpm host:status`

Expected: task name `Learning MORE`, current user, logon trigger, `IgnoreNew`, one-minute restart, unlimited execution time, fixed Node/Host action, `matches: true`.

- [ ] **Step 4: Perform crash and login persistence drills**

Start the task, verify 43119 and 43120 identities, terminate the verified Launcher PID, wait for Supervisor recovery, and verify the new identity. End the invoking terminal/Codex process and verify 43119 remains reachable. A full logoff/logon check is recorded as manual evidence if automation cannot preserve the active desktop session.

- [ ] **Step 5: Perform candidate rollback drill**

Activate a fixture candidate whose readiness never succeeds. Expected: candidate is stopped, previous build is restarted, 43119 serves previous build identity, activation journal records rollback.

- [ ] **Step 6: Commit the Host slice**

```bash
git add apps/host package.json pnpm-lock.yaml tools/release/src/build-portable.ts tools/release/src/check-layout.ts tools/release/src/check-layout.test.ts .gitignore
git commit -m "feat: add persistent windows host supervisor"
```

### Task 8: Final product gate

- [ ] **Step 1: Run all verification**

Run: `corepack pnpm verify`

Expected: PASS.

Run: `corepack pnpm frontend:acceptance`

Expected: PASS, including all 81 visual baselines with full-page difference at or below 0.3%.

Run: `corepack pnpm release:drill`

Expected: `release-ready` with portable, runtime, recovery, Unicode/offline, supply-chain and reproducibility gates passed.

- [ ] **Step 2: Record completion evidence**

Update the frontend acceptance report with exact Task Scheduler status, PIDs/build IDs before and after crash recovery, Provider high persistence response, reconnect timeline, rollback journal and gate outputs. Do not mark the persistent goal complete until every item is backed by current output.
