# Real Provider Connections, Model Propagation, and Fallback Design

## Goal

Enable Learning MORE to execute generation through real OpenAI-compatible HTTP and CLI providers, propagate model/configuration safely, and retry through an ordered fallback policy without changing an in-flight attempt after its first valid delta.

## Design

`AiProvider` remains the runtime seam. The normalized request gains the model and immutable execution metadata needed by adapters. API and CLI adapters perform real I/O, while Mock remains deterministic for tests.

Provider configuration is validated before activation. Public configuration and a fingerprint are persisted; secrets remain in the existing SecretStore. Generation tasks persist the selected provider, model, configuration fingerprint, and fallback policy so a later provider switch cannot alter an existing task.

Fallback is attempted only before the first valid output delta. Retryable failures are transport failures, timeouts, HTTP 429/5xx, and provider process failures. Authentication, invalid configuration, invalid output, cancellation, and post-delta failures are terminal for the current task. Every attempt records its provider, model, and error.

The API adapter uses `fetch` against `{baseUrl}/chat/completions`, sends `model`, `messages`, and `stream: true`, and parses SSE `data:` frames through `[DONE]`. The CLI adapter uses `spawn` with `shell: false`, explicit argv substitution, constrained cwd/environment, and stdout as streaming text.

## Invariants

- API keys never enter tasks, logs, frontend responses, command-line arguments, or ordinary project files.
- A task submitted with `providerId = current` resolves the current provider and model into its immutable execution snapshot.
- A provider switch affects only tasks submitted afterward.
- Fallback never concatenates output from two providers after the first valid delta.
- Domain modules still validate and commit generated artifacts; Provider completion alone never commits business state.

## Verification

- Contract tests cover Mock, API, and CLI providers.
- API tests cover request model propagation, authorization, SSE parsing, HTTP errors, and abort.
- CLI tests cover argv/model propagation, streaming stdout, non-zero exit, and shell-injection-safe argument handling.
- Runtime tests cover pre-delta fallback, post-delta no-fallback, attempt snapshots, and provider switching.
- Existing Mock-based unit and E2E tests remain the default offline test path.
