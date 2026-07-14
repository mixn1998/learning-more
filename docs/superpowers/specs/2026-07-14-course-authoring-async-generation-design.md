# Course Authoring Async Generation Design

## Problem

Course outline generation currently returns `202 Accepted` only after the configured AI provider has finished. The HTTP route waits for the course-authoring facade, the facade waits for the candidate-generation coordinator, and the coordinator waits for `GenerationRuntime.runNext()`. A real Codex CLI request took 63.7 seconds before the browser received a task id. During that interval the browser cannot subscribe to the generation event stream or recover the authoritative session state. The candidate may be committed successfully while the page remains stale until a manual reload.

The previous terminal refresh and bounded polling changes run only after the task id and terminal SSE event are available, so they cannot repair this pre-acceptance gap.

## Goals

- Return a durable generation task id immediately after the task and outline-session state are committed.
- Execute provider work outside the request lifecycle.
- Preserve provider configuration, model parameters, fallback, retries, cancellation, and immutable candidate compilation.
- Deliver the completed candidate without a manual page refresh.
- Resume an active generation after page reload, runtime reconnect, or process restart.
- Apply the same behavior to explicit candidate generation and alignment-triggered patch/regenerate operations.

## Non-goals

- Streaming partial Codex CLI tokens directly from the child process into SSE. The current runtime persists the draft and the coordinator publishes the completed draft as a replayable `message.delta`; this design preserves that behavior.
- Replacing the existing durable generation runtime or frame log.
- Changing candidate validation or the outline Markdown contract.

## Chosen Architecture

### Candidate coordinator boundary

`CandidateGenerationCoordinator.generate()` becomes an acceptance operation:

1. Assemble the authoring context and prompt input.
2. Call `CourseAuthoringModule.requestCandidate()` to submit or reuse a durable task and persist `generating-candidates` plus `activeCandidateTaskId`.
3. Ensure the replayable frame log knows the task.
4. Read the committed outline-session version.
5. Dispatch background finalization and return `{ taskId, state: 'running', resourceVersion, draftArtifactRef }` without awaiting provider execution.

Background finalization is a separate private operation. It awaits the existing `GenerationExecution` terminal state, compiles and commits the candidate, then appends `message.*`, `artifact.ready`, and `task.completed` frames. Provider, validation, timeout, and unexpected failures transition the outline session out of `generating-candidates` and append one terminal failure frame. Cancellation owns the `task.cancelled` terminal frame and is not rewritten as a provider failure.

The coordinator accepts an injectable background dispatcher for deterministic tests. Production dispatch uses a microtask and catches background errors after the session and frame log have been updated.

### Durable recovery

The coordinator exposes `recover({ outlineSessionId, taskId })`. Recovery directly finalizes the recorded task instead of submitting a new command. This handles both queued/running tasks and the crash window where provider execution completed but candidate compilation did not.

Startup recovery scans sessions in `generating-candidates` and calls `recover` for their `activeCandidateTaskId` before draining unrelated queued work. Duplicate in-process finalization is suppressed by task id.

### HTTP and application behavior

The existing candidate-generation route remains `202 Accepted`, but now returns after durable acceptance. Alignment `patch` and `regenerate` continue to be initiated by the message command; because coordinator generation is now acceptance-only, the message response also returns without waiting for the provider.

No new endpoint is required.

### Session projection and frontend recovery

`OutlineSessionViewResponse` gains optional `generationTaskId`. The server includes it only while the session has an active candidate task.

The authoring page has one owner for generation observation:

- Request handlers only submit work and apply the accepted/session response.
- A React effect observes `(phase, outlineSessionId, generationTaskId)`.
- When the phase is generating and a task id exists, the effect connects to SSE.
- Terminal completion reloads the authoritative candidate session; terminal failure/cancellation reloads the authoritative retry state.
- Stream interruption reconnects while the server still reports `generating-candidates`, with bounded backoff under the existing 120-second operation deadline.
- Loading a saved generating session automatically activates the same effect, so browser refresh and runtime reconnect do not require a special button.

`session-loaded` explicitly clears a stale task id when the server no longer reports one.

## Error and Concurrency Rules

- A task is accepted only after both generation-task and outline-session writes succeed.
- `task.completed` is appended only after the candidate and session transition are durable.
- A background exception must not leave a non-terminal session without a recoverable failure transition.
- Duplicate command receipts reuse the same task id and do not launch duplicate finalizers.
- In-process finalizers are deduplicated by task id.
- Cancelling a task aborts the browser stream, cancels the runtime task, persists the retryable session state, and publishes `task.cancelled` once.
- Version conflicts continue to use existing optimistic concurrency behavior.

## Verification

- Coordinator test: an unresolved provider does not delay `generate()` acceptance; running the captured background work later commits the candidate and terminal frames.
- Coordinator recovery test: a terminal provider task with a still-generating session is compiled on recovery.
- Facade test: alignment patch returns a message response with the session in `generating-candidates` before provider completion.
- Contract/route test: generating session views include `generationTaskId` and accepted responses remain schema-valid.
- Frontend test: accepted task connects to SSE and displays persisted Markdown without reload.
- Frontend restore test: loading a `generating-candidates` session with a task id reconnects and displays the candidate.
- Frontend interruption test: a transient stream failure reloads state and reconnects instead of silently exhausting a five-second poll.
- Existing cancellation, fallback, candidate validation, E2E authoring, typecheck, and build suites remain green.

