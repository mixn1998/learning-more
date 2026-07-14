# Provider Runtime Truth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the runtime status API and Codex CLI execution prove the currently applied model and reasoning effort across reloads and reconnects.

**Architecture:** The persisted Provider configuration remains the source of public model settings, while GenerationRuntime remains the source of health and capability truth. `ProviderConfigService.getStatus()` joins those sources into one sanitized applied-status response; the web hydrates from that response and uses catalog defaults only for a newly selected model.

**Tech Stack:** TypeScript 5.9, Zod, Vitest 4, React 19, React Testing Library.

## Global Constraints

- Never expose secret handles, secret fingerprints, credentials, or arbitrary private configuration.
- `gpt-5.6-sol/high` must survive browser reload, Runtime Center reopen, AI reconnect, and Server restart.
- “已连接” requires `configurationState = applied` and healthy runtime evidence.
- Catalog defaults are selection metadata, never the current configuration source.
- Keep the public site address at `http://127.0.0.1:43119/`.

---

## File Structure

- `packages/contracts/src/ai-runtime.ts`: public sanitized runtime status schema.
- `packages/contracts/src/ai-runtime.test.ts`: contract acceptance and secret rejection.
- `apps/server/src/runtime/provider-config-service.ts`: joins repository configuration with runtime health.
- `apps/server/src/runtime/provider-config-service.test.ts`: persistence/reconnect behavior at the service seam.
- `apps/server/src/ai-providers/codex-cli-adapter.test.ts`: proves the real command receives the selected effort.
- `apps/web/src/features/runtime/runtime-center.tsx`: hydrates controls from applied status.
- `apps/web/src/features/runtime/runtime-center.test.tsx`: user-visible reopen/reload behavior.

### Task 1: Extend the sanitized status contract

**Files:**
- Modify: `packages/contracts/src/ai-runtime.ts`
- Modify: `packages/contracts/src/ai-runtime.test.ts`

**Interfaces:**
- Produces: `ProviderRuntimeStatus.configurationState: 'applied' | 'connecting' | 'failed'`
- Produces: `ProviderRuntimeStatus.reasoningEffort?: string`

- [ ] **Step 1: Write the failing contract test**

```ts
it('accepts applied public configuration and rejects secret fields', () => {
  expect(
    ProviderRuntimeStatusSchema.parse({
      providerId: 'codex-cli',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      configurationState: 'applied',
      capabilities: { id: 'codex-cli', kind: 'cli', maxConcurrency: 1, supportsStreaming: true },
      health: { status: 'healthy' },
    }),
  ).toMatchObject({ reasoningEffort: 'high', configurationState: 'applied' });
  expect(() =>
    ProviderRuntimeStatusSchema.parse({
      providerId: 'codex-cli',
      configurationState: 'applied',
      capabilities: { id: 'codex-cli', kind: 'cli', maxConcurrency: 1, supportsStreaming: true },
      health: { status: 'healthy' },
      secretHandles: { apiKey: 'private' },
    }),
  ).toThrow();
});
```

- [ ] **Step 2: Run the contract test and observe RED**

Run: `corepack pnpm vitest run packages/contracts/src/ai-runtime.test.ts`

Expected: FAIL because `configurationState` and `reasoningEffort` are unknown.

- [ ] **Step 3: Add the strict public fields**

```ts
export const ProviderRuntimeStatusSchema = z.strictObject({
  providerId: ProviderIdSchema,
  model: z.string().trim().min(1).max(500).optional(),
  reasoningEffort: z.string().trim().min(1).max(100).optional(),
  configurationState: z.enum(['applied', 'connecting', 'failed']),
  capabilities: ProviderSwitchResponseSchema.shape.capabilities,
  health: z.strictObject({ status: z.enum(['healthy', 'unhealthy']) }),
});
```

- [ ] **Step 4: Run the contract test and observe GREEN**

Run: `corepack pnpm vitest run packages/contracts/src/ai-runtime.test.ts`

Expected: PASS.

### Task 2: Return the applied persisted configuration

**Files:**
- Modify: `apps/server/src/runtime/provider-config-service.test.ts`
- Modify: `apps/server/src/runtime/provider-config-service.ts`

**Interfaces:**
- Consumes: `ProviderRuntimeStatus` from Task 1.
- Produces: `getStatus(): Promise<ProviderRuntimeStatus>` with repository-backed public settings.

- [ ] **Step 1: Write a failing service test**

```ts
it('reports the applied persisted Codex model and reasoning effort after reconnect', async () => {
  const service = createProviderConfigService(fixture());
  await service.switchProvider({
    providerId: 'codex-cli',
    publicConfig: { model: 'gpt-5.6-sol', reasoningEffort: 'high' },
    secretHandles: {},
  });
  await service.reconnect();
  await expect(service.getStatus()).resolves.toMatchObject({
    providerId: 'codex-cli',
    model: 'gpt-5.6-sol',
    reasoningEffort: 'high',
    configurationState: 'applied',
    health: { status: 'healthy' },
  });
});
```

- [ ] **Step 2: Run the service test and observe RED**

Run: `corepack pnpm vitest run apps/server/src/runtime/provider-config-service.test.ts`

Expected: FAIL because `getStatus()` omits the effort and state.

- [ ] **Step 3: Join configuration and health without secrets**

Implement `getStatus()` so it awaits the runtime status and repository configuration, selects only string `model` and `reasoningEffort` from `publicConfig`, and returns `configurationState: 'applied'` only when the saved Provider is the current runtime Provider and health is healthy. Return `failed` otherwise. Do not spread `publicConfig`.

```ts
const publicSelection = (configuration: ProviderConfiguration | undefined) => ({
  ...(typeof configuration?.publicConfig.model === 'string'
    ? { model: configuration.publicConfig.model }
    : {}),
  ...(typeof configuration?.publicConfig.reasoningEffort === 'string'
    ? { reasoningEffort: configuration.publicConfig.reasoningEffort }
    : {}),
});
```

- [ ] **Step 4: Run service and bootstrap tests**

Run: `corepack pnpm vitest run apps/server/src/runtime/provider-config-service.test.ts apps/server/src/bootstrap/local-application.test.ts apps/server/src/http/routes/runtime.test.ts`

Expected: PASS; update existing exact status fixtures with `configurationState`.

### Task 3: Prove Codex CLI uses high after restoration

**Files:**
- Modify: `apps/server/src/ai-providers/codex-cli-adapter.test.ts`
- Modify only if RED proves it necessary: `apps/server/src/ai-providers/codex-cli-adapter.ts`

**Interfaces:**
- Consumes: `{ model: string; reasoningEffort: string }` public config.
- Produces: Codex CLI argument array containing the selected effort.

- [ ] **Step 1: Add a public-adapter behavior test**

```ts
it('passes the restored reasoning effort to Codex CLI generation', async () => {
  const spawn = vi.fn(() => successfulCodexChild());
  const adapter = createCodexCliAdapter({ spawn });
  await adapter.configure({ model: 'gpt-5.6-sol', reasoningEffort: 'high' });
  await collect(adapter.generate(requestFixture()));
  expect(spawn).toHaveBeenCalledWith(
    expect.any(String),
    expect.arrayContaining(['--model', 'gpt-5.6-sol', '--config', 'model_reasoning_effort="high"']),
    expect.objectContaining({ shell: false }),
  );
});
```

- [ ] **Step 2: Run the adapter test**

Run: `corepack pnpm vitest run apps/server/src/ai-providers/codex-cli-adapter.test.ts`

Expected: PASS if existing restoration already applies high; otherwise RED at the missing argument.

- [ ] **Step 3: If RED, minimally pass the configured effort**

Use the adapter's existing argument builder and add the exact supported Codex config argument. Do not introduce a second configuration store.

- [ ] **Step 4: Re-run the adapter test**

Run: `corepack pnpm vitest run apps/server/src/ai-providers/codex-cli-adapter.test.ts`

Expected: PASS.

### Task 4: Hydrate Runtime Center from applied status

**Files:**
- Modify: `apps/web/src/features/runtime/runtime-center.test.tsx`
- Modify: `apps/web/src/features/runtime/runtime-center.tsx`

**Interfaces:**
- Consumes: `ProviderRuntimeStatus.reasoningEffort` and `.configurationState`.
- Produces: controls that preserve active high on mount/reopen and use defaults only after a new model selection.

- [ ] **Step 1: Add the failing reopen test**

```tsx
it('shows the applied high effort instead of the model default after reopening', async () => {
  renderRuntimeCenter({
    providerStatus: {
      ...providerStatus,
      providerId: 'codex-cli',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      configurationState: 'applied',
    },
  });
  fireEvent.click(await screen.findByRole('button', { name: /Codex CLI/ }));
  expect(screen.getByLabelText('推理强度')).toHaveValue('high');
});
```

- [ ] **Step 2: Run the component test and observe RED**

Run: `corepack pnpm vitest run apps/web/src/features/runtime/runtime-center.test.tsx`

Expected: FAIL with current value `low`.

- [ ] **Step 3: Change hydration precedence**

When status and catalog load, set provider/model from status and set effort from `status.reasoningEffort`; only fall back to the selected catalog model default when there is no applied effort. Preserve the existing behavior that explicitly selecting a different model resets to that model's default.

- [ ] **Step 4: Re-run Runtime Center and client tests**

Run: `corepack pnpm vitest run apps/web/src/features/runtime/runtime-center.test.tsx apps/web/src/client/runtime-client.test.ts`

Expected: PASS.

### Task 5: Provider truth integration gate

**Files:**
- Modify as required by strict fixtures: `apps/server/src/http/routes/runtime.test.ts`, `apps/server/src/bootstrap/local-application.test.ts`, `apps/web/src/layouts/app-shell.tsx`

- [ ] **Step 1: Run the focused slice**

Run: `corepack pnpm vitest run packages/contracts/src/ai-runtime.test.ts apps/server/src/runtime/provider-config-service.test.ts apps/server/src/ai-providers/codex-cli-adapter.test.ts apps/server/src/http/routes/runtime.test.ts apps/web/src/client/runtime-client.test.ts apps/web/src/features/runtime/runtime-center.test.tsx`

Expected: PASS.

- [ ] **Step 2: Run type and architecture gates**

Run: `corepack pnpm typecheck`

Expected: PASS.

Run: `corepack pnpm architecture:check`

Expected: PASS.

- [ ] **Step 3: Commit this independently reviewable slice**

```bash
git add packages/contracts/src/ai-runtime.ts packages/contracts/src/ai-runtime.test.ts apps/server/src/runtime/provider-config-service.ts apps/server/src/runtime/provider-config-service.test.ts apps/server/src/ai-providers/codex-cli-adapter.ts apps/server/src/ai-providers/codex-cli-adapter.test.ts apps/server/src/bootstrap/local-application.test.ts apps/server/src/http/routes/runtime.test.ts apps/web/src/features/runtime/runtime-center.tsx apps/web/src/features/runtime/runtime-center.test.tsx apps/web/src/client/runtime-client.test.ts
git commit -m "fix: report applied provider configuration"
```
