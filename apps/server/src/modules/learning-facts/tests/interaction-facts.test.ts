import { describe, expect, it } from 'vitest';

import type { LearningEventEnvelope } from '@learning-more/contracts';

import { eventToFacts } from '../implementation/event-to-fact.js';
import { createInteractionProjection } from '../implementation/projections/interaction.js';
import type { LearningFact, LearningFactType } from '../interface.js';

function event(type: LearningEventEnvelope['type'], id: string): LearningEventEnvelope {
  return {
    id,
    schema_version: 1,
    type,
    occurred_at: '2026-07-13T00:00:00.000Z',
    recorded_at: '2026-07-13T00:00:01.000Z',
    source: 'LearningSession',
    target_refs: { lessonId: 'lesson_01', interactionId: `interaction_${id}` },
    payload: {},
    idempotency_key: id,
    correlation_id: 'correlation_01',
  };
}

function completion(id: string, lessonId: string): LearningFact {
  return {
    factId: id,
    factType: 'LessonCompletedFact',
    subjectRefs: { lessonId },
    occurredAt: '2026-07-13T01:00:00.000Z',
    recordedAt: '2026-07-13T01:00:01.000Z',
    sourceEventId: `event_${id}`,
    dataKeys: ['completion.lesson_id'],
    payload: {},
    schemaVersion: 1,
  };
}

describe('interaction fact projection', () => {
  it('[EQ-HIS-07] counts only structured prompts, responses, skips, lesson rate, and response rate', () => {
    const facts = [
      ...eventToFacts(event('InteractionPrompted', 'prompt_01')),
      ...eventToFacts(event('InteractionResponded', 'response_01')),
      ...eventToFacts(event('InteractionPrompted', 'prompt_02')),
      ...eventToFacts(event('InteractionSkipped', 'skip_01')),
      completion('complete_01', 'lesson_01'),
      completion('complete_02', 'lesson_02'),
    ];
    const projection = createInteractionProjection();
    projection.apply(facts);
    const view = projection.view();

    expect(view).toMatchObject({
      promptCount: 2,
      responseCount: 1,
      skipCount: 1,
      interactionLessonCount: 1,
      completedLessonCount: 2,
      interactionLessonRate: 0.5,
      responseRate: 0.5,
    });
    expect(view).not.toHaveProperty('questionCount');
    expect(view).not.toHaveProperty('averageQuestionCount');
    expect(view).not.toHaveProperty('validReplyCount');
    const interactionTypes = new Set<LearningFactType>([
      'InteractionPromptedFact',
      'InteractionRespondedFact',
      'InteractionSkippedFact',
    ]);
    expect(facts.filter((fact) => interactionTypes.has(fact.factType))).toHaveLength(4);
  });
});
