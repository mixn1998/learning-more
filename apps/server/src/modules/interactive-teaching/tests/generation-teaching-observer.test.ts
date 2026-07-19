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
      sourceMessageIds: ['message_ai_1', 'message_user_1'],
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
      interactions: [
        {
          interactionId: 'interaction:message_ai_1',
          knowledgePointRefs: ['knowledge:kp_1'],
          promptSourceRef: 'message:message_ai_1',
          outcome: 'responded',
          responseSourceRef: 'message:message_user_1',
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
      async listByOwner() {
        return [];
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
          messageId: 'message_ai_1',
          role: 'assistant',
          completionStatus: 'complete',
          markdown: 'What follows from changing the sample space?',
          sourceRef: 'message:message_ai_1',
        },
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
    expect(request?.prompt).toContain(
      'scope.alignment=direct|supporting|adjacent|unclear|off_scope',
    );
    expect(request?.prompt).toContain('qualityFlags 只能使用 direct|complete|ambiguous');
    expect(request?.prompt).toContain('本轮教学观察增量');
    expect(request?.prompt).not.toContain('完整学习会话历史');
    expect(request?.prompt).toContain('普通澄清问句和课末自由答疑不属于关键互动');
    expect(request?.prompt).toContain(
      'interactionId 必须严格写成 interaction:<首次发起该互动的助手消息 ID>',
    );
    expect(request?.prompt).toContain('教学观察不判断知识点检测或综合检测是否通过');
    expect(request?.prompt).toContain('不要输出 progressionSignal');
    expect(request?.prompt).toContain('open_loop 必须引用用户消息');
    expect(request?.prompt).toContain('绝不能把助手提出的问题记为 open_loop');
    expect(request?.prompt).toContain('记录为 learner_intent');
    expect(result.observerVersion).toBe('teaching-observer@4');
    expect(result.interactions).toEqual(output.interactions);
  });

  it('keeps valid evidence when generated observation contains known aliases and invalid optional metadata', async () => {
    const task: GenerationTask = {
      id: 'task_invalid_observer',
      taskKey: 'invalid-observer',
      status: 'completed',
      createdAt: '2026-07-14T00:00:00.000Z',
      updatedAt: '2026-07-14T00:00:01.000Z',
      resourceVersion: 1,
      draftMarkdown: JSON.stringify({
        scope: {
          alignment: 'aligned',
          relationRefs: ['knowledge:kp_1'],
          rationale: 'The exchange directly concerns the current knowledge point.',
        },
        entries: [
          {
            entryId: 'entry_demonstration',
            kind: 'learner_demonstration',
            summary: 'The learner applied the current idea correctly.',
            knowledgePointRefs: ['knowledge:kp_1'],
            sourceRefs: ['message:message_user_1'],
            assessment: 'supports',
            explicitness: 'explicit',
            resolvesEntryRefs: [],
            qualityFlags: ['direct', 'untrusted_flag'],
          },
          {
            entryId: 'entry_unknown_kind',
            kind: 'teaching_clarification',
            summary: 'An unsupported generated kind.',
            knowledgePointRefs: ['knowledge:kp_1'],
            sourceRefs: ['message:message_user_1'],
            resolvesEntryRefs: [],
            qualityFlags: ['complete'],
          },
        ],
        interactions: [],
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
      async listByOwner() {
        return [];
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

    expect(result.scope).toMatchObject({
      alignment: 'direct',
      relationRefs: ['knowledge:kp_1'],
    });
    expect(result.entries).toEqual([
      expect.objectContaining({
        entryId: 'entry_demonstration',
        kind: 'learner_demonstration',
        assessment: 'supports',
        qualityFlags: ['direct'],
      }),
    ]);
    expect(result.entries[0]).not.toHaveProperty('explicitness');
  });

  it('fails the rebuild when generated observation is not JSON', async () => {
    const task: GenerationTask = {
      id: 'task_invalid_json_observer',
      taskKey: 'invalid-json-observer',
      status: 'completed',
      createdAt: '2026-07-14T00:00:00.000Z',
      updatedAt: '2026-07-14T00:00:01.000Z',
      resourceVersion: 1,
      draftMarkdown: 'not-json',
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
      async listByOwner() {
        return [];
      },
      async recoverExpiredLeases() {
        return 0;
      },
      async getMetrics() {
        return { total: 1, byStatus: { completed: 1 }, byErrorCode: {} };
      },
    };
    const observer = createGenerationTeachingObserver({ runtime, providerId: 'mock' });

    await expect(
      observer.observe({
        lessonId: 'lesson_1',
        sessionId: 'session_1',
        turnSequence: 1,
        sourceSnapshotHash: 'c'.repeat(64),
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
      }),
    ).rejects.toThrow();
  });

  it('fails the rebuild when the key-interaction projection is omitted', async () => {
    const task: GenerationTask = {
      id: 'task_missing_interactions',
      taskKey: 'missing-interactions',
      status: 'completed',
      createdAt: '2026-07-14T00:00:00.000Z',
      updatedAt: '2026-07-14T00:00:01.000Z',
      resourceVersion: 1,
      draftMarkdown: JSON.stringify({
        scope: { alignment: 'unclear', relationRefs: [], rationale: 'No reliable change.' },
        entries: [],
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
      async listByOwner() {
        return [];
      },
      async recoverExpiredLeases() {
        return 0;
      },
      async getMetrics() {
        return { total: 1, byStatus: { completed: 1 }, byErrorCode: {} };
      },
    };
    const observer = createGenerationTeachingObserver({ runtime, providerId: 'mock' });

    await expect(
      observer.observe({
        lessonId: 'lesson_1',
        sessionId: 'session_1',
        turnSequence: 1,
        sourceSnapshotHash: 'd'.repeat(64),
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
            markdown: 'Please continue.',
            sourceRef: 'message:message_user_1',
          },
        ],
      }),
    ).rejects.toThrow('teaching_observation_interactions_required');
  });
});
