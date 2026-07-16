import type {
  CommandContext,
  PersonalizationView,
  TeachingObservation,
} from '@learning-more/contracts';
import { GenerationStreamEventSchema, type GenerationStreamEvent } from '@learning-more/contracts';
import { describe, expect, it } from 'vitest';

import { createInMemoryLearningSessionRepositories } from '../../../persistence/learning-session-repositories.js';
import { createInMemoryTeachingLedgerRepository } from '../../../persistence/teaching-ledger-repositories.js';
import { createInMemoryMessageLog } from '../../learning-session/implementation/message-log.js';
import { createSessionModule } from '../../learning-session/implementation/session-module.js';
import type { LearningSessionModule } from '../../learning-session/interface.js';
import { createTeachingContextAssembler } from '../implementation/context-assembler.js';
import { createInteractiveTeaching } from '../implementation/interactive-teaching.js';
import type { TeachingAgent } from '../ports/teaching-agent.js';
import type { TeachingContextSources } from '../ports/teaching-context-sources.js';
import type { TeachingObserver } from '../ports/teaching-observer.js';

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

const commandContext: CommandContext = {
  commandId: 'command_turn',
  correlationId: 'correlation_1',
  idempotencyKey: 'idempotency_1',
  actor: 'local-user',
  requestedAt: '2026-07-14T00:00:00.000Z',
  receivedAt: '2026-07-14T00:00:00.000Z',
  pageInstanceId: 'page_1',
  expectedVersion: 1,
};

async function fixture(
  options: {
    adjacent?: boolean;
    observerFailsOnce?: boolean;
    evidenceEffectFailsOnce?: boolean;
    reasoningSinkFailsOnce?: boolean;
    artifactSaveFails?: boolean;
    deferredCompletion?: boolean;
  } = {},
) {
  const artifacts = new Map<string, string>([
    [
      'artifact:user:1',
      options.adjacent
        ? 'How would intervention change this in the later causal-inference topic?'
        : 'Please explain why the denominator changes.',
    ],
  ]);
  const messageLog = createInMemoryMessageLog();
  const storedSessionModule = createSessionModule({
    repositories: createInMemoryLearningSessionRepositories(),
    messageLog,
    unitOfWork,
    instanceId: 'instance_1',
    nextSessionId: () => 'session_1',
    nextIntervalId: () => 'interval_1',
    nextLeaseToken: () => 'lease_1',
    now: () => new Date('2026-07-14T00:00:00.000Z'),
  });
  await storedSessionModule.execute(
    { type: 'StartLesson', lessonId: 'lesson_1' },
    { ...commandContext, commandId: 'start', expectedVersion: undefined },
  );
  let evidenceEffectShouldFail = options.evidenceEffectFailsOnce ?? false;
  const sessionModule: LearningSessionModule = {
    query: (query, context) => storedSessionModule.query(query, context),
    async execute(command, context) {
      if (command.type === 'EstablishEvidenceCheckpoint' && evidenceEffectShouldFail) {
        evidenceEffectShouldFail = false;
        throw new Error('simulated_projection_failure');
      }
      return storedSessionModule.execute(command, context);
    },
  };
  const emptyPersonalization: PersonalizationView = {
    profileVersion: 0,
    purpose: 'interactive_teaching',
    courseId: 'course_1',
    lessonId: 'lesson_1',
    signals: [],
    completeness: 'insufficient',
    sourceSnapshotHash: '0'.repeat(64),
    createdAt: '2026-07-14T00:00:00.000Z',
  };
  const sources: TeachingContextSources = {
    async getCourseAndLesson() {
      return {
        course: {
          courseId: 'course_1',
          outlineVersionId: 'outline_1',
          title: 'Probability',
          courseMode: 'case_study',
          playIntent: 'Use concrete situations when they create a useful teaching opportunity.',
          goals: ['Understand conditional probability.'],
          lessonMap: [
            {
              lessonId: 'lesson_1',
              title: 'Conditioning',
              objective: 'Understand conditioning.',
              relation: 'current',
            },
            {
              lessonId: 'lesson_2',
              title: 'Causal inference',
              objective: 'Understand interventions.',
              relation: 'other',
            },
          ],
        },
        lesson: {
          lessonId: 'lesson_1',
          outlineVersionId: 'outline_1',
          title: 'Conditioning',
          objective: 'Understand conditioning.',
          coreKnowledgePoints: [
            { ref: 'knowledge:kp_1', text: 'Conditioning changes the sample space.' },
          ],
        },
      };
    },
    async listMessages(sessionId) {
      const messages = await messageLog.list(sessionId);
      return messages.map((message) => ({
        messageId: message.id,
        role: message.role,
        completionStatus: message.completionStatus,
        markdown: artifacts.get(message.contentArtifactRef) ?? '',
        sourceRef: `message:${message.id}`,
      }));
    },
    async listRelevantFinalReviews() {
      return [];
    },
    async listRelevantMaterialExcerpts() {
      return [];
    },
    async getLearningStartSummary() {
      return undefined;
    },
    async getPersonalizationView() {
      return emptyPersonalization;
    },
  };
  let submittedContext: unknown;
  let resolveAgentCompletion: ((value: Readonly<{ markdown: string }>) => void) | undefined;
  const deferredCompletion = options.deferredCompletion
    ? new Promise<Readonly<{ markdown: string }>>((resolve) => {
        resolveAgentCompletion = resolve;
      })
    : undefined;
  const agent: TeachingAgent = {
    async submit(context) {
      submittedContext = context;
      return { taskId: 'task_1' };
    },
    async complete() {
      if (deferredCompletion !== undefined) return deferredCompletion;
      return {
        markdown: options.adjacent
          ? 'That is a useful adjacent direction. Let us explore it briefly, then return to the denominator change.'
          : 'Conditioning narrows the reference population, so the denominator changes with the sample space.',
      };
    },
    async recover() {
      return {
        markdown: 'Recovered teaching explanation.',
        completionStatus: 'complete',
      };
    },
    async stop() {
      return { markdown: 'Partial', completionStatus: 'interrupted' };
    },
  };
  let observerShouldFail = options.observerFailsOnce ?? false;
  let reasoningSinkShouldFail = options.reasoningSinkFailsOnce ?? false;
  const capturedReasoningObservations: string[] = [];
  const frames: GenerationStreamEvent[] = [];
  const observer: TeachingObserver = {
    async observe(input): Promise<TeachingObservation> {
      if (observerShouldFail) {
        observerShouldFail = false;
        throw new Error('simulated_observer_failure');
      }
      const sourceMessageIds = input.messages.map((message) => message.messageId);
      const assistant = input.messages.find((message) => message.role === 'assistant')!;
      const user = input.messages.find((message) => message.role === 'user')!;
      return {
        observationId: options.adjacent ? 'observation_adjacent' : 'observation_direct',
        schemaVersion: 1,
        lessonId: input.lessonId,
        sessionId: input.sessionId,
        turnSequence: input.turnSequence,
        sourceMessageIds,
        sourceSnapshotHash: input.sourceSnapshotHash,
        scope: options.adjacent
          ? {
              alignment: 'adjacent',
              relationRefs: ['course-topic:causal-inference', 'knowledge:kp_1'],
              rationale: 'Related to the course but outside this lesson.',
            }
          : {
              alignment: 'direct',
              relationRefs: ['knowledge:kp_1'],
              rationale: 'Directly concerns the current lesson.',
            },
        entries: options.adjacent
          ? [
              {
                entryId: 'entry_adjacent',
                kind: 'adjacent_exploration',
                summary: 'The learner opened an intervention-related branch.',
                knowledgePointRefs: ['knowledge:kp_1'],
                sourceRefs: [`message:${user.messageId}`],
                explicitness: 'user_declared',
                resolvesEntryRefs: [],
                qualityFlags: ['direct', 'complete'],
              },
            ]
          : [
              {
                entryId: 'entry_delivery',
                kind: 'teaching_delivery',
                summary: 'The assistant explained the sample-space change.',
                knowledgePointRefs: ['knowledge:kp_1'],
                sourceRefs: [`message:${assistant.messageId}`],
                resolvesEntryRefs: [],
                qualityFlags: ['direct', 'complete'],
              },
              {
                entryId: 'entry_reasoning',
                kind: 'learner_reasoning_behavior',
                summary:
                  'The learner focused on the logical consequence of changing the denominator.',
                knowledgePointRefs: ['knowledge:kp_1'],
                sourceRefs: [`message:${user.messageId}`],
                explicitness: 'ai_observed',
                resolvesEntryRefs: [],
                qualityFlags: ['direct', 'complete'],
              },
            ],
        observerVersion: 'teaching-observer@1',
        observedAt: '2026-07-14T00:01:00.000Z',
        status: 'active',
      };
    },
  };
  const created = createInteractiveTeaching({
    sessionModule,
    contextSources: sources,
    contextAssembler: createTeachingContextAssembler({ sources }),
    agent,
    observer,
    reasoningBehaviorSink: {
      async captureFromObservation(input) {
        if (reasoningSinkShouldFail) {
          reasoningSinkShouldFail = false;
          throw new Error('simulated_reasoning_sink_failure');
        }
        capturedReasoningObservations.push(input.observation.observationId);
      },
    },
    ledgerRepository: createInMemoryTeachingLedgerRepository(),
    unitOfWork,
    frameLog: {
      async ensureTask() {},
      async append(taskId, type, data) {
        const frame = GenerationStreamEventSchema.parse({
          taskId,
          sequence: frames.length + 1,
          emittedAt: '2026-07-14T00:02:00.000Z',
          type,
          data,
        });
        frames.push(frame);
        return frame;
      },
    },
    assistantArtifacts: {
      async save(input) {
        if (options.artifactSaveFails) throw new Error('simulated_artifact_failure');
        artifacts.set(input.artifactRef, input.markdown);
      },
    },
    nextAssistantMessageId: () => 'message_ai_1',
    nextCheckpointId: () => 'checkpoint_1',
    nextTransactionId: () => 'tx_interactive_1',
    now: () => new Date('2026-07-14T00:02:00.000Z'),
  });
  return {
    ...created,
    sessionModule: storedSessionModule,
    messageLog,
    submittedContext: () => submittedContext,
    capturedReasoningObservations,
    frames,
    resolveAgentCompletion(markdown: string) {
      if (resolveAgentCompletion === undefined) throw new Error('completion_not_deferred');
      resolveAgentCompletion({ markdown });
    },
  };
}

describe('InteractiveTeaching deep module', () => {
  it('opens a lesson with an assistant message without creating learner evidence', async () => {
    const {
      module,
      drainObservations,
      messageLog,
      capturedReasoningObservations,
      submittedContext,
    } = await fixture();

    const accepted = await module.openLesson(
      { courseId: 'course_1', lessonId: 'lesson_1', sessionId: 'session_1' },
      commandContext,
    );

    expect(accepted.taskId).toBe('task_1');
    expect(submittedContext()).toMatchObject({ turnKind: 'opening', recentMessages: [] });
    await drainObservations('session_1');

    await expect(messageLog.list('session_1')).resolves.toEqual([
      expect.objectContaining({
        id: 'message_ai_1',
        role: 'assistant',
        completionStatus: 'complete',
      }),
    ]);
    expect(capturedReasoningObservations).toEqual([]);
  });

  it('commits an opening that finishes after the learning session pauses', async () => {
    const { module, drainObservations, sessionModule, messageLog, frames, resolveAgentCompletion } =
      await fixture({ deferredCompletion: true });

    const accepted = await module.openLesson(
      { courseId: 'course_1', lessonId: 'lesson_1', sessionId: 'session_1' },
      commandContext,
    );
    await sessionModule.execute(
      { type: 'PauseLesson', lessonId: 'lesson_1' },
      {
        ...commandContext,
        commandId: 'pause_during_opening',
        idempotencyKey: 'pause_during_opening',
        expectedVersion: accepted.resourceVersion,
      },
    );
    resolveAgentCompletion('Opening completed while the learner was away.');
    await drainObservations('session_1');

    await expect(messageLog.list('session_1')).resolves.toEqual([
      expect.objectContaining({
        id: 'message_ai_1',
        role: 'assistant',
        completionStatus: 'complete',
      }),
    ]);
    const view = await sessionModule.query(
      { type: 'GetLessonLearning', lessonId: 'lesson_1' },
      {
        correlationId: 'query_paused_opening',
        actor: 'local-user',
        requestedAt: commandContext.requestedAt,
        receivedAt: commandContext.receivedAt,
      },
    );
    expect(view.learning.session).toMatchObject({ state: 'paused' });
    expect(view.learning.session?.activeGenerationTaskId).toBeUndefined();
    expect(frames.at(-1)?.type).toBe('task.completed');
  });

  it('keeps a paused turn completed when follow-up observation fails', async () => {
    const { module, drainObservations, sessionModule, messageLog, frames, resolveAgentCompletion } =
      await fixture({ deferredCompletion: true, observerFailsOnce: true });

    const accepted = await module.advanceTurn(
      {
        courseId: 'course_1',
        lessonId: 'lesson_1',
        sessionId: 'session_1',
        userMessageId: 'message_user_1',
        userContentArtifactRef: 'artifact:user:1',
      },
      commandContext,
    );
    await sessionModule.execute(
      { type: 'PauseLesson', lessonId: 'lesson_1' },
      {
        ...commandContext,
        commandId: 'pause_during_turn',
        idempotencyKey: 'pause_during_turn',
        expectedVersion: accepted.resourceVersion,
      },
    );
    resolveAgentCompletion('The complete reply was generated while paused.');

    await expect(drainObservations('session_1')).rejects.toThrow('simulated_observer_failure');
    await expect(messageLog.list('session_1')).resolves.toEqual([
      expect.objectContaining({ id: 'message_user_1', role: 'user' }),
      expect.objectContaining({
        id: 'message_ai_1',
        role: 'assistant',
        completionStatus: 'complete',
      }),
    ]);
    const view = await sessionModule.query(
      { type: 'GetLessonLearning', lessonId: 'lesson_1' },
      {
        correlationId: 'query_paused_turn',
        actor: 'local-user',
        requestedAt: commandContext.requestedAt,
        receivedAt: commandContext.receivedAt,
      },
    );
    expect(view.learning.session).toMatchObject({ state: 'paused' });
    expect(view.learning.session?.activeGenerationTaskId).toBeUndefined();
    expect(frames.at(-1)?.type).toBe('task.completed');
  });

  it('emits a valid failure terminal and releases the session generation slot', async () => {
    const { module, drainObservations, frames, sessionModule } = await fixture({
      artifactSaveFails: true,
    });
    await module.advanceTurn(
      {
        courseId: 'course_1',
        lessonId: 'lesson_1',
        sessionId: 'session_1',
        userMessageId: 'message_user_1',
        userContentArtifactRef: 'artifact:user:1',
      },
      commandContext,
    );

    await expect(drainObservations('session_1')).rejects.toThrow('simulated_artifact_failure');
    expect(frames.at(-1)).toMatchObject({
      type: 'task.failed',
      data: { problem: { code: 'internal_error', retryable: true } },
    });
    const view = await sessionModule.query(
      { type: 'GetLessonLearning', lessonId: 'lesson_1' },
      {
        correlationId: 'query_after_failure',
        actor: 'local-user',
        requestedAt: commandContext.requestedAt,
        receivedAt: commandContext.receivedAt,
      },
    );
    expect(view.learning.session?.activeGenerationTaskId).toBeUndefined();
  });

  it('advances a turn, observes the complete reply, and freezes a source-bound checkpoint', async () => {
    const {
      module,
      drainObservations,
      sessionModule,
      messageLog,
      submittedContext,
      capturedReasoningObservations,
    } = await fixture();
    const accepted = await module.advanceTurn(
      {
        courseId: 'course_1',
        lessonId: 'lesson_1',
        sessionId: 'session_1',
        userMessageId: 'message_user_1',
        userContentArtifactRef: 'artifact:user:1',
      },
      commandContext,
    );

    expect(accepted.taskId).toBe('task_1');
    expect(JSON.stringify(submittedContext())).toContain('Please explain why');
    await drainObservations('session_1');

    expect(await module.getTeachingState('session_1')).toMatchObject({
      ledgerVersion: 1,
      evidenceCheckpoint: true,
      knowledgePoints: [{ delivery: 'explained', verification: 'not_observed' }],
    });
    expect(capturedReasoningObservations).toEqual(['observation_direct']);
    await expect(messageLog.list('session_1')).resolves.toEqual([
      expect.objectContaining({ id: 'message_user_1', completionStatus: 'complete' }),
      expect.objectContaining({ id: 'message_ai_1', completionStatus: 'complete' }),
    ]);
    await expect(
      sessionModule.query(
        { type: 'GetLessonLearning', lessonId: 'lesson_1' },
        {
          correlationId: 'query',
          actor: 'local-user',
          requestedAt: commandContext.requestedAt,
          receivedAt: commandContext.receivedAt,
        },
      ),
    ).resolves.toMatchObject({ learning: { session: { evidenceCheckpoint: true } } });

    const checkpoint = await module.freezeCheckpoint({
      sessionId: 'session_1',
      reason: 'lesson_closure',
    });
    expect(checkpoint).toMatchObject({
      checkpointId: 'checkpoint_1',
      observationCompleteness: 'complete',
      retentionDecision: 'preserve',
      observationRefs: ['observation:observation_direct'],
    });
    await expect(
      module.freezeCheckpoint({ sessionId: 'session_1', reason: 'lesson_closure' }),
    ).resolves.toEqual(checkpoint);
  });

  it('records adjacent exploration without changing current knowledge coverage', async () => {
    const { module, drainObservations } = await fixture({ adjacent: true });
    await module.advanceTurn(
      {
        courseId: 'course_1',
        lessonId: 'lesson_1',
        sessionId: 'session_1',
        userMessageId: 'message_user_1',
        userContentArtifactRef: 'artifact:user:1',
      },
      commandContext,
    );
    await drainObservations('session_1');

    const state = await module.getTeachingState('session_1');
    expect(state.knowledgePoints[0]).toMatchObject({
      delivery: 'not_addressed',
      verification: 'not_observed',
    });
    expect(state.explorationBranches).toEqual([
      expect.objectContaining({ entryId: 'entry_adjacent', status: 'active' }),
    ]);
  });

  it('replays a pending observation after restart without duplicating source evidence', async () => {
    const { module, drainObservations, recoverSession } = await fixture({
      observerFailsOnce: true,
    });
    await module.advanceTurn(
      {
        courseId: 'course_1',
        lessonId: 'lesson_1',
        sessionId: 'session_1',
        userMessageId: 'message_user_1',
        userContentArtifactRef: 'artifact:user:1',
      },
      commandContext,
    );
    await expect(drainObservations('session_1')).rejects.toThrow('simulated_observer_failure');
    await expect(module.getTeachingState('session_1')).resolves.toMatchObject({
      observationStatus: 'failed',
      ledgerVersion: 0,
    });

    await recoverSession({
      courseId: 'course_1',
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      context: commandContext,
    });

    await expect(module.getTeachingState('session_1')).resolves.toMatchObject({
      observationStatus: 'current',
      ledgerVersion: 1,
    });
  });

  it('recovers a persisted active teaching generation and commits its completed reply', async () => {
    const { recoverSession, sessionModule, messageLog } = await fixture();
    await sessionModule.execute(
      {
        type: 'AppendUserMessage',
        lessonId: 'lesson_1',
        messageId: 'message_user_1',
        contentArtifactRef: 'artifact:user:1',
      },
      { ...commandContext, commandId: 'recover_user', expectedVersion: 1 },
    );
    await sessionModule.execute(
      { type: 'StartSessionGeneration', lessonId: 'lesson_1', taskId: 'task_recovered' },
      { ...commandContext, commandId: 'recover_generation', expectedVersion: 2 },
    );

    await recoverSession({
      courseId: 'course_1',
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      context: commandContext,
    });

    const recoveredView = await sessionModule.query(
      { type: 'GetLessonLearning', lessonId: 'lesson_1' },
      {
        correlationId: 'query_recovered_generation',
        actor: 'local-user',
        requestedAt: commandContext.requestedAt,
        receivedAt: commandContext.receivedAt,
      },
    );
    expect(recoveredView.learning.session?.activeGenerationTaskId).toBeUndefined();
    await expect(messageLog.list('session_1')).resolves.toEqual([
      expect.objectContaining({ id: 'message_user_1', completionStatus: 'complete' }),
      expect.objectContaining({ generationTaskId: 'task_recovered', completionStatus: 'complete' }),
    ]);
  });

  it('replays the learning-session evidence projection when the ledger committed first', async () => {
    const { module, drainObservations, recoverSession, sessionModule } = await fixture({
      evidenceEffectFailsOnce: true,
    });
    await module.advanceTurn(
      {
        courseId: 'course_1',
        lessonId: 'lesson_1',
        sessionId: 'session_1',
        userMessageId: 'message_user_1',
        userContentArtifactRef: 'artifact:user:1',
      },
      commandContext,
    );
    await expect(drainObservations('session_1')).rejects.toThrow('simulated_projection_failure');
    await expect(module.getTeachingState('session_1')).resolves.toMatchObject({
      observationStatus: 'current',
      evidenceCheckpoint: true,
    });

    await recoverSession({
      courseId: 'course_1',
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      context: commandContext,
    });

    await expect(
      sessionModule.query(
        { type: 'GetLessonLearning', lessonId: 'lesson_1' },
        {
          correlationId: 'query_recovered',
          actor: 'local-user',
          requestedAt: commandContext.requestedAt,
          receivedAt: commandContext.receivedAt,
        },
      ),
    ).resolves.toMatchObject({ learning: { session: { evidenceCheckpoint: true } } });
  });

  it('replays reasoning-behavior capture when the teaching ledger committed first', async () => {
    const { module, drainObservations, recoverSession, capturedReasoningObservations } =
      await fixture({ reasoningSinkFailsOnce: true });
    await module.advanceTurn(
      {
        courseId: 'course_1',
        lessonId: 'lesson_1',
        sessionId: 'session_1',
        userMessageId: 'message_user_1',
        userContentArtifactRef: 'artifact:user:1',
      },
      commandContext,
    );
    await expect(drainObservations('session_1')).rejects.toThrow(
      'simulated_reasoning_sink_failure',
    );
    expect(capturedReasoningObservations).toEqual([]);

    await recoverSession({
      courseId: 'course_1',
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      context: commandContext,
    });
    expect(capturedReasoningObservations).toEqual(['observation_direct']);
  });
});
