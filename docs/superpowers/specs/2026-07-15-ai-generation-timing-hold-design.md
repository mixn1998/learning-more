# AI generation timing hold design

## Goal

In a formal-course learning session, count only the learner's active reading, thinking, and input time. Time spent waiting for an already-started AI response must not increase actual learning time.

## Behaviour

- Starting an AI generation closes the current learning-time interval with reason `ai_generation`.
- Completing, stopping, or failing that generation opens a new interval only when the learning session is still active.
- If the page moved to the background or the learner manually paused, an AI completion may still persist its full response but must not resume timing.
- Resuming or transferring the write lease while generation is still active must not open a learning-time interval.
- Reloading during generation keeps the visible timer held because the persisted `activeGenerationTaskId` restores the generating state.
- The UI explicitly labels the timer as held while AI is thinking, instead of showing “正在计时”.

## State model

The existing durable `activeGenerationTaskId` is the timing-hold signal. No new public session field is introduced.

Timing runs only when all of these are true:

1. lesson progress is `in_progress`;
2. session state is `active`;
3. there is no active generation task.

Server learning-time intervals remain the source of truth. The browser timer is only an optimistic display of the same rule.

## Command transitions

| Command | Interval result |
| --- | --- |
| `StartSessionGeneration` | Close an open interval as `ai_generation`. |
| `CommitAssistantMessage` | Reopen only after the matching task clears and the session is active. |
| `StopSessionGeneration` | Reopen only after the task clears and the session is active. |
| `PauseLesson` | Close any open interval; do not affect the running AI task. |
| `ResumeLesson` | Open only if no AI task is active. |
| `TransferSessionLease` | Reopen only if active and no AI task is active. |

All open/close operations retain their existing idempotent behaviour, preventing duplicate open intervals.

## Compatibility

The only persistence-schema extension is the internal interval end reason `ai_generation`. API response shapes and public interfaces remain unchanged. Existing support for completing a matching AI task after a session pause is preserved.

## Verification

- Server tests prove generation wait time is excluded, active completion resumes timing, paused completion does not resume timing, stop/failure resumes timing, and foreground resume/lease transfer cannot bypass a generation hold.
- Web tests prove the displayed timer stays fixed during restored generation and resumes after generation completes.
- Workspace status text distinguishes manual/background pause from AI-thinking hold.

