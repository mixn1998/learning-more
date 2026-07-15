# Explicit Interactive Browser Launch Implementation Plan

> **Execution rule:** Implement this plan task-by-task, run each red/green verification in order, and record the final runtime state. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove browser launching from all long-lived Learning MORE service paths, retain one explicit interactive `--open` entry, and restore the live runtime to Windows Host ownership.

**Architecture:** Launcher becomes a browser-free process supervisor. A small workspace interactive wrapper owns the optional one-time Windows URL launch after readiness, while portable `START.cmd` repairs the Host, waits for readiness, and opens once; maintenance and recovery paths remain headless.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, PowerShell, Windows Task Scheduler

## Global Constraints

- Only `pnpm start:open`, `node tools/start-learning-more.mjs --open`, and portable `START.cmd` may open the homepage.
- Host, Launcher, Server recovery, workspace activation, `syncFrontend`, diagnostics, Provider refresh, and ordinary `pnpm start` must never open a browser.
- Keep fixed URLs and ports: `http://127.0.0.1:43119/` and Server port `43120`.
- Keep the single `AtLogOn` scheduled-task trigger; do not add `-Once`, `RepetitionInterval`, or another periodic trigger.
- Preserve course data, Provider configuration, secrets, backups, and unrelated working-tree changes.
- Verify process identity before terminating the current orphaned development runtime.

---

## File Map

- `apps/launcher/src/main.ts`: browser-free Launcher orchestration Interface and startup state machine.
- `apps/launcher/src/main.test.ts`: public Launcher seam assertions for browser-free startup branches.
- `apps/launcher/src/local-runtime.ts`: local process adapter with no Windows URL handler.
- `apps/launcher/src/local-runtime.test.ts`: regression test that legacy browser flags cannot make `syncFrontend` spawn a process.
- `apps/host/src/launcher-process.ts`: retains a compatibility-only negative browser flag for old rollback Launchers; the current Launcher has no browser capability.
- `tools/interactive-start.mjs`: testable argument parsing, startup ordering, and explicit URL opening orchestration.
- `tools/interactive-start.test.mjs`: wrapper tests for headless, explicit open, invalid argument, readiness failure, and URL-handler failure paths.
- `tools/start-learning-more.mjs`: thin foreground entry using `runInteractiveStart`.
- `package.json`: adds `start:open` while keeping `start` headless.
- `tools/release/src/build-portable.ts`: generates explicit interactive `START.cmd` and headless maintenance scripts.
- `tools/release/src/build-portable.test.ts`: script-contract tests, including decoded PowerShell.
- `release/README.txt`: documents interactive versus maintenance entry points.

### Task 1: Remove browser effects from Launcher

**Files:**
- Modify: `apps/launcher/src/main.test.ts`
- Modify: `apps/launcher/src/main.ts`
- Create: `apps/launcher/src/local-runtime.test.ts`
- Modify: `apps/launcher/src/local-runtime.ts`
- Modify: `apps/host/src/launcher-process.ts`

**Interfaces:**
- Consumes: existing `LauncherRuntime.start()` and `LauncherRuntime.syncFrontend()`.
- Produces: `LauncherDependencies` without `openApplication()` and `LocalRuntimeOptions` without `openBrowser`.

- [x] **Step 1: Make Launcher startup expectations browser-free**

Change the relevant assertions in `apps/launcher/src/main.test.ts` to:

```ts
expect(adapters.calls).toEqual(['lease', 'observe', 'recover', 'start', 'ready']);
expect(adapters.calls).not.toContain('open');
```

For the foreign-port branch use:

```ts
expect(adapters.calls).toEqual(['lease']);
```

For degraded startup retain the state assertion and add:

```ts
expect(adapters.calls).not.toContain('open');
```

- [x] **Step 2: Add a failing local adapter regression**

Create `apps/launcher/src/local-runtime.test.ts` with a hoisted `node:child_process` spawn mock, a temporary runtime directory, and this behavior:

```ts
const options = {
  projectRoot: root,
  runtimeDirectory: root,
  dataRoot: path.join(root, 'data'),
  serverEntry: path.join(root, 'server.js'),
  serverPort: 43_120,
  webUrl: 'http://127.0.0.1:43119',
  allowedOrigin: 'http://127.0.0.1:43119',
  openBrowser: true,
} as LocalRuntimeOptions & { openBrowser: boolean };

const adapters = await createLocalRuntimeAdapters(options);
await adapters.dependencies.syncFrontend();
expect(spawnProcess).not.toHaveBeenCalled();
await adapters.close();
```

Use `afterEach` to close created adapters and recursively remove only the test-created temporary roots.

- [x] **Step 3: Run the focused Launcher tests and confirm red**

Run:

```powershell
& '.\node_modules\.bin\vitest.cmd' run --root . apps/launcher/src/main.test.ts apps/launcher/src/local-runtime.test.ts
```

Expected: startup assertions report the unexpected `open` call and the local adapter reports one `rundll32.exe` spawn.

- [x] **Step 4: Remove browser capability from Launcher implementation**

In `apps/launcher/src/main.ts`:

- delete `openApplication(): Promise<void>` from `LauncherDependencies`;
- delete every `dependencies.openApplication()` call and the `applicationOpened` bookkeeping;
- keep startup error handling and state transitions unchanged.

In `apps/launcher/src/local-runtime.ts`:

- change the import to `import { execFile } from 'node:child_process';`;
- delete `openBrowser` from `LocalRuntimeOptions`;
- delete the `openApplication` dependency implementation;
- make `syncFrontend` an explicit no-op:

```ts
async syncFrontend() {},
```

In `apps/launcher/src/main.ts`, remove the `openBrowser` option when creating local adapters. In `apps/host/src/launcher-process.ts`, retain `LEARNING_MORE_NO_OPEN=1` only as a rollback compatibility guard for older release Launchers; the current Launcher does not read it and contains no browser-opening capability.

- [x] **Step 5: Run Launcher tests and typecheck green**

Run:

```powershell
corepack pnpm --filter @learning-more/launcher test
corepack pnpm --filter @learning-more/launcher typecheck
corepack pnpm --filter @learning-more/host typecheck
```

Expected: all commands exit `0`; no Launcher production file contains `rundll32`, `FileProtocolHandler`, `openApplication`, or `openBrowser`.

- [x] **Step 6: Commit Launcher purity**

```powershell
git add -- apps/launcher/src/main.test.ts apps/launcher/src/main.ts apps/launcher/src/local-runtime.test.ts apps/launcher/src/local-runtime.ts apps/host/src/launcher-process.ts
git commit -m "fix(launcher): remove implicit browser launch"
```

### Task 2: Add the explicit workspace interactive wrapper

**Files:**
- Create: `tools/interactive-start.mjs`
- Create: `tools/interactive-start.test.mjs`
- Modify: `tools/start-learning-more.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `parseInteractiveStartArguments(arguments_)`, `openApplicationUrl(url, spawnProcess?)`, and `runInteractiveStart(options)`.
- Consumes: `startLauncher(): Promise<{ close(): Promise<void> }>` and fixed `webUrl`.

- [x] **Step 1: Write failing wrapper tests**

Create `tools/interactive-start.test.mjs` covering these literal cases:

```js
it('starts headless by default', async () => {
  const openUrl = vi.fn();
  const startLauncher = vi.fn().mockResolvedValue({ close: vi.fn() });
  const result = await runInteractiveStart({ arguments_: [], startLauncher, openUrl, webUrl });
  expect(startLauncher).toHaveBeenCalledTimes(1);
  expect(openUrl).not.toHaveBeenCalled();
  expect(result.exitCode).toBe(0);
});

it('opens exactly once after explicit startup succeeds', async () => {
  const order = [];
  const result = await runInteractiveStart({
    arguments_: ['--open'],
    startLauncher: async () => { order.push('start'); return { close: vi.fn() }; },
    openUrl: async () => { order.push('open'); },
    webUrl,
  });
  expect(order).toEqual(['start', 'open']);
  expect(result.exitCode).toBe(0);
});
```

Also assert: unknown arguments reject before `startLauncher`; Launcher rejection never calls `openUrl`; URL-handler rejection returns the healthy launcher handle with `exitCode = 1`.

- [x] **Step 2: Run wrapper tests and confirm missing module failure**

Run:

```powershell
& '.\node_modules\.bin\vitest.cmd' run --root . tools/interactive-start.test.mjs
```

Expected: FAIL because `tools/interactive-start.mjs` does not exist.

- [x] **Step 3: Implement the wrapper module**

Create `tools/interactive-start.mjs` with:

```js
import { spawn } from 'node:child_process';

export function parseInteractiveStartArguments(arguments_) {
  if (arguments_.length === 0) return { open: false };
  if (arguments_.length === 1 && arguments_[0] === '--open') return { open: true };
  throw new Error(`interactive_start_arguments_invalid:${arguments_.join(',')}`);
}

export function openApplicationUrl(url, spawnProcess = spawn) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
      shell: false,
      windowsHide: true,
      detached: true,
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

export async function runInteractiveStart(options) {
  const command = parseInteractiveStartArguments(options.arguments_);
  const launcher = await options.startLauncher();
  if (!command.open) return { launcher, exitCode: 0 };
  try {
    await options.openUrl(options.webUrl);
    return { launcher, exitCode: 0 };
  } catch {
    return { launcher, exitCode: 1 };
  }
}
```

- [x] **Step 4: Make the executable entry thin and explicit**

Update `tools/start-learning-more.mjs` to parse and validate arguments before importing Launcher, call `runInteractiveStart`, print a warning when `exitCode` is nonzero, keep the returned launcher alive, and use that stored exit code when SIGINT/SIGTERM closes it.

Add to `package.json`:

```json
"start:open": "corepack pnpm build && node tools/start-learning-more.mjs --open"
```

Keep the existing `start` command unchanged so it is headless by default.

- [x] **Step 5: Run wrapper and root tests**

Run:

```powershell
& '.\node_modules\.bin\vitest.cmd' run --root . tools/interactive-start.test.mjs apps/launcher/src/main.test.ts apps/launcher/src/local-runtime.test.ts
```

Expected: all focused tests pass; do not execute `start:open` during automated verification.

- [x] **Step 6: Commit the explicit wrapper**

```powershell
git add -- tools/interactive-start.mjs tools/interactive-start.test.mjs tools/start-learning-more.mjs package.json
git commit -m "feat(runtime): add explicit interactive open command"
```

### Task 3: Make portable START interactive and maintenance headless

**Files:**
- Create: `tools/release/src/build-portable.test.ts`
- Modify: `tools/release/src/build-portable.ts`
- Modify: `release/README.txt`

**Interfaces:**
- Produces: `buildPortableStartCommand()` and `buildHostManagementCommand(command)`.
- Consumes: Host `repair --project-root`, fixed readiness endpoint, and PowerShell `Start-Process` only inside `START.cmd`.

- [x] **Step 1: Write portable script contract tests**

Create `tools/release/src/build-portable.test.ts` that imports both command builders and asserts:

```ts
const start = buildPortableStartCommand();
expect(start).toContain(' repair --project-root ');
const encoded = start.match(/-EncodedCommand ([A-Za-z0-9+/=]+)/)?.[1];
expect(encoded).toBeDefined();
const script = Buffer.from(encoded!, 'base64').toString('utf16le');
expect(script).toContain('http://127.0.0.1:43119/api/v1/runtime/ready');
expect(script.match(/Start-Process/g)).toHaveLength(1);

for (const command of ['install', 'repair', 'uninstall'] as const) {
  const maintenance = buildHostManagementCommand(command);
  expect(maintenance).not.toContain('EncodedCommand');
  expect(maintenance).not.toContain('127.0.0.1:43119');
}
```

- [x] **Step 2: Run release test and confirm red**

Run:

```powershell
& '.\node_modules\.bin\vitest.cmd' run --root . tools/release/src/build-portable.test.ts
```

Expected: FAIL because the builders are not exported and `START.cmd` still runs Host directly without a one-time interactive open.

- [x] **Step 3: Implement deterministic portable commands**

Export `buildPortableStartCommand()` and `buildHostManagementCommand()`. The START builder must:

1. call Host `repair` and stop on nonzero exit;
2. invoke an UTF-16LE base64-encoded PowerShell script;
3. poll readiness for at most 30 seconds at 250ms intervals;
4. call `Start-Process 'http://127.0.0.1:43119/'` exactly once only after `status = ready`;
5. return nonzero on timeout.

Keep install, repair, and uninstall builders URL-free and headless. Update the build call sites to use the exported names.

- [x] **Step 4: Update portable documentation**

Change `release/README.txt` so `START.cmd` is explicitly interactive and opens once after readiness, while all `*-AUTOSTART.cmd` scripts are documented as headless maintenance operations.

- [x] **Step 5: Run release tests and typecheck**

Run:

```powershell
corepack pnpm --filter @learning-more/release test
corepack pnpm --filter @learning-more/release typecheck
```

Expected: all release tests pass and TypeScript reports no errors.

- [x] **Step 6: Commit portable behavior**

```powershell
git add -- tools/release/src/build-portable.test.ts tools/release/src/build-portable.ts release/README.txt
git commit -m "fix(release): keep maintenance startup headless"
```

### Task 4: Verify and restore Windows Host ownership

**Files:**
- Verify: all files changed in Tasks 1-3
- External state: current verified development Launcher/Server process tree and `Learning MORE` scheduled task

**Interfaces:**
- Consumes: Host `repair`, Task Scheduler state, runtime readiness, and Win32 process parent identities.
- Produces: one Host-owned runtime chain with no periodic trigger or implicit browser opening.

- [x] **Step 1: Run all scoped tests and builds**

Run:

```powershell
corepack pnpm --filter @learning-more/launcher test
corepack pnpm --filter @learning-more/launcher typecheck
corepack pnpm --filter @learning-more/launcher build
corepack pnpm --filter @learning-more/host test
corepack pnpm --filter @learning-more/host typecheck
corepack pnpm --filter @learning-more/host build
corepack pnpm --filter @learning-more/release test
corepack pnpm --filter @learning-more/release typecheck
```

Expected: every command exits `0`.

- [x] **Step 2: Capture and verify the orphan process tree**

Read 43119/43120 owners and `Win32_Process` command lines. Continue only if 43119 is owned by `node tools\start-learning-more.mjs`, 43120 is its verified Server descendant, and both readiness endpoints report the same identity. Abort without terminating anything on mismatch.

- [x] **Step 3: Stop only the verified orphan and repair Host**

Stop the verified Server child and direct wrapper root by their observed PIDs, confirm both fixed ports are free, then run:

```powershell
node .\apps\host\dist\main.js repair --project-root .
```

Expected: Host CLI returns `state = installed`, `matches = true`, and Task Scheduler reports `Running`.

- [x] **Step 4: Verify task and process ownership**

Assert:

- exactly one `MSFT_TaskLogonTrigger`;
- empty repetition interval and `NextRunTime`;
- `IgnoreNew`, `RestartCount = 999`, `RestartInterval = PT1M`;
- persistent PowerShell runner parent service is Windows `Schedule`;
- Host parent is the persistent runner;
- Launcher parent is Host and Server parent is Launcher;
- 43119 and 43120 return `ready` with identical `instanceId`, `buildId`, and `protocolVersion`.

- [x] **Step 5: Verify no implicit browser path remains**

Run:

```powershell
rg -n "rundll32|FileProtocolHandler|openApplication|openBrowser" apps/launcher/src apps/host/src
```

Expected: no matches. Verify the wrapper tests prove default open count `0` and explicit open count `1`; do not invoke the real explicit browser command during this repair.

- [x] **Step 6: Record the final state**

Update this plan's checkboxes and append the test counts, Task Scheduler contract, process parent chain, readiness identity, and scoped commit IDs. Commit only this plan update:

```powershell
git add -- docs/superpowers/plans/2026-07-15-explicit-interactive-browser-launch.md
git commit -m "docs: record explicit browser launch repair"
```

## Self-Review Record

- Spec coverage: Launcher purity, explicit workspace open, portable interactive start, headless maintenance, orphan cleanup, Host ownership, and non-periodic scheduling each have a task.
- Placeholder scan: every behavior change, test, command, and expected result is concrete.
- Type consistency: `openApplication` and `openBrowser` are removed in Task 1; only `runInteractiveStart` and portable START retain explicit open capability.
- Safety: the live process tree is terminated only after command-line, port-owner, parent, and readiness identity checks succeed.

## Execution Record

Completed: 2026-07-15

- Scoped commits: `b0c2658`, `f087a44`, `c3f4beb`, `f506c80`, `e70bf98`, `92f6a06`, `ff1b79c`, and `960d32f`.
- Verification: Launcher 33 tests, Host 29 tests, release 21 tests, and interactive wrapper 6 tests passed; 89 non-overlapping tests total. Launcher and Host typechecks/builds and release typecheck passed.
- Browser-capability scan: current source and active Launcher release contain no `rundll32`, `FileProtocolHandler`, `openApplication`, or `openBrowser` production marker.
- Task contract: task `Learning MORE` is `Running`; it has exactly one `MSFT_TaskLogonTrigger`, no repetition interval, no `NextRunTime`, `MultipleInstances = IgnoreNew`, `RestartCount = 999`, `RestartInterval = PT1M`, and `ExecutionTimeLimit = PT0S`. Battery start/continue restrictions are disabled.
- Runtime ownership: Windows `Schedule` -> persistent PowerShell runner -> Host -> Launcher -> Server. The runner invokes Host directly, waits two seconds only after Host exits, and retries without adding a periodic Task Scheduler trigger.
- Live release: active `buildId = 960d32f09ec8-wdedc17b18ce0`; 43119 and 43120 reported `ready` with the same `instanceId = instance_23adacc1-9ed9-4093-bc20-e4fe1e5aa6bb`, build ID, protocol version, and identity fingerprint.
- HTTP verification: `http://127.0.0.1:43119/` returned `200` with `text/html; charset=utf-8`.
- Fault drill: after deliberately terminating Host, Launcher, and Server while preserving the runner, the same runner PID restarted all three layers; the new runtime became ready with a new instance identity while the task remained `Running`, its trigger count stayed one, and `LastRunTime` did not change.
