# Paused Session AI Completion Design

## Problem

The learning page intentionally pauses an active session when the page enters the background so background time is not counted and new learner input is disabled. An AI generation already accepted before that pause continues running. Today, when it completes, `CommitAssistantMessage` rejects the result because the original session is `paused`, so a successful provider response is converted into `task.failed` and the generated opening is stranded as a draft.

## Confirmed behavior

- Entering the background continues to pause the learning timer.
- A paused session continues to reject new learner messages and new generation starts.
- An AI task accepted while the session was writable may commit its complete or interrupted assistant reply after the session becomes paused.
- The background commit is accepted only when all identities still match:
  - the current lesson record still contains the expected session ID;
  - the session's `activeGenerationTaskId` equals the completing generation task ID;
  - the command context still owns the current write lease through the original `pageInstanceId`.
- A different session, stale generation task, or replaced write lease is rejected without appending a message.
- Committing the assistant message clears `activeGenerationTaskId` but leaves the session state `paused`; it does not restart learning time.
- No frontend files need to change. Existing foreground resume behavior remains authoritative.

## Considered approaches

### 1. Permit a matching in-flight completion while paused — selected

Teach the learning-session domain command about `sessionId` and `generationTaskId`. Permit `commitAssistantMessage` in `active` or `paused`, while retaining lease validation in the application module. This preserves timing semantics and makes the exceptional background write narrowly auditable.

### 2. Delay pause until generation completes

This keeps the current write rule simple but incorrectly treats background generation time as active learning time and makes pause latency depend on provider latency.

### 3. Queue the result until the page returns to the foreground

This avoids writing to a paused session but leaves a completed reply unapplied when the learner never returns, complicates restart recovery, and increases duplicate-generation risk.

## Data flow

1. `StartSessionGeneration` records the accepted task ID while the session is active.
2. A browser lifecycle event pauses the session and closes the learning interval.
3. The provider finishes and interactive teaching saves the assistant draft.
4. `CommitAssistantMessage` carries lesson ID, session ID, generation task ID, message ID, and artifact reference.
5. The session module verifies the write lease; the domain verifies session and task identity and accepts the message in `active` or `paused`.
6. The message is appended, the active generation task is cleared, and the session remains paused.
7. The frame log emits `message.completed`, `artifact.ready`, and `task.completed`.

## Error handling

- Wrong page instance remains `write_lease_lost`.
- Wrong session ID or generation task ID is rejected as `session_conflict`.
- Frozen, closed, abandoned, completed, or missing sessions remain non-writable.
- A failed artifact save still emits `task.failed` and releases the generation slot through the existing cleanup path.

## Tests

- Learning-session module test: start generation, pause, commit the matching task, assert the assistant message exists, the generation slot is cleared, the session remains paused, and no additional time interval opens.
- Guard tests: wrong session ID, wrong task ID, and replaced lease cannot commit.
- Interactive-teaching integration test: pause while `agent.complete()` is pending, resolve the AI reply, and assert `task.completed` plus a persisted assistant message.
- Existing tests continue proving paused sessions reject learner input and active sessions support the normal teaching path.

## Scope

This change does not alter provider behavior, prompt generation, browser lifecycle events, course data, review generation, or public HTTP contracts. It changes only internal learning-session and interactive-teaching command semantics.

