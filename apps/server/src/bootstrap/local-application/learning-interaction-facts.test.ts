import { describe, expect, it, vi } from 'vitest';

import type { LearningEventEnvelope } from '@learning-more/contracts';

import type { TransactionContext, UnitOfWork } from '../../persistence/unit-of-work.js';
import { createLearningInteractionFactSink } from './learning-interaction-facts.js';

describe('learning interaction fact sink', () => {
  it('uses the source message time for prompted, responded, and skipped events', async () => {
    const events: LearningEventEnvelope[] = [];
    const tx: TransactionContext = {
      stageJson: vi.fn(),
      stageText: vi.fn(),
      deleteOnCommit: vi.fn(),
    };
    const unitOfWork: UnitOfWork = {
      async execute(_request, work) {
        return work(tx);
      },
    };
    const sink = createLearningInteractionFactSink({
      async listMessages() {
        return [
          { id: 'assistant_1', createdAt: '2026-07-17T08:00:00.000Z' },
          { id: 'user_1', createdAt: '2026-07-17T08:01:00.000Z' },
          { id: 'assistant_2', createdAt: '2026-07-17T08:02:00.000Z' },
          { id: 'user_2', createdAt: '2026-07-17T08:03:00.000Z' },
        ];
      },
      outbox: {
        async enqueue(_tx, captured) {
          events.push(...captured);
        },
      },
      unitOfWork,
      now: () => new Date('2026-07-17T09:00:00.000Z'),
    });

    await sink.captureFromObservation({
      courseId: 'course_1',
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      observation: {
        observationId: 'observation_1',
        schemaVersion: 1,
        turnSequence: 1,
        sessionId: 'session_1',
        lessonId: 'lesson_1',
        sourceMessageIds: ['assistant_1', 'user_1', 'assistant_2', 'user_2'],
        sourceSnapshotHash: 'a'.repeat(64),
        scope: { alignment: 'direct', relationRefs: [], rationale: '本课互动。' },
        entries: [],
        interactions: [
          {
            interactionId: 'interaction:assistant_1',
            knowledgePointRefs: [],
            promptSourceRef: 'message:assistant_1',
            outcome: 'responded',
            responseSourceRef: 'message:user_1',
          },
          {
            interactionId: 'interaction:assistant_2',
            knowledgePointRefs: [],
            promptSourceRef: 'message:assistant_2',
            outcome: 'skipped',
            responseSourceRef: 'message:user_2',
          },
        ],
        observerVersion: 'observer@1',
        observedAt: '2026-07-17T08:04:00.000Z',
        status: 'active',
      },
    });

    expect(events.map((event) => [event.type, event.occurred_at])).toEqual([
      ['InteractionPrompted', '2026-07-17T08:00:00.000Z'],
      ['InteractionResponded', '2026-07-17T08:01:00.000Z'],
      ['InteractionPrompted', '2026-07-17T08:02:00.000Z'],
      ['InteractionSkipped', '2026-07-17T08:03:00.000Z'],
    ]);
  });
});
