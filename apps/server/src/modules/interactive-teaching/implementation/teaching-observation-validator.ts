import { TeachingObservationSchema, type TeachingObservation } from '@learning-more/contracts';

export type TeachingObservationValidationContext = Readonly<{
  lessonId: string;
  sessionId: string;
  sourceSnapshotHash: string;
  knowledgePointRefs: readonly string[];
  courseRelationRefs: readonly string[];
  existingEntryRefs: readonly string[];
  messages: readonly Readonly<{
    messageId: string;
    role: 'user' | 'assistant';
    completionStatus: 'complete' | 'interrupted' | 'failed';
  }>[];
}>;

function invalid(code: string): never {
  throw new Error(code);
}

function messageIdFromRef(sourceRef: string): string | undefined {
  return sourceRef.startsWith('message:') ? sourceRef.slice('message:'.length) : undefined;
}

export function validateTeachingObservation(
  input: unknown,
  context: TeachingObservationValidationContext,
): TeachingObservation {
  const observation = TeachingObservationSchema.parse(input);
  if (observation.lessonId !== context.lessonId) invalid('observation_lesson_mismatch');
  if (observation.sessionId !== context.sessionId) invalid('observation_session_mismatch');
  if (observation.sourceSnapshotHash !== context.sourceSnapshotHash) {
    invalid('observation_snapshot_stale');
  }

  const messageById = new Map(context.messages.map((message) => [message.messageId, message]));
  const messageOrderById = new Map(
    context.messages.map((message, index) => [message.messageId, index] as const),
  );
  const knowledgePointRefs = new Set(context.knowledgePointRefs);
  const resolvableEntryRefs = new Set([
    ...context.existingEntryRefs,
    ...observation.entries.map((entry) => entry.entryId),
  ]);
  const validRelationRefs = new Set([
    ...context.knowledgePointRefs,
    ...context.courseRelationRefs,
    ...context.messages.map((message) => `message:${message.messageId}`),
  ]);

  for (const messageId of observation.sourceMessageIds) {
    if (!messageById.has(messageId)) invalid('observation_source_message_unknown');
  }
  for (const relationRef of observation.scope.relationRefs) {
    if (!validRelationRefs.has(relationRef)) invalid('observation_relation_unknown');
  }
  const interactionIds = new Set<string>();
  const promptSourceRefs = new Set<string>();
  for (const interaction of observation.interactions ?? []) {
    if (interactionIds.has(interaction.interactionId)) invalid('interaction_id_duplicate');
    interactionIds.add(interaction.interactionId);
    if (promptSourceRefs.has(interaction.promptSourceRef)) {
      invalid('interaction_prompt_duplicate');
    }
    promptSourceRefs.add(interaction.promptSourceRef);
    for (const knowledgePointRef of interaction.knowledgePointRefs) {
      if (!knowledgePointRefs.has(knowledgePointRef)) invalid('knowledge_point_reference_unknown');
    }
    const promptMessageId = messageIdFromRef(interaction.promptSourceRef);
    const promptMessage =
      promptMessageId === undefined ? undefined : messageById.get(promptMessageId);
    if (promptMessage?.role !== 'assistant') invalid('interaction_prompt_requires_assistant');
    if (interaction.interactionId !== `interaction:${promptMessageId}`) {
      invalid('interaction_id_not_bound_to_prompt');
    }
    if (promptMessage.completionStatus !== 'complete') {
      invalid('interaction_prompt_requires_complete_assistant');
    }
    if (interaction.responseSourceRef !== undefined) {
      const responseMessageId = messageIdFromRef(interaction.responseSourceRef);
      const responseMessage =
        responseMessageId === undefined ? undefined : messageById.get(responseMessageId);
      if (responseMessage?.role !== 'user') invalid('interaction_response_requires_user');
      if (
        promptMessageId === undefined ||
        responseMessageId === undefined ||
        messageOrderById.get(responseMessageId)! <= messageOrderById.get(promptMessageId)!
      ) {
        invalid('interaction_response_must_follow_prompt');
      }
      if (responseMessage.completionStatus !== 'complete') {
        invalid('interaction_response_requires_complete_user');
      }
    }
  }
  for (const entry of observation.entries) {
    const sourceMessages = entry.sourceRefs
      .map((sourceRef) => messageIdFromRef(sourceRef))
      .map((messageId) => (messageId === undefined ? undefined : messageById.get(messageId)))
      .filter((message) => message !== undefined);
    for (const knowledgePointRef of entry.knowledgePointRefs) {
      if (!knowledgePointRefs.has(knowledgePointRef)) invalid('knowledge_point_reference_unknown');
    }
    for (const resolvedEntryRef of entry.resolvesEntryRefs) {
      if (!resolvableEntryRefs.has(resolvedEntryRef)) {
        invalid('resolved_entry_reference_unknown');
      }
    }
    for (const sourceRef of entry.sourceRefs) {
      const messageId = messageIdFromRef(sourceRef);
      if (messageId === undefined) invalid('observation_source_reference_invalid');
      const message = messageById.get(messageId);
      if (message === undefined) invalid('observation_source_message_unknown');
      if (message.role === 'assistant' && message.completionStatus !== 'complete') {
        invalid('assistant_evidence_incomplete');
      }
    }
    if (
      entry.progressionSignal === 'skip_knowledge_point' &&
      entry.knowledgePointRefs.length === 0
    ) {
      invalid('skip_knowledge_point_reference_required');
    }
    if (entry.kind === 'open_loop' && !sourceMessages.some((message) => message.role === 'user')) {
      invalid('open_loop_requires_user_source');
    }
    if (
      entry.progressionSignal !== undefined &&
      entry.progressionSignal !== 'lesson_summary_delivered' &&
      !sourceMessages.some((message) => message.role === 'user')
    ) {
      invalid('learner_progression_signal_requires_user_source');
    }
    if (
      entry.progressionSignal === 'lesson_summary_delivered' &&
      !sourceMessages.some(
        (message) => message.role === 'assistant' && message.completionStatus === 'complete',
      )
    ) {
      invalid('summary_delivery_requires_complete_assistant_source');
    }
    if (
      (observation.scope.alignment === 'unclear' || observation.scope.alignment === 'off_scope') &&
      (entry.kind === 'teaching_delivery' ||
        entry.kind === 'learner_demonstration' ||
        entry.kind === 'learner_misconception') &&
      entry.knowledgePointRefs.length > 0
    ) {
      invalid('unaligned_observation_cannot_update_lesson_state');
    }
  }
  return observation;
}
