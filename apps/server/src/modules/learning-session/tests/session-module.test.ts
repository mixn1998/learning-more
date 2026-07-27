import { describe, expect, it, vi } from 'vitest';

import { createInMemoryLearningSessionRepositories } from '../../../persistence/learning-session-repositories.js';
import { createInMemoryMessageLog } from '../implementation/message-log.js';
import { createSessionModule } from '../implementation/session-module.js';
import { recoverOpenIntervals } from '../implementation/time-intervals.js';
import { RepositoryVersionConflictError } from '../../../persistence/repository-errors.js';

const tx = {
  stageJson: async () => undefined,
  stageText: async () => undefined,
  deleteOnCommit: async () => undefined,
};
const unitOfWork = {
  async execute<T>(_request: unknown, work: (context: typeof tx) => Promise<T>) {
    return work(tx);
  },
};

function context(commandId: string, pageInstanceId: string) {
  return {
    commandId,
    correlationId: `correlation_${commandId}`,
    idempotencyKey: `idempotency_${commandId}`,
    actor: 'local-user' as const,
    requestedAt: '2026-07-13T00:00:00.000Z',
    receivedAt: '2026-07-13T00:00:00.000Z',
    pageInstanceId,
  };
}

function fixture(
  options: {
    assertLessonWritable?: (lessonId: string) => Promise<void>;
    assertLessonStartable?: (lessonId: string) => Promise<void>;
  } = {},
) {
  let now = new Date('2026-07-13T00:00:00.000Z');
  const repositories = createInMemoryLearningSessionRepositories();
  const messageLog = createInMemoryMessageLog();
  let intervalValue = 0;
  const createModule = (instanceId = 'instance_01') =>
    createSessionModule({
      repositories,
      messageLog,
      unitOfWork,
      instanceId,
      nextSessionId: () => 'session_01',
      nextIntervalId: () => `interval_${++intervalValue}`,
      nextLeaseToken: () => `lease_${instanceId}`,
      now: () => now,
      ...(options.assertLessonWritable === undefined
        ? {}
        : { assertLessonWritable: options.assertLessonWritable }),
      ...(options.assertLessonStartable === undefined
        ? {}
        : { assertLessonStartable: options.assertLessonStartable }),
    });
  const module = createModule();
  return {
    module,
    createModule,
    repositories,
    messageLog,
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
  };
}

describe('LearningSession module', () => {
  it('persists assistant message knowledge-point ownership', async () => {
    const { module, messageLog } = fixture();
    await module.execute(
      { type: 'StartLesson', lessonId: 'lesson_owned_message' },
      context('start_owned_message', 'page_a'),
    );
    await module.execute(
      {
        type: 'StartSessionGeneration',
        lessonId: 'lesson_owned_message',
        taskId: 'task_owned_message',
        mode: 'new-turn',
      },
      { ...context('generate_owned_message', 'page_a'), expectedVersion: 1 },
    );
    await module.execute(
      {
        type: 'CommitAssistantMessage',
        lessonId: 'lesson_owned_message',
        sessionId: 'session_01',
        messageId: 'assistant_owned_message',
        contentArtifactRef: 'artifact:owned-message',
        generationTaskId: 'task_owned_message',
        knowledgePointRef: 'knowledge:lesson_owned_message:point_01',
      },
      { ...context('commit_owned_message', 'page_a'), expectedVersion: 2 },
    );

    expect(await messageLog.list('session_01')).toContainEqual(
      expect.objectContaining({
        id: 'assistant_owned_message',
        knowledgePointRef: 'knowledge:lesson_owned_message:point_01',
      }),
    );
  });

  it('atomically replaces only the pending user turn and its interrupted assistant tail', async () => {
    const { module, messageLog } = fixture();
    await module.execute(
      { type: 'StartLesson', lessonId: 'lesson_revision' },
      context('start_revision', 'page_a'),
    );
    await module.execute(
      {
        type: 'AppendUserMessage',
        lessonId: 'lesson_revision',
        messageId: 'message_original',
        contentArtifactRef: 'artifact:original',
      },
      { ...context('append_original', 'page_a'), expectedVersion: 1 },
    );
    await module.execute(
      {
        type: 'StartSessionGeneration',
        lessonId: 'lesson_revision',
        taskId: 'task_original',
        mode: 'new-turn',
      },
      { ...context('start_generation', 'page_a'), expectedVersion: 2 },
    );
    await module.execute(
      {
        type: 'CommitAssistantMessage',
        lessonId: 'lesson_revision',
        sessionId: 'session_01',
        messageId: 'message_interrupted',
        contentArtifactRef: 'artifact:interrupted',
        generationTaskId: 'task_original',
        completionStatus: 'interrupted',
      },
      { ...context('interrupt_generation', 'page_a'), expectedVersion: 3 },
    );

    const replaced = await module.execute(
      {
        type: 'ReplacePendingUserTurn',
        lessonId: 'lesson_revision',
        replacedMessageIds: ['message_original', 'message_interrupted'],
        messageId: 'message_revised',
        contentArtifactRef: 'artifact:revised',
      },
      { ...context('replace_turn', 'page_a'), expectedVersion: 4 },
    );

    expect(replaced.value.resourceVersion).toBe(5);
    expect((await messageLog.list('session_01')).map((message) => message.id)).toEqual([
      'message_revised',
    ]);
    expect(
      (
        await module.query(
          { type: 'GetLessonLearning', lessonId: 'lesson_revision' },
          {
            correlationId: 'query_revision',
            actor: 'local-user',
            requestedAt: nowIso(),
            receivedAt: nowIso(),
          },
        )
      ).learning.session?.messageIds,
    ).toEqual(['message_revised']);
  });

  it('rejects starting an obsolete lesson while preserving an existing historical session', async () => {
    const assertLessonStartable = vi
      .fn<(lessonId: string) => Promise<void>>()
      .mockRejectedValueOnce(
        Object.assign(new Error('lesson_not_current'), { code: 'lesson_not_current' }),
      )
      .mockResolvedValue(undefined);
    const assertLessonWritable = vi.fn<(lessonId: string) => Promise<void>>().mockResolvedValue();
    const { module } = fixture({ assertLessonStartable, assertLessonWritable });

    await expect(
      module.execute(
        { type: 'StartLesson', lessonId: 'lesson_obsolete' },
        context('start_obsolete', 'page_a'),
      ),
    ).rejects.toMatchObject({ code: 'lesson_not_current' });

    await module.execute(
      { type: 'StartLesson', lessonId: 'lesson_historical' },
      context('start_historical', 'page_a'),
    );
    await module.execute(
      { type: 'StartLesson', lessonId: 'lesson_historical' },
      context('resume_historical', 'page_b'),
    );

    expect(assertLessonStartable).toHaveBeenCalledTimes(2);
    expect(assertLessonWritable).toHaveBeenCalledWith('lesson_historical');
  });

  it('establishes evidence only from a validated teaching observation effect', async () => {
    const { module } = fixture();
    await module.execute(
      { type: 'StartLesson', lessonId: 'lesson_01' },
      context('start_semantic_evidence', 'page_a'),
    );
    await module.execute(
      {
        type: 'AppendUserMessage',
        lessonId: 'lesson_01',
        messageId: 'message_user_semantic',
        contentArtifactRef: 'artifact:user:semantic',
      },
      { ...context('append_semantic', 'page_a'), expectedVersion: 1 },
    );

    expect(
      (
        await module.query(
          { type: 'GetLessonLearning', lessonId: 'lesson_01' },
          {
            correlationId: 'before',
            actor: 'local-user',
            requestedAt: nowIso(),
            receivedAt: nowIso(),
          },
        )
      ).learning.session?.evidenceCheckpoint,
    ).toBe(false);

    await module.execute(
      { type: 'EstablishEvidenceCheckpoint', lessonId: 'lesson_01' },
      { ...context('observe_semantic', 'page_a'), expectedVersion: 2 },
    );

    expect(
      (
        await module.query(
          { type: 'GetLessonLearning', lessonId: 'lesson_01' },
          {
            correlationId: 'after',
            actor: 'local-user',
            requestedAt: nowIso(),
            receivedAt: nowIso(),
          },
        )
      ).learning.session?.evidenceCheckpoint,
    ).toBe(true);
  });

  it('rejects a late session write after its course archive has entered permanent deletion', async () => {
    let deleted = false;
    const { module, messageLog } = fixture({
      assertLessonWritable: async () => {
        if (deleted) {
          throw Object.assign(new Error('resource_not_found'), { code: 'resource_not_found' });
        }
      },
    });
    await module.execute(
      { type: 'StartLesson', lessonId: 'lesson_01' },
      context('start_before_delete', 'page_a'),
    );
    deleted = true;

    await expect(
      module.execute(
        {
          type: 'AppendUserMessage',
          lessonId: 'lesson_01',
          messageId: 'message_late',
          contentArtifactRef: 'artifact_late',
        },
        { ...context('late_message', 'page_a'), expectedVersion: 1 },
      ),
    ).rejects.toMatchObject({ code: 'resource_not_found' });
    await expect(messageLog.list('session_01')).resolves.toEqual([]);
  });

  it('truncates an open interval at the persisted heartbeat during restart recovery', () => {
    expect(
      recoverOpenIntervals(
        [
          {
            id: 'interval_01',
            sessionId: 'session_01',
            startedAt: '2026-07-13T00:00:00.000Z',
            recovered: false,
          },
        ],
        new Date('2026-07-13T00:00:09.000Z'),
      ),
    ).toEqual([
      {
        id: 'interval_01',
        sessionId: 'session_01',
        startedAt: '2026-07-13T00:00:00.000Z',
        endedAt: '2026-07-13T00:00:09.000Z',
        endReason: 'recovered',
        recovered: true,
      },
    ]);
  });
  it('appends a repeated user command once and commits only complete assistant artifacts', async () => {
    const { module, messageLog } = fixture();
    await module.execute(
      { type: 'StartLesson', lessonId: 'lesson_01' },
      context('start', 'page_a'),
    );
    const user = {
      type: 'AppendUserMessage' as const,
      lessonId: 'lesson_01',
      messageId: 'message_user',
      contentArtifactRef: 'artifact:user',
    };
    await module.execute(user, context('user', 'page_a'));
    await module.execute(user, context('user', 'page_a'));
    await module.execute(
      {
        type: 'StartSessionGeneration',
        lessonId: 'lesson_01',
        taskId: 'task_01',
        mode: 'new-turn',
      },
      context('start_generation', 'page_a'),
    );

    expect(module).not.toHaveProperty('appendAssistantDelta');
    await module.execute(
      {
        type: 'CommitAssistantMessage',
        lessonId: 'lesson_01',
        sessionId: 'session_01',
        messageId: 'message_assistant',
        contentArtifactRef: 'artifact:assistant',
        generationTaskId: 'task_01',
      },
      context('assistant', 'page_a'),
    );
    const messages = await messageLog.list('session_01');
    expect(messages.map((message) => [message.id, message.role])).toEqual([
      ['message_user', 'user'],
      ['message_assistant', 'assistant'],
    ]);
  });

  it('commits the matching in-flight assistant reply after background pause without resuming time', async () => {
    const { module, messageLog, advance } = fixture();
    await module.execute(
      { type: 'StartLesson', lessonId: 'lesson_01' },
      context('start_paused_completion', 'page_a'),
    );
    advance(10_000);
    await module.execute(
      {
        type: 'StartSessionGeneration',
        lessonId: 'lesson_01',
        taskId: 'task_01',
        mode: 'new-turn',
      },
      { ...context('generate_before_pause', 'page_a'), expectedVersion: 1 },
    );
    await module.execute(
      { type: 'PauseLesson', lessonId: 'lesson_01' },
      { ...context('pause_during_generation', 'page_a'), expectedVersion: 2 },
    );
    advance(20_000);

    await module.execute(
      {
        type: 'CommitAssistantMessage',
        lessonId: 'lesson_01',
        sessionId: 'session_01',
        messageId: 'message_assistant',
        contentArtifactRef: 'artifact:assistant',
        generationTaskId: 'task_01',
      },
      context('complete_while_paused', 'page_a'),
    );

    await expect(messageLog.list('session_01')).resolves.toEqual([
      expect.objectContaining({ id: 'message_assistant', role: 'assistant' }),
    ]);
    const view = await module.query(
      { type: 'GetLessonLearning', lessonId: 'lesson_01' },
      {
        correlationId: 'query_paused_completion',
        actor: 'local-user',
        requestedAt: nowIso(),
        receivedAt: nowIso(),
      },
    );
    expect(view.actualSeconds).toBe(10);
    expect(view.learning.session).toMatchObject({
      id: 'session_01',
      state: 'paused',
      messageIds: ['message_assistant'],
    });
    expect(view.learning.session?.activeGenerationTaskId).toBeUndefined();
  });

  it('keeps user input blocked while allowing internal generation binding during pause', async () => {
    const { module, repositories, advance } = fixture();
    await module.execute(
      { type: 'StartLesson', lessonId: 'lesson_01' },
      context('start_paused_retry', 'page_a'),
    );
    advance(8_000);
    const paused = await module.execute(
      { type: 'PauseLesson', lessonId: 'lesson_01' },
      { ...context('pause_before_retry', 'page_a'), expectedVersion: 1 },
    );

    await expect(
      module.execute(
        {
          type: 'AppendUserMessage',
          lessonId: 'lesson_01',
          messageId: 'message_blocked',
          contentArtifactRef: 'artifact:message_blocked',
        },
        {
          ...context('new_turn_while_paused', 'page_a'),
          expectedVersion: paused.value.resourceVersion,
        },
      ),
    ).rejects.toMatchObject({ code: 'session_not_writable' });

    const internallyStarted = await module.execute(
      {
        type: 'StartSessionGeneration',
        lessonId: 'lesson_01',
        taskId: 'task_existing_turn',
        mode: 'new-turn',
      },
      {
        ...context('bind_existing_turn_while_paused', 'page_a'),
        expectedVersion: paused.value.resourceVersion,
      },
    );
    const stopped = await module.execute(
      {
        type: 'StopSessionGeneration',
        lessonId: 'lesson_01',
        taskId: 'task_existing_turn',
      },
      {
        ...context('stop_existing_turn_while_paused', 'page_a'),
        expectedVersion: internallyStarted.value.resourceVersion,
      },
    );
    const retried = await module.execute(
      {
        type: 'StartSessionGeneration',
        lessonId: 'lesson_01',
        taskId: 'task_retry',
        mode: 'retry',
      },
      {
        ...context('retry_while_paused', 'page_a'),
        expectedVersion: stopped.value.resourceVersion,
      },
    );
    advance(20_000);

    const view = await module.query(
      { type: 'GetLessonLearning', lessonId: 'lesson_01' },
      {
        correlationId: 'query_paused_retry',
        actor: 'local-user',
        requestedAt: nowIso(),
        receivedAt: nowIso(),
      },
    );
    expect(retried.value.resourceVersion).toBe(paused.value.resourceVersion + 3);
    expect(view.actualSeconds).toBe(8);
    expect(view.learning.session).toMatchObject({
      state: 'paused',
      activeGenerationTaskId: 'task_retry',
    });
    await expect(repositories.get('lesson_01')).resolves.toMatchObject({
      intervals: [{ endReason: 'paused' }],
    });
  });

  it('excludes AI generation wait time and resumes timing after an active reply completes', async () => {
    const { module, repositories, advance } = fixture();
    await module.execute(
      { type: 'StartLesson', lessonId: 'lesson_01' },
      context('start_generation_hold', 'page_a'),
    );
    advance(10_000);
    await module.execute(
      {
        type: 'StartSessionGeneration',
        lessonId: 'lesson_01',
        taskId: 'task_01',
        mode: 'new-turn',
      },
      { ...context('start_generation_hold_task', 'page_a'), expectedVersion: 1 },
    );
    advance(20_000);
    await module.execute(
      {
        type: 'CommitAssistantMessage',
        lessonId: 'lesson_01',
        sessionId: 'session_01',
        messageId: 'message_assistant',
        contentArtifactRef: 'artifact:assistant',
        generationTaskId: 'task_01',
      },
      { ...context('complete_generation_hold_task', 'page_a'), expectedVersion: 2 },
    );
    advance(5_000);
    await module.execute(
      { type: 'PauseLesson', lessonId: 'lesson_01' },
      { ...context('pause_after_generation_hold', 'page_a'), expectedVersion: 3 },
    );

    const view = await module.query(
      { type: 'GetLessonLearning', lessonId: 'lesson_01' },
      {
        correlationId: 'query_generation_hold',
        actor: 'local-user',
        requestedAt: nowIso(),
        receivedAt: nowIso(),
      },
    );
    expect(view.actualSeconds).toBe(15);
    await expect(repositories.get('lesson_01')).resolves.toMatchObject({
      intervals: [{ endReason: 'ai_generation' }, { endReason: 'paused' }],
    });
  });

  it('resumes active timing after generation is stopped', async () => {
    const { module, advance } = fixture();
    await module.execute(
      { type: 'StartLesson', lessonId: 'lesson_01' },
      context('start_stopped_generation_hold', 'page_a'),
    );
    advance(7_000);
    await module.execute(
      {
        type: 'StartSessionGeneration',
        lessonId: 'lesson_01',
        taskId: 'task_01',
        mode: 'new-turn',
      },
      { ...context('start_stopped_generation_task', 'page_a'), expectedVersion: 1 },
    );
    advance(30_000);
    await module.execute(
      { type: 'StopSessionGeneration', lessonId: 'lesson_01', taskId: 'task_01' },
      { ...context('stop_generation_task', 'page_a'), expectedVersion: 2 },
    );
    advance(3_000);
    await module.execute(
      { type: 'PauseLesson', lessonId: 'lesson_01' },
      { ...context('pause_after_stopped_generation', 'page_a'), expectedVersion: 3 },
    );

    const view = await module.query(
      { type: 'GetLessonLearning', lessonId: 'lesson_01' },
      {
        correlationId: 'query_stopped_generation_hold',
        actor: 'local-user',
        requestedAt: nowIso(),
        receivedAt: nowIso(),
      },
    );
    expect(view.actualSeconds).toBe(10);
  });

  it('does not resume timing while an AI task remains active', async () => {
    const { module, advance } = fixture();
    await module.execute(
      { type: 'StartLesson', lessonId: 'lesson_01' },
      context('start_resumed_generation_hold', 'page_a'),
    );
    advance(10_000);
    await module.execute(
      {
        type: 'StartSessionGeneration',
        lessonId: 'lesson_01',
        taskId: 'task_01',
        mode: 'new-turn',
      },
      { ...context('start_resumed_generation_task', 'page_a'), expectedVersion: 1 },
    );
    await module.execute(
      { type: 'PauseLesson', lessonId: 'lesson_01' },
      { ...context('pause_resumed_generation_task', 'page_a'), expectedVersion: 2 },
    );
    await module.execute(
      { type: 'ResumeLesson', lessonId: 'lesson_01' },
      { ...context('resume_generation_task', 'page_a'), expectedVersion: 3 },
    );
    advance(20_000);
    await module.execute(
      {
        type: 'CommitAssistantMessage',
        lessonId: 'lesson_01',
        sessionId: 'session_01',
        messageId: 'message_assistant',
        contentArtifactRef: 'artifact:assistant',
        generationTaskId: 'task_01',
      },
      { ...context('complete_resumed_generation_task', 'page_a'), expectedVersion: 4 },
    );
    advance(5_000);
    await module.execute(
      { type: 'PauseLesson', lessonId: 'lesson_01' },
      { ...context('pause_completed_generation_task', 'page_a'), expectedVersion: 5 },
    );

    const view = await module.query(
      { type: 'GetLessonLearning', lessonId: 'lesson_01' },
      {
        correlationId: 'query_resumed_generation_hold',
        actor: 'local-user',
        requestedAt: nowIso(),
        receivedAt: nowIso(),
      },
    );
    expect(view.actualSeconds).toBe(15);
  });

  it('accepts a matching background completion after lease transfer and rejects other identities', async () => {
    const { module, messageLog } = fixture();
    await module.execute(
      { type: 'StartLesson', lessonId: 'lesson_01' },
      context('start_guarded_completion', 'page_a'),
    );
    await module.execute(
      {
        type: 'StartSessionGeneration',
        lessonId: 'lesson_01',
        taskId: 'task_01',
        mode: 'new-turn',
      },
      { ...context('generate_guarded_completion', 'page_a'), expectedVersion: 1 },
    );
    await module.execute(
      { type: 'PauseLesson', lessonId: 'lesson_01' },
      { ...context('pause_guarded_completion', 'page_a'), expectedVersion: 2 },
    );
    const completion = (sessionId: string, generationTaskId: string) => ({
      type: 'CommitAssistantMessage' as const,
      lessonId: 'lesson_01',
      sessionId,
      messageId: 'message_assistant',
      contentArtifactRef: 'artifact:assistant',
      generationTaskId,
    });

    await expect(
      module.execute(completion('session_other', 'task_01'), context('wrong_session', 'page_a')),
    ).rejects.toMatchObject({ code: 'session_conflict' });
    await expect(
      module.execute(completion('session_01', 'task_other'), context('wrong_task', 'page_a')),
    ).rejects.toMatchObject({ code: 'session_conflict' });

    await module.execute(
      { type: 'TransferSessionLease', lessonId: 'lesson_01' },
      { ...context('transfer_during_generation', 'page_b'), expectedVersion: 3 },
    );
    await expect(
      module.execute(completion('session_01', 'task_01'), context('old_lease', 'page_a')),
    ).resolves.toMatchObject({ value: { resourceVersion: 5 } });
    await expect(messageLog.list('session_01')).resolves.toEqual([
      expect.objectContaining({
        id: 'message_assistant',
        role: 'assistant',
        generationTaskId: 'task_01',
      }),
    ]);
  });

  it('gives a second tab a read-only view without creating another original session', async () => {
    const { module, repositories } = fixture();
    const first = await module.execute(
      { type: 'StartLesson', lessonId: 'lesson_01' },
      context('start_a', 'page_a'),
    );
    const second = await module.execute(
      { type: 'StartLesson', lessonId: 'lesson_01' },
      context('start_b', 'page_b'),
    );

    expect(first.value).toMatchObject({ sessionId: 'session_01', writable: true });
    expect(second.value).toMatchObject({ sessionId: 'session_01', writable: false });
    await expect(repositories.get('lesson_01')).resolves.toMatchObject({
      learning: { session: { id: 'session_01' } },
    });
  });

  it('automatically reclaims a write lease left by a replaced server instance', async () => {
    const { module, createModule, repositories } = fixture();
    await module.execute(
      { type: 'StartLesson', lessonId: 'lesson_01' },
      context('start_old_instance', 'page_a'),
    );

    const replacement = createModule('instance_02');
    const resumed = await replacement.execute(
      { type: 'StartLesson', lessonId: 'lesson_01' },
      context('start_replacement_instance', 'page_b'),
    );

    expect(resumed.value).toMatchObject({
      sessionId: 'session_01',
      writable: true,
      resourceVersion: 2,
      leaseToken: 'lease_instance_02',
    });
    await expect(repositories.get('lesson_01')).resolves.toMatchObject({
      resourceVersion: 2,
      writeLease: {
        instanceId: 'instance_02',
        pageInstanceId: 'page_b',
        generation: 2,
      },
    });
  });

  it('refreshes the lease instance even when the browser page id survives the server restart', async () => {
    const { module, createModule, repositories } = fixture();
    await module.execute(
      { type: 'StartLesson', lessonId: 'lesson_01' },
      context('start_old_instance_same_page', 'page_a'),
    );

    const replacement = createModule('instance_02');
    const resumed = await replacement.execute(
      { type: 'StartLesson', lessonId: 'lesson_01' },
      context('start_replacement_same_page', 'page_a'),
    );

    expect(resumed.value).toMatchObject({ writable: true, resourceVersion: 2 });
    await expect(repositories.get('lesson_01')).resolves.toMatchObject({
      writeLease: { instanceId: 'instance_02', pageInstanceId: 'page_a', generation: 2 },
    });
  });

  it('[EQ-LESSON-06] explicitly transfers the lease and rejects the old writer', async () => {
    const { module } = fixture();
    await module.execute(
      { type: 'StartLesson', lessonId: 'lesson_01' },
      context('start', 'page_a'),
    );
    const transferred = await module.execute(
      { type: 'TransferSessionLease', lessonId: 'lesson_01' },
      { ...context('transfer', 'page_b'), expectedVersion: 1 },
    );
    expect(transferred.value).toMatchObject({ writable: true, resourceVersion: 2 });
    await expect(
      module.execute(
        {
          type: 'AppendUserMessage',
          lessonId: 'lesson_01',
          messageId: 'old_writer',
          contentArtifactRef: 'artifact:old',
        },
        { ...context('old', 'page_a'), expectedVersion: 2 },
      ),
    ).rejects.toMatchObject({ code: 'write_lease_lost' });
  });

  it('rejects stale expected versions before mutation', async () => {
    const { module } = fixture();
    await module.execute(
      { type: 'StartLesson', lessonId: 'lesson_01' },
      context('start', 'page_a'),
    );
    await expect(
      module.execute(
        { type: 'PauseLesson', lessonId: 'lesson_01' },
        { ...context('pause', 'page_a'), expectedVersion: 0 },
      ),
    ).rejects.toBeInstanceOf(RepositoryVersionConflictError);
  });

  it('[EQ-LESSON-10] counts only the closed active interval and does not accrue while paused', async () => {
    const { module, advance } = fixture();
    await module.execute(
      { type: 'StartLesson', lessonId: 'lesson_01' },
      context('start', 'page_a'),
    );
    advance(12_000);
    await module.execute(
      { type: 'PauseLesson', lessonId: 'lesson_01' },
      context('pause', 'page_a'),
    );
    advance(30_000);

    const paused = await module.query(
      { type: 'GetLessonLearning', lessonId: 'lesson_01' },
      { correlationId: 'query', actor: 'local-user', requestedAt: nowIso(), receivedAt: nowIso() },
    );
    expect(paused.actualSeconds).toBe(12);
    expect(paused.learning.session?.state).toBe('paused');
  });

  it('[EQ-LESSON-10] accumulates evidenced time across abandon/restore and freezes the final total once', async () => {
    const { module, advance } = fixture();
    await module.execute(
      { type: 'StartLesson', lessonId: 'lesson_01' },
      context('start', 'page_a'),
    );
    advance(10_000);
    await module.execute(
      {
        type: 'AppendUserMessage',
        lessonId: 'lesson_01',
        messageId: 'evidence',
        contentArtifactRef: 'artifact:evidence',
      },
      { ...context('evidence', 'page_a'), expectedVersion: 1 },
    );
    await module.execute(
      { type: 'EstablishEvidenceCheckpoint', lessonId: 'lesson_01' },
      { ...context('observed_evidence', 'page_a'), expectedVersion: 2 },
    );
    await module.execute(
      { type: 'AbandonLesson', lessonId: 'lesson_01' },
      { ...context('abandon', 'page_a'), expectedVersion: 3 },
    );
    advance(30_000);
    await module.execute(
      { type: 'RestoreLesson', lessonId: 'lesson_01' },
      { ...context('restore', 'page_a'), expectedVersion: 4 },
    );
    advance(5_000);
    await module.execute(
      { type: 'PauseLesson', lessonId: 'lesson_01' },
      { ...context('pause_final', 'page_a'), expectedVersion: 5 },
    );
    expect(
      (
        await module.query(
          { type: 'GetLessonLearning', lessonId: 'lesson_01' },
          {
            correlationId: 'query_before_final',
            actor: 'local-user',
            requestedAt: nowIso(),
            receivedAt: nowIso(),
          },
        )
      ).actualSeconds,
    ).toBe(15);
    await module.execute(
      {
        type: 'CommitFinalReview',
        lessonId: 'lesson_01',
        reviewId: 'review_final',
        artifactRef: 'artifact:review',
        contentSha256: 'a'.repeat(64),
        sourceSessionIds: ['session_01'],
        messageRangeChecksum: 'b'.repeat(64),
      },
      { ...context('complete', 'page_a'), expectedVersion: 6 },
    );
    const completed = await module.query(
      { type: 'GetLessonLearning', lessonId: 'lesson_01' },
      {
        correlationId: 'query_completed',
        actor: 'local-user',
        requestedAt: nowIso(),
        receivedAt: nowIso(),
      },
    );
    expect(completed.actualSeconds).toBe(15);
    expect(completed.learning.progress).toBe('completed');
  });
});

function nowIso() {
  return '2026-07-13T00:01:00.000Z';
}
