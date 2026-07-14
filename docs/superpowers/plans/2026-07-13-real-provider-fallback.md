# Real Provider Connections and Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement real OpenAI-compatible API and CLI generation, model propagation, and ordered automatic fallback in Learning MORE.

**Architecture:** Keep `AiProvider` as the adapter seam. Extend normalized generation requests and persisted generation tasks with immutable model/config/attempt metadata, implement real fetch/SSE and spawn adapters, then let GenerationRuntime execute a fallback policy only before the first valid delta.

**Tech Stack:** TypeScript, Node.js `fetch`, `child_process.spawn`, Fastify contracts, Vitest, existing SecretStore and LocalFile persistence.

## Global Constraints

- Mock Provider remains the deterministic default for tests.
- Secrets remain outside tasks, logs, frontend responses, prompts, and CLI argv.
- `shell: false` is mandatory for CLI execution.
- Provider switching is validated and atomic; existing tasks keep their execution snapshot.
- Domain modules remain the only committers of generated business artifacts.

---

### Task 1: Extend provider and generation contracts

**Files:**
- Modify: `apps/server/src/ai-providers/provider.ts`
- Modify: `apps/server/src/modules/generation-runtime/interface.ts`
- Modify: `apps/server/src/modules/generation-runtime/ports/generation-task-repository.ts`
- Modify: `apps/server/src/persistence/local-file-repositories.ts`
- Test: `apps/server/src/modules/generation-runtime/tests/provider-contract.test.ts`

- [ ] Add `model?: string`, `providerConfigFingerprint?: string`, and immutable `attempt` metadata to normalized requests/tasks.
- [ ] Add explicit `ProviderExecutionError` classification for retryable, pre-delta, and authentication/configuration failures.
- [ ] Update schemas and fixtures so old Mock tests remain valid when model/config fields are omitted.
- [ ] Run the generation and provider contract tests.

### Task 2: Implement OpenAI-compatible HTTP/SSE provider

**Files:**
- Modify: `apps/server/src/ai-providers/api-provider.ts`
- Create: `apps/server/src/ai-providers/api-provider.test.ts`

- [ ] Validate `baseUrl`, `model`, optional timeout, and API key availability through `SecretResolver`.
- [ ] Send `POST {baseUrl}/chat/completions` with `model`, `messages`, and `stream: true`.
- [ ] Parse SSE data frames, emit only non-empty `choices[0].delta.content`, stop at `[DONE]`, and abort the request through `AbortSignal`.
- [ ] Map 401/403 and malformed responses to non-fallback errors; map 429/5xx/network/timeout to retryable errors.
- [ ] Test exact request body, authorization header, SSE chunks, abort, and error classes without network access.

### Task 3: Implement secure CLI provider

**Files:**
- Modify: `apps/server/src/ai-providers/cli-provider.ts`
- Create: `apps/server/src/ai-providers/cli-provider.test.ts`

- [ ] Validate executable, cwd, argv template, and allowed environment names.
- [ ] Substitute only `{taskId}`, `{model}`, and `{prompt}` into argv values; pass prompt as one argv value and never construct a shell string.
- [ ] Spawn with `shell: false`, `windowsHide: true` on Windows, explicit cwd/env, and abort handling.
- [ ] Emit stdout chunks as text deltas and map non-zero exit to a retryable process error.
- [ ] Test model propagation, argument boundaries, shell-injection strings, stdout streaming, and abort.

### Task 4: Persist provider configuration snapshots and wire runtime activation

**Files:**
- Modify: `apps/server/src/runtime/provider-config-service.ts`
- Modify: `apps/server/src/modules/generation-runtime/implementation/generation-runtime.ts`
- Modify: `apps/server/src/bootstrap/local-application.ts`
- Modify: `apps/server/src/bootstrap/main.ts`
- Test: `apps/server/src/runtime/provider-config-service.test.ts`
- Test: `apps/server/src/bootstrap/local-application.test.ts`

- [ ] Add configured provider factories for API and CLI while retaining injected providers for tests.
- [ ] Resolve and validate candidate configuration before activation; persist public config, secret handles, and fingerprint atomically.
- [ ] Snapshot provider/model/config fingerprint into each submitted task.
- [ ] Ensure an already-submitted task resolves its snapshot even after a later provider switch.
- [ ] Add environment/config examples without adding real secrets to the repository.

### Task 5: Implement ordered fallback in GenerationRuntime

**Files:**
- Modify: `apps/server/src/modules/generation-runtime/interface.ts`
- Modify: `apps/server/src/modules/generation-runtime/implementation/generation-runtime.ts`
- Modify: `apps/server/src/modules/generation-runtime/ports/generation-task-repository.ts`
- Create: `apps/server/src/modules/generation-runtime/tests/fallback.test.ts`

- [ ] Accept `primaryProviderId`, ordered `fallbackProviderIds`, and `maxAttempts` on generation requests.
- [ ] Persist an attempt before invoking a provider.
- [ ] On retryable failure with zero emitted deltas, select the next provider and retry with the same prompt/model snapshot policy.
- [ ] Once any valid delta is persisted, disable fallback and mark later failure terminal.
- [ ] Never retry cancellation, auth/config errors, malformed domain output, or domain commit failures.
- [ ] Test primary success, pre-delta fallback, exhausted fallback, post-delta failure, cancellation, and provider-switch isolation.

### Task 6: Update status contracts, docs, and verification

**Files:**
- Modify: `packages/contracts/src/ai-runtime.ts`
- Modify: `apps/server/src/http/routes/runtime.ts`
- Modify: `docs/基础模块功能等价清单与回归基线.md`
- Modify: `CHANGELOG.md`

- [ ] Expose configured model and actual provider without exposing secrets.
- [ ] Document API-compatible and CLI configuration, fallback ordering, and failure semantics.
- [ ] Run focused Vitest suites, TypeScript checks, and the existing provider-switch/runtime E2E tests.
- [ ] Run the repository verification command and report any unrelated pre-existing failures separately.
