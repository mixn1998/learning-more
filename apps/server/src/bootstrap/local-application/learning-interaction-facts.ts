import { createHash, randomUUID } from 'node:crypto';

import type { LearningEventEnvelope } from '@learning-more/contracts';

import type { TeachingInteractionSink } from '../../modules/interactive-teaching/ports/teaching-interaction-sink.js';
import type { Outbox } from '../../persistence/outbox.js';
import type { UnitOfWork } from '../../persistence/unit-of-work.js';

export function createLearningInteractionFactSink(input: {
  listMessages(sessionId: string): Promise<readonly Readonly<{ id: string; createdAt: string }>[]>;
  outbox: Pick<Outbox, 'enqueue'>;
  unitOfWork: UnitOfWork;
  now(): Date;
}): TeachingInteractionSink {
  return {
    async captureFromObservation({ courseId, lessonId, sessionId, observation }) {
      const messages = await input.listMessages(sessionId);
      const messageOccurredAt = new Map<string, string>(
        messages.map((message) => [`message:${message.id}`, message.createdAt] as const),
      );
      const events: LearningEventEnvelope[] = [];
      const append = (
        type: 'InteractionPrompted' | 'InteractionResponded' | 'InteractionSkipped',
        interactionId: string,
        sourceRef: string,
      ) => {
        const occurredAt = messageOccurredAt.get(sourceRef) ?? observation.observedAt;
        const eventId = `event_interaction_${createHash('sha256')
          .update(`${sessionId}\0${interactionId}\0${type}`, 'utf8')
          .digest('hex')
          .slice(0, 40)}`;
        events.push({
          id: eventId,
          schema_version: 1,
          type,
          occurred_at: occurredAt,
          recorded_at: input.now().toISOString(),
          source: 'TeachingObservation',
          target_refs: { courseId, lessonId, sessionId, interactionId },
          payload: {
            interactionId,
            conversationInteractionId: interactionId,
            ...(type === 'InteractionPrompted'
              ? { promptedAt: occurredAt }
              : type === 'InteractionResponded'
                ? { respondedAt: occurredAt }
                : { skippedAt: occurredAt }),
            observationId: observation.observationId,
            sourceSnapshotHash: observation.sourceSnapshotHash,
          },
          idempotency_key: eventId,
          correlation_id: eventId,
        });
      };
      for (const interaction of observation.interactions ?? []) {
        append('InteractionPrompted', interaction.interactionId, interaction.promptSourceRef);
        if (interaction.outcome === 'responded' && interaction.responseSourceRef !== undefined) {
          append('InteractionResponded', interaction.interactionId, interaction.responseSourceRef);
        } else if (
          interaction.outcome === 'skipped' &&
          interaction.responseSourceRef !== undefined
        ) {
          append('InteractionSkipped', interaction.interactionId, interaction.responseSourceRef);
        }
      }
      if (events.length === 0) return;
      await input.unitOfWork.execute(
        { transactionId: `tx_interaction_facts_${randomUUID()}` },
        (tx) => input.outbox.enqueue(tx, events),
      );
    },
  };
}
