# Windows Host Independent Trigger Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore Learning MORE through its existing Windows logon task and make every Host `install` or `repair` invocation start that task without adding any periodic trigger.

**Architecture:** Keep Windows Task Scheduler as the outer owner of Host and preserve the existing `HostManager` and `TaskSchedulerPort` seams. Reconciliation replaces a missing or drifted definition, then always invokes the scheduler's idempotent `start`; the Windows task retains `AtLogOn`, `IgnoreNew`, `StartWhenAvailable`, and failure-only restart settings.

**Tech Stack:** TypeScript, Node.js, Vitest, Windows Task Scheduler, PowerShell

## Global Constraints

- The scheduled task has exactly one current-user `AtLogOn` trigger.
- Do not add `-Once`, `RepetitionInterval`, a one-minute periodic trigger, or any other time-based trigger.
- Keep `RestartInterval = 1 minute` and `RestartCount = 999` only as failure retry settings.
- Keep `MultipleInstances = IgnoreNew`, so starting an already-running task does not create a second Host.
- Keep the public URL fixed at `http://127.0.0.1:43119/` and the direct Server port fixed at `43120`.
- Do not change course data, Provider configuration, secrets, backups, Launcher supervision, Server supervision, or domain behavior.
- Preserve unrelated working-tree changes and stage only the files named in each commit step.

---

## File Map

- `apps/host/src/host-manager.test.ts`: regression tests for starting both newly reconciled and already-matching tasks.
- `apps/host/src/host-manager.ts`: the reconciliation rule that always starts the scheduled task after definition reconciliation succeeds.
- `apps/host/src/windows-task-scheduler.test.ts`: characterization assertions that prohibit periodic trigger syntax.
- `docs/superpowers/specs/2026-07-14-windows-host-independent-trigger-hardening-design.md`: approved behavioral and operational contract; no implementation changes.
- `docs/superpowers/plans/2026-07-14-windows-host-independent-trigger-hardening.md`: executable implementation and verification record.

### Task 1: Make Host reconciliation start an existing matching task

**Files:**
- Modify: `apps/host/src/host-manager.test.ts`
- Modify: `apps/host/src/host-manager.ts`
- Test: `apps/host/src/host-manager.test.ts`

**Interfaces:**
- Consumes: `TaskSchedulerPort.read(name)`, `replace(definition)`, and `start(name)` from `apps/host/src/task-scheduler.ts`.
- Produces: unchanged `HostManager.install(): Promise<HostInstallationStatus>` and `HostManager.repair(): Promise<HostInstallationStatus>` behavior with a stronger postcondition: every successful reconciliation has invoked `start('Learning MORE')` exactly once.

- [ ] **Step 1: Add failing start-count assertions**

Extend the first test in `apps/host/src/host-manager.test.ts` so it proves all three paths start the task:

```ts
await expect(manager.install()).resolves.toMatchObject({ state: 'installed', matches: true });
expect(scheduler.replacements).toBe(1);
expect(scheduler.starts).toBe(1);

await expect(manager.install()).resolves.toMatchObject({ state: 'installed', matches: true });
expect(scheduler.replacements).toBe(1);
expect(scheduler.starts).toBe(2);

scheduler.definition = { ...desired, restartCount: 0 };
await expect(manager.status()).resolves.toMatchObject({ state: 'drifted', matches: false });
await expect(manager.repair()).resolves.toMatchObject({ state: 'installed', matches: true });
expect(scheduler.replacements).toBe(2);
expect(scheduler.starts).toBe(3);
```

- [ ] **Step 2: Run the focused test and confirm the regression is red**

Run from the repository root:

```powershell
corepack pnpm exec vitest run --root . apps/host/src/host-manager.test.ts
```

Expected: the second start-count assertion fails because the current implementation skips `start` when the task definition already matches.

- [ ] **Step 3: Move task start outside the replacement branch**

Replace the `reconcile` implementation in `apps/host/src/host-manager.ts` with:

```ts
const reconcile = async (): Promise<HostInstallationStatus> => {
  const before = await status();
  if (!before.matches) {
    await options.scheduler.replace(options.desired);
  }
  await options.scheduler.start(options.desired.name);
  return status();
};
```

This preserves error ordering: a failed replacement prevents start, while a failed start rejects `install/repair` instead of reporting a false recovery.

- [ ] **Step 4: Run the focused test and confirm it is green**

Run:

```powershell
corepack pnpm exec vitest run --root . apps/host/src/host-manager.test.ts
```

Expected: 2 tests pass; replacement counts remain `1` after the second install and `2` after drift repair, while start counts are `1`, `2`, and `3`.

- [ ] **Step 5: Commit only the Host manager regression**

```powershell
git add -- apps/host/src/host-manager.test.ts apps/host/src/host-manager.ts
git commit -m "fix(host): start matching scheduled task during repair"
```

Expected: the commit contains only the two Host manager files.

### Task 2: Lock out periodic trigger generation

**Files:**
- Modify: `apps/host/src/windows-task-scheduler.test.ts`
- Test: `apps/host/src/windows-task-scheduler.test.ts`

**Interfaces:**
- Consumes: encoded registration script emitted by `createWindowsTaskScheduler`.
- Produces: an executable contract that allows failure restart settings but rejects time-based trigger syntax.

- [ ] **Step 1: Add explicit negative trigger assertions**

Immediately after the existing `New-ScheduledTaskTrigger -AtLogOn` assertion, add:

```ts
expect(registration).not.toContain('New-ScheduledTaskTrigger -Once');
expect(registration).not.toContain('RepetitionInterval');
```

Keep the existing positive assertion for `RestartInterval (New-TimeSpan -Minutes 1)` because it is failure retry configuration, not a periodic trigger.

- [ ] **Step 2: Run the Windows adapter test**

Run:

```powershell
corepack pnpm exec vitest run --root . apps/host/src/windows-task-scheduler.test.ts
```

Expected: 1 test passes, proving the generated registration script contains only the logon trigger and no repetition syntax.

- [ ] **Step 3: Commit only the trigger contract test**

```powershell
git add -- apps/host/src/windows-task-scheduler.test.ts
git commit -m "test(host): prohibit periodic task triggers"
```

Expected: the commit contains only `apps/host/src/windows-task-scheduler.test.ts`.

### Task 3: Build and apply the hardened repair path

**Files:**
- Verify: `apps/host/package.json`
- Build output: `apps/host/dist/` through the existing TypeScript build script
- External state: current-user Windows scheduled task named `Learning MORE`

**Interfaces:**
- Consumes: `node apps/host/dist/main.js repair --project-root .` and the registered `Learning MORE` task.
- Produces: a running Host-owned Launcher/Server chain with no periodic trigger.

- [ ] **Step 1: Run the Host test suite and typecheck**

Run:

```powershell
corepack pnpm --filter @learning-more/host test
corepack pnpm --filter @learning-more/host typecheck
```

Expected: all Host tests pass and TypeScript reports no errors.

- [ ] **Step 2: Build the Host package**

Run:

```powershell
corepack pnpm --filter @learning-more/host build
```

Expected: exit code `0` and an updated `apps/host/dist/host-manager.js` containing an unconditional scheduler start after the conditional replacement.

- [ ] **Step 3: Apply repair through the built Host CLI**

Run from the repository root:

```powershell
node .\apps\host\dist\main.js repair --project-root .
```

Expected: the command exits successfully, preserves the matching task definition, and invokes `Start-ScheduledTask` even when the definition did not drift.

- [ ] **Step 4: Verify the real task has one non-periodic logon trigger**

Run:

```powershell
$task = Get-ScheduledTask -TaskName 'Learning MORE'
$trigger = @($task.Triggers)
[pscustomobject]@{
  State = [string]$task.State
  TriggerCount = $trigger.Count
  TriggerClass = [string]$trigger[0].CimClass.CimClassName
  RepetitionInterval = [string]$trigger[0].Repetition.Interval
  MultipleInstances = [string]$task.Settings.MultipleInstances
  RestartCount = [int]$task.Settings.RestartCount
  RestartInterval = [string]$task.Settings.RestartInterval
}
```

Expected: `State = Running`, `TriggerCount = 1`, `TriggerClass = MSFT_TaskLogonTrigger`, empty `RepetitionInterval`, `MultipleInstances = IgnoreNew`, `RestartCount = 999`, and `RestartInterval = PT1M`.

- [ ] **Step 5: Verify both ports and runtime identity**

Run:

```powershell
$proxy = Invoke-RestMethod -Uri 'http://127.0.0.1:43119/api/v1/runtime/ready' -TimeoutSec 10
$direct = Invoke-RestMethod -Uri 'http://127.0.0.1:43120/api/v1/runtime/ready' -TimeoutSec 10
$listeners = Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 43119,43120 } | Sort-Object LocalPort
if ($proxy.status -ne 'ready' -or $direct.status -ne 'ready') { throw 'Runtime is not ready' }
if ($proxy.instanceId -ne $direct.instanceId -or $proxy.buildId -ne $direct.buildId -or $proxy.protocolVersion -ne $direct.protocolVersion) { throw 'Proxy and direct runtime identity differ' }
[pscustomobject]@{
  Status = $proxy.status
  InstanceId = $proxy.instanceId
  BuildId = $proxy.buildId
  ProtocolVersion = $proxy.protocolVersion
  ListeningPorts = ($listeners.LocalPort -join ',')
}
```

Expected: `Status = ready`, the identity comparison does not throw, and listening ports are `43119,43120`.

- [ ] **Step 6: Record repository and task state without stopping the service**

Run:

```powershell
git status --short
Get-ScheduledTaskInfo -TaskName 'Learning MORE' | Select-Object LastRunTime,LastTaskResult,NextRunTime,NumberOfMissedRuns
```

Expected: the service remains running; `NextRunTime` is empty because there is no periodic schedule. Unrelated pre-existing working-tree changes remain untouched.

## Self-Review Record

- Spec coverage: unconditional start, single logon trigger, failure-only retry, real task state, both ports, and identity equality are each mapped to a task above.
- Placeholder scan: every code change and verification command is concrete; no deferred implementation markers remain.
- Type consistency: all method names match the existing `HostManager`, `TaskSchedulerPort`, `HostTaskDefinition`, and runtime readiness contracts.
- Operational limitation: an explicit `Stop-ScheduledTask` cannot recover unattended without a periodic trigger or Windows Service; recovery remains re-login or an explicit `install/repair` call, as required by the approved design.
