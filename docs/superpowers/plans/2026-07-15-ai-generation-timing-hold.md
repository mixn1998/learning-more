# AI generation timing hold implementation plan

## Objective

Pause formal-course effective learning time while AI is generating, while preserving generation completion and session-write safety.

## Task 1: Lock the server timing contract with tests

Files:

- `apps/server/src/modules/learning-session/tests/session-module.test.ts`

Steps:

1. Add a test that starts a lesson, records learner time, starts generation, waits, commits the matching reply, records more learner time, and verifies AI wait time is excluded.
2. Add a test that stops generation and verifies active timing resumes.
3. Extend the paused-generation test to preserve the invariant that completion persists without resuming time.
4. Cover resume or lease transfer during an active task so no interval is opened prematurely.

## Task 2: Implement the server interval transitions

Files:

- `apps/server/src/modules/learning-session/implementation/session-module.ts`
- `apps/server/src/modules/learning-session/implementation/time-intervals.ts`
- `apps/server/src/persistence/learning-session-repositories.ts`

Steps:

1. Add internal interval end reason `ai_generation`.
2. Close the interval when `StartSessionGeneration` succeeds.
3. Reopen after `CommitAssistantMessage` or `StopSessionGeneration` only when the evolved session is active and no task remains.
4. Apply the same run-condition to resume and lease-transfer interval opening.
5. Run focused server tests and type checking.

## Task 3: Lock the browser timer behaviour with tests

Files:

- `apps/web/src/features/learning/session-page.test.tsx`

Steps:

1. Use fake timers to hydrate an active session with an in-flight generation.
2. Verify elapsed time does not increase while the stream remains pending.
3. Complete the stream and verify elapsed time starts increasing again.

## Task 4: Implement browser hold and status copy

Files:

- `apps/web/src/features/learning/session-page.tsx`
- `apps/web/src/features/learning/lesson-session-workspace.tsx`

Steps:

1. Gate the local one-second timer on `phase !== 'generating'`.
2. Show “AI 思考中 · 计时已暂停” in the top status while generation is active.
3. Show “AI 思考中” with paused styling in the timer card.
4. Preserve manual pause, abandoned, stopped, input-disable, and generation-display behaviour.

## Task 5: Verify and activate

Steps:

1. Run focused server and web tests.
2. Run server/web type checks and builds.
3. Run formatting and `git diff --check` on touched files.
4. Confirm the local runtime activates the new build and its readiness endpoints remain healthy.

