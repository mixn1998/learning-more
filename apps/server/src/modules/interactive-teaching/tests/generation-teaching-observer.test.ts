import type { GenerationRequest, GenerationRuntime } from '../../generation-runtime/interface.js';
import type { GenerationTask } from '../../generation-runtime/ports/generation-task-repository.js';
import { describe, expect, it } from 'vitest';

import { createGenerationTeachingObserver } from '../implementation/generation-teaching-observer.js';
import { teachingObservationLens } from '../implementation/teaching-observation-lens.js';
import { createTeachingState } from '../implementation/teaching-state-reducer.js';

describe('GenerationTeachingObserver', () => {
  it('uses mode-neutral local evidence and parses a source-bound observation', async () => {
    let request: GenerationRequest | undefined;
    const output = {
      observationId: 'observation_1',
      schemaVersion: 1,
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      turnSequence: 1,
      sourceMessageIds: ['message_user_1'],
      sourceSnapshotHash: 'a'.repeat(64),
      scope: {
        alignment: 'direct',
        relationRefs: ['knowledge:kp_1'],
        rationale: 'Directly related.',
      },
      entries: [
        {
          entryId: 'entry_reasoning',
          kind: 'learner_reasoning_behavior',
          summary: 'The learner connected two ideas through a shared mechanism.',
          knowledgePointRefs: ['knowledge:kp_1'],
          sourceRefs: ['message:message_user_1'],
          explicitness: 'ai_observed',
          resolvesEntryRefs: [],
          qualityFlags: ['direct', 'complete'],
        },
      ],
      observerVersion: 'teaching-observer@1',
      observedAt: '2026-07-14T00:00:00.000Z',
      status: 'active',
    };
    let task: GenerationTask = {
      id: 'task_observer',
      taskKey: 'observer',
      status: 'queued',
      createdAt: '2026-07-14T00:00:00.000Z',
      updatedAt: '2026-07-14T00:00:00.000Z',
      resourceVersion: 0,
    };
    const runtime: GenerationRuntime = {
      async submit(input) {
        request = input;
        return { taskId: task.id };
      },
      async runNext() {
        task = { ...task, status: 'completed', draftMarkdown: JSON.stringify(output) };
        return task.id;
      },
      async get() {
        return task;
      },
      async cancel() {
        return task;
      },
      async recoverExpiredLeases() {
        return 0;
      },
      async getMetrics() {
        return { total: 1, byStatus: { completed: 1 }, byErrorCode: {} };
      },
    };
    const observer = createGenerationTeachingObserver({
      runtime,
      providerId: 'mock',
    });

    const result = await observer.observe({
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      turnSequence: 1,
      sourceSnapshotHash: 'a'.repeat(64),
      knowledgePointRefs: ['knowledge:kp_1'],
      courseRelationRefs: ['course-topic:probability'],
      observationLens: teachingObservationLens('case_study'),
      previousState: createTeachingState({
        lessonId: 'lesson_1',
        sessionId: 'session_1',
        knowledgePointRefs: ['knowledge:kp_1'],
      }),
      messages: [
        {
          messageId: 'message_user_1',
          role: 'user',
          completionStatus: 'complete',
          markdown: 'These ideas share the same mechanism.',
          sourceRef: 'message:message_user_1',
        },
      ],
    });

    expect(result.entries[0]?.kind).toBe('learner_reasoning_behavior');
    expect(request?.taskKind).toBe('interactive-teaching-observation');
    expect(request?.prompt).not.toContain('courseMode');
    expect(request?.prompt).not.toContain('playIntent');
    expect(request?.prompt).not.toContain('learning style');
    expect(request?.prompt).not.toContain('templateRef');
    expect(request?.prompt).toContain('observationLens');
    expect(request?.prompt).toContain('不要求每一轮都体现该观察重心');
  });

  it('projects no evidence when generated observation JSON violates the contract', async () => {
    const task: GenerationTask = {
      id: 'task_invalid_observer',
      taskKey: 'invalid-observer',
      status: 'completed',
      createdAt: '2026-07-14T00:00:00.000Z',
      updatedAt: '2026-07-14T00:00:01.000Z',
      resourceVersion: 1,
      draftMarkdown: JSON.stringify({
        scope: { alignment: 'aligned', relationRefs: [], rationale: 'Invalid enum.' },
        entries: [
          {
            entryId: 'entry_invalid',
            kind: 'learner_reasoning_behavior',
            summary: 'Untrusted generated observation.',
            knowledgePointRefs: [],
            sourceRefs: ['message:message_user_1'],
            explicitness: 'explicit',
            resolvesEntryRefs: [],
            qualityFlags: ['untrusted_flag'],
          },
        ],
      }),
    };
    const runtime: GenerationRuntime = {
      async submit() {
        return { taskId: task.id };
      },
      async runNext() {
        return task.id;
      },
      async get() {
        return task;
      },
      async cancel() {
        return task;
      },
      async recoverExpiredLeases() {
        return 0;
      },
      async getMetrics() {
        return { total: 1, byStatus: { completed: 1 }, byErrorCode: {} };
      },
    };
    const observer = createGenerationTeachingObserver({ runtime, providerId: 'mock' });

    const result = await observer.observe({
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      turnSequence: 1,
      sourceSnapshotHash: 'b'.repeat(64),
      knowledgePointRefs: ['knowledge:kp_1'],
      courseRelationRefs: ['course-topic:probability'],
      observationLens: teachingObservationLens('standard'),
      previousState: createTeachingState({
        lessonId: 'lesson_1',
        sessionId: 'session_1',
        knowledgePointRefs: ['knowledge:kp_1'],
      }),
      messages: [
        {
          messageId: 'message_user_1',
          role: 'user',
          completionStatus: 'complete',
          markdown: 'Please explain this again.',
          sourceRef: 'message:message_user_1',
        },
      ],
    });

    expect(result.scope).toMatchObject({ alignment: 'unclear', relationRefs: [] });
    expect(result.entries).toEqual([]);
  });
});
