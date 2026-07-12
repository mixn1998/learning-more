import { describe, expect, it } from 'vitest';

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

function fixture() {
  let now = new Date('2026-07-13T00:00:00.000Z');
  const repositories = createInMemoryLearningSessionRepositories();
  const messageLog = createInMemoryMessageLog();
  const module = createSessionModule({
    repositories,
    messageLog,
    unitOfWork,
    instanceId: 'instance_01',
    nextSessionId: () => 'session_01',
    nextIntervalId: (() => {
      let value = 0;
      return () => `interval_${++value}`;
    })(),
    nextLeaseToken: () => 'lease_01',
    now: () => now,
  });
  return {
    module,
    repositories,
    messageLog,
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
  };
}

describe('LearningSession module', () => {
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
      establishesEvidence: true,
    };
    await module.execute(user, context('user', 'page_a'));
    await module.execute(user, context('user', 'page_a'));

    expect(module).not.toHaveProperty('appendAssistantDelta');
    await module.execute(
      {
        type: 'CommitAssistantMessage',
        lessonId: 'lesson_01',
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

  it('explicitly transfers the lease and rejects the old writer', async () => {
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
          establishesEvidence: true,
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

  it('counts only the closed active interval and does not accrue while paused', async () => {
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
});

function nowIso() {
  return '2026-07-13T00:01:00.000Z';
}
