# Runtime Center Codex CLI Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every hard-coded Codex model option with the live Codex CLI catalog, make the CLI a real usable Provider, and restore one-click local-service reconnection.

**Architecture:** A deep `CodexCliAdapter` module owns executable discovery, authentication/catalog probing, command construction, process execution, and safe error mapping. Generation Runtime exposes one Provider catalog interface to Server and Web; Launcher validates control writes against the same rotating capability it publishes. Web renders only returned catalog data and treats local-service recovery separately from AI recovery.

**Tech Stack:** Node.js 24, TypeScript 5.9, Fastify, React 19, Zod, Vitest, Playwright, pnpm 10.

## Global Constraints

- Keep the only user-facing address at `http://127.0.0.1:43119/`; do not add a public port.
- Do not expose credentials, capability values in logs, full user paths, or raw Codex configuration.
- Keep `shell: false`, use argument arrays, and terminate the CLI child when the abort signal fires.
- Do not scan or execute another Windows user's installation directory.
- Do not retain a static Codex model allowlist in Server or Web.
- When authentication is missing, launch exactly one current-user `codex login` process and let Codex CLI open the official verification page; never expose credentials or OAuth callbacks to Web.
- Keep the existing visual layout, typography, spacing, accessibility semantics, and course-mode themes.
- Provider switching remains validate-first and rollback-safe.

---

## File Structure

- Create `apps/server/src/ai-providers/codex-cli-adapter.ts`: deep module for discovery, probing, catalog parsing, and generation command execution.
- Create `apps/server/src/ai-providers/codex-cli-adapter.test.ts`: adapter seam tests with injected process and filesystem adapters.
- Modify `apps/server/src/ai-providers/provider.ts`: shared public model descriptor and optional Provider catalog method.
- Modify `apps/server/src/ai-providers/cli-provider.ts`: delegate Codex behavior to the adapter and validate dynamic model selections.
- Modify `apps/server/src/modules/generation-runtime/implementation/generation-runtime.ts`: expose the Provider catalog through one runtime interface.
- Modify `apps/server/src/runtime/provider-config-service.ts`: return the catalog and revalidate dynamic model selection before switching.
- Modify `apps/server/src/http/routes/runtime.ts`: expose `GET /api/v1/ai-runtime/providers`.
- Modify `apps/server/src/bootstrap/main.ts`: auto-discover and register Codex CLI without a required manual environment variable.
- Modify `packages/contracts/src/ai-runtime.ts`: add strict catalog contracts.
- Modify `apps/launcher/src/control-server.ts` and `apps/launcher/src/main.ts`: use a live capability getter.
- Modify `apps/web/src/client/runtime-client.ts`: fetch the Provider catalog and retry one expired capability once.
- Modify `apps/web/src/features/runtime/runtime-center.tsx`: render models/reasoning levels dynamically and separate local/AI recovery results.
- Modify focused tests beside each file and update the final acceptance report.

### Task 1: Contracts and Provider Catalog Interface

**Files:**
- Modify: `packages/contracts/src/ai-runtime.ts`
- Create: `packages/contracts/src/ai-runtime.test.ts`
- Modify: `apps/server/src/ai-providers/provider.ts`

**Interfaces:**
- Produces: `ProviderModelOption`, `ProviderCatalogEntry`, `ProviderCatalog`, and `ProviderCatalogSchema`.
- Produces: optional `AiProvider.listModels(options?: { refresh?: boolean }): Promise<readonly ProviderModelOption[]>`.

- [ ] **Step 1: Write the failing contract test**

```ts
expect(
  ProviderCatalogSchema.parse({
    providers: [{
      providerId: 'codex-cli',
      capabilities: { id: 'codex-cli', kind: 'cli', maxConcurrency: 2, supportsStreaming: true },
      health: { status: 'healthy' },
      models: [{
        id: 'gpt-5.6-sol',
        displayName: 'GPT-5.6-Sol',
        defaultReasoningEffort: 'low',
        supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
      }],
    }],
  }),
).toMatchObject({ providers: [{ providerId: 'codex-cli' }] });
```

- [ ] **Step 2: Run the test and verify `ProviderCatalogSchema` is missing**

Run: `corepack pnpm vitest run packages/contracts/src/ai-runtime.test.ts`

Expected: FAIL because the new schema is not exported.

- [ ] **Step 3: Add strict schemas and shared Provider model type**

```ts
export const ProviderModelOptionSchema = z.strictObject({
  id: z.string().trim().min(1).max(500),
  displayName: z.string().trim().min(1).max(500),
  defaultReasoningEffort: z.string().trim().min(1).max(100),
  supportedReasoningEfforts: z.array(z.string().trim().min(1).max(100)).min(1),
});
export const ProviderCatalogSchema = z.strictObject({
  providers: z.array(z.strictObject({
    providerId: ProviderIdSchema,
    capabilities: ProviderSwitchResponseSchema.shape.capabilities,
    health: z.strictObject({ status: z.enum(['healthy', 'unhealthy']), message: z.string().optional() }),
    models: z.array(ProviderModelOptionSchema),
  })),
});
```

- [ ] **Step 4: Run the contract test**

Run: `corepack pnpm vitest run packages/contracts/src/ai-runtime.test.ts`

Expected: PASS.

### Task 2: Deep Codex CLI Adapter

**Files:**
- Create: `apps/server/src/ai-providers/codex-cli-adapter.ts`
- Create: `apps/server/src/ai-providers/codex-cli-adapter.test.ts`
- Modify: `apps/server/src/ai-providers/cli-provider.ts`
- Modify: `apps/server/src/ai-providers/cli-provider.test.ts`

**Interfaces:**
- Produces: `discoverCodexCliExecutable(options): Promise<string | undefined>`.
- Produces: `createCodexCliAdapter(options): CodexCliAdapter` with `probe`, `listModels`, `validateSelection`, `startLogin`, and `generate`.
- Consumes: `ProviderModelOption` and `ProviderDelta`.

- [ ] **Step 1: Write failing discovery, catalog, selection, and argv tests**

```ts
expect(await discoverCodexCliExecutable({ override: valid, runVersion, pathCandidates, localCandidates }))
  .toBe(valid);
expect(await adapter.listModels({ refresh: true })).toEqual([
  { id: 'gpt-5.6-sol', displayName: 'GPT-5.6-Sol', defaultReasoningEffort: 'low', supportedReasoningEfforts: ['low', 'high'] },
]);
await expect(adapter.validateSelection('missing', 'high')).resolves.toEqual({ valid: false, message: 'model' });
expect(spawnCall.arguments).toContain('exec');
expect(spawnCall.arguments).toContain('--ephemeral');
expect(spawnCall.options.shell).toBe(false);
await expect(adapter.startLogin()).resolves.toBe('started');
await expect(adapter.startLogin()).resolves.toBe('started');
expect(loginSpawn).toHaveBeenCalledTimes(1);
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `corepack pnpm vitest run apps/server/src/ai-providers/codex-cli-adapter.test.ts apps/server/src/ai-providers/cli-provider.test.ts`

Expected: FAIL because discovery and dynamic catalog behavior do not exist.

- [ ] **Step 3: Implement executable discovery**

Use the explicit override first, then executable `PATH` candidates, then `%LOCALAPPDATA%/OpenAI/Codex/bin/*/codex.exe` candidates sorted newest-first. Validate each with `--version` through an injected `execFile` adapter and a bounded timeout.

- [ ] **Step 4: Implement strict probe and catalog normalization**

Run `login status`, reject non-zero or non-authenticated output, run `debug models`, parse only models with `visibility === 'list'`, and normalize `slug`, `display_name`, `default_reasoning_level`, and `supported_reasoning_levels[].effort`. Cache successful catalogs for 60 seconds; `{ refresh: true }` bypasses the cache.

- [ ] **Step 5: Implement real generation argv**

```ts
const args = [
  'exec', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only',
  '--model', request.model,
  '-c', `model_reasoning_effort=${JSON.stringify(request.reasoningEffort)}`,
  request.prompt,
];
```

Capture only the final stdout text, map non-zero exit to `ProviderExecutionError`, and kill the child on abort.

- [ ] **Step 6: Implement idempotent interactive login start**

Check `login status` first. If authenticated, return `already_authenticated`; otherwise spawn `[executable, 'login']` with `shell: false`, allow Codex CLI to open the official browser flow, retain the running child promise, and return `started` for repeated calls until it exits.

- [ ] **Step 7: Run focused tests**

Run: `corepack pnpm vitest run apps/server/src/ai-providers/codex-cli-adapter.test.ts apps/server/src/ai-providers/cli-provider.test.ts`

Expected: PASS.

### Task 3: Server Catalog and Automatic Registration

**Files:**
- Modify: `apps/server/src/modules/generation-runtime/implementation/generation-runtime.ts`
- Modify: `apps/server/src/modules/generation-runtime/tests/provider-contract.test.ts`
- Modify: `apps/server/src/runtime/provider-config-service.ts`
- Modify: `apps/server/src/runtime/provider-config-service.test.ts`
- Modify: `apps/server/src/http/routes/runtime.ts`
- Modify: `apps/server/src/http/routes/runtime.test.ts`
- Modify: `apps/server/src/bootstrap/local-application.ts`
- Modify: `apps/server/src/bootstrap/main.ts`

**Interfaces:**
- Produces: `GenerationRuntime.getProviderCatalog(options?: { refresh?: boolean }): Promise<ProviderCatalog>`.
- Produces: `GET /api/v1/ai-runtime/providers`.
- Produces: `POST /api/v1/ai-runtime/providers/codex-cli/login` returning `{ state: 'started' | 'already_authenticated' }`.
- Consumes: `discoverCodexCliExecutable` and `createCodexCliAdapter`.

- [ ] **Step 1: Write failing runtime, route, and config tests**

```ts
await expect(runtime.getProviderCatalog({ refresh: true })).resolves.toMatchObject({
  providers: [{ providerId: 'codex-cli', models: [{ id: 'gpt-5.6-sol' }] }],
});
const response = await app.inject({ method: 'GET', url: '/api/v1/ai-runtime/providers' });
expect(response.statusCode).toBe(200);
expect(response.json().providers[0].models[0].id).toBe('gpt-5.6-sol');
const login = await app.inject({ method: 'POST', url: '/api/v1/ai-runtime/providers/codex-cli/login', payload: {} });
expect(login.json()).toEqual({ state: 'started' });
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `corepack pnpm vitest run apps/server/src/modules/generation-runtime/tests/provider-contract.test.ts apps/server/src/runtime/provider-config-service.test.ts apps/server/src/http/routes/runtime.test.ts`

Expected: FAIL because catalog methods and route are missing.

- [ ] **Step 3: Add the runtime catalog and model validation**

For every registered Provider, return capabilities, current health, and `listModels()` output. Before switching a CLI Provider, re-read its catalog and reject absent model/reasoning pairs without changing current state.

- [ ] **Step 4: Add the catalog route and local-application wiring**

Parse the returned value with `ProviderCatalogSchema` at the route seam. Map internal probe failures to an unhealthy catalog entry rather than failing the whole Provider list.

- [ ] **Step 5: Auto-register Codex CLI in bootstrap**

Discover the executable before constructing `additionalProviders`. Register `codex-cli` only when discovery succeeds; otherwise leave a stable unavailable catalog signal for Web and keep Mock operational.

- [ ] **Step 6: Run focused tests**

Run: `corepack pnpm vitest run apps/server/src/modules/generation-runtime/tests/provider-contract.test.ts apps/server/src/runtime/provider-config-service.test.ts apps/server/src/http/routes/runtime.test.ts apps/server/src/bootstrap/local-application.test.ts`

Expected: PASS.

### Task 4: Launcher Capability Rotation and Retry

**Files:**
- Modify: `apps/launcher/src/control-server.ts`
- Modify: `apps/launcher/src/control-server.test.ts`
- Modify: `apps/launcher/src/main.ts`
- Modify: `apps/web/src/client/runtime-client.ts`
- Modify: `apps/web/src/client/runtime-client.test.ts`

**Interfaces:**
- Replaces: `capability: { value, expiresAt }` with `getCapability(): { value, expiresAt }`.
- Produces: one automatic capability refresh/retry on `403 control_capability_invalid`.

- [ ] **Step 1: Write failing rotation and retry tests**

```ts
let current = { value: 'capability_01', expiresAt: Date.now() + 60_000 };
const control = await buildControlServer({ getCapability: () => current, ...dependencies });
current = { value: 'capability_02', expiresAt: Date.now() + 60_000 };
expect((await control.inject(authorizedWith('capability_02'))).statusCode).toBe(200);
expect(fetch).toHaveBeenCalledTimes(4); // status, failed write, refreshed status, retried write
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `corepack pnpm vitest run apps/launcher/src/control-server.test.ts apps/web/src/client/runtime-client.test.ts`

Expected: FAIL because control validation uses the initial snapshot and Web does not retry.

- [ ] **Step 3: Implement live capability validation**

Call `getCapability()` once per request. `GET /control/v1/status` and the following write must use the same mutable capability state supplied by Local Runtime.

- [ ] **Step 4: Implement one browser retry**

On exactly `403`, clear both session keys, fetch a fresh control status, and retry the write once. Other errors and a second 403 fail immediately.

- [ ] **Step 5: Run focused tests**

Run: `corepack pnpm vitest run apps/launcher/src/control-server.test.ts apps/launcher/src/main.test.ts apps/web/src/client/runtime-client.test.ts`

Expected: PASS.

### Task 5: Dynamic Runtime Center

**Files:**
- Modify: `apps/web/src/client/runtime-client.ts`
- Modify: `apps/web/src/features/runtime/runtime-center.tsx`
- Modify: `apps/web/src/features/runtime/runtime-center.test.tsx`
- Modify: `apps/web/src/features/runtime/runtime-center.css` only if an existing field layout needs the reasoning selector.

**Interfaces:**
- Adds: `RuntimeCenterClient.getProviderCatalog(options?: { refresh?: boolean }): Promise<ProviderCatalog>`.
- Adds: `RuntimeCenterClient.startCodexLogin(command): Promise<{ state: 'started' | 'already_authenticated' }>`.
- Consumes: catalog model descriptors; no local model constants.

- [ ] **Step 1: Write failing UI tests**

```tsx
expect(screen.queryByText(/gpt-5\.6-luna/)).not.toBeInTheDocument();
expect(screen.getByRole('option', { name: /GPT-5\.6-Sol.*low/ })).toHaveValue('gpt-5.6-sol');
await user.selectOptions(screen.getByLabelText('推理强度'), 'ultra');
expect(api.switchProvider).toHaveBeenCalledWith(expect.objectContaining({
  publicConfig: { model: 'gpt-5.6-sol', reasoningEffort: 'ultra' },
}), expect.anything());
await user.click(screen.getByRole('button', { name: '登录 Codex' }));
expect(api.startCodexLogin).toHaveBeenCalledOnce();
```

- [ ] **Step 2: Run focused UI test and verify it fails**

Run: `corepack pnpm vitest run apps/web/src/features/runtime/runtime-center.test.tsx`

Expected: FAIL because options are hard-coded and the catalog client method is absent.

- [ ] **Step 3: Load status and catalog together**

Use `Promise.all` on mount and on “重新检查”. Derive card availability, model options, selected default effort, and button disabled state from the returned catalog.

- [ ] **Step 4: Replace the hard-coded selector**

Map `selectedProvider.models` to `<option>` elements and add a reasoning selector mapped from the selected model. When no CLI model exists, render one disabled “未发现可用模型” option and disable switching.

- [ ] **Step 5: Separate local and AI recovery outcomes**

Mark the local sequence complete immediately after verified readiness. Run AI reconnect/refresh afterward; if it fails, retain completed local stages and expose a separate AI alert.

- [ ] **Step 6: Add login start and bounded status polling**

When the catalog reports `codex_cli_not_authenticated`, show “登录 Codex”. After the start request succeeds, poll a forced catalog refresh every two seconds for at most two minutes, stop on unmount, and automatically populate the model/reasoning selectors when health becomes healthy.

- [ ] **Step 7: Run focused tests**

Run: `corepack pnpm vitest run apps/web/src/client/runtime-client.test.ts apps/web/src/features/runtime/runtime-center.test.tsx`

Expected: PASS.

### Task 6: Build, Live Recovery, and Real CLI Acceptance

**Files:**
- Modify: `docs/superpowers/reports/2026-07-14-frontend-final-acceptance.md`
- Modify: this plan, checking completed steps.

**Interfaces:**
- Consumes the stable site at `http://127.0.0.1:43119/` and the installed Codex CLI.
- Produces final evidence for model parity, Provider health, real generation, and service recovery.

- [ ] **Step 1: Run focused suites, typecheck, and production build**

Run: `corepack pnpm vitest run packages/contracts/src/ai-runtime.test.ts apps/server/src/ai-providers/codex-cli-adapter.test.ts apps/server/src/ai-providers/cli-provider.test.ts apps/server/src/http/routes/runtime.test.ts apps/server/src/runtime/provider-config-service.test.ts apps/launcher/src/control-server.test.ts apps/web/src/client/runtime-client.test.ts apps/web/src/features/runtime/runtime-center.test.tsx`

Run: `corepack pnpm typecheck`

Run: `corepack pnpm build`

Expected: all PASS.

- [ ] **Step 2: Restart the single-address Launcher with explicit test-safe environment**

Set `LEARNING_MORE_CODEX_CLI_EXECUTABLE` to the discovered current-user executable only for the sandboxed acceptance run, start `node tools/start-learning-more.mjs`, and verify `/`, `/api/v1/runtime/ready`, `/api/v1/ai-runtime/providers`, and `/control/v1/status`.

- [ ] **Step 3: Compare UI and CLI catalogs**

Run `codex debug models`, extract visible model IDs/efforts, open `/runtime`, and assert exact equality with the option values and reasoning choices. Expected on the current machine: `gpt-5.6-sol` with `low`, `medium`, `high`, `xhigh`, `max`, `ultra`; no Luna entries.

- [ ] **Step 4: Execute a real Codex CLI smoke**

Switch to `codex-cli`, submit a minimal prompt, and assert a non-empty final response. Do not persist or print credentials.

Also verify the login-start route with an injected unauthenticated Adapter: one click starts one `codex login` process and the simulated successful callback causes the UI catalog to refresh. Do not log out the user's real Codex session for this test.

- [ ] **Step 5: Drill one-click recovery**

Terminate only the verified internal Server child, confirm `/` stays 200, trigger the UI reconnect action, and verify a new matching instance becomes ready without a 403.

- [ ] **Step 6: Run final project gates**

Run: `corepack pnpm verify`

Run: `corepack pnpm product-ui:check`

Expected: PASS. Record any environment-only release limitation separately from product code failures.

- [ ] **Step 7: Update acceptance evidence and mark this plan complete**

Record commands, counts, live URLs, model parity, PID/instance change, and any residual deployment work in the final acceptance report. Check every completed plan item.
