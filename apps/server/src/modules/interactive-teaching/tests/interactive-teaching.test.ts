import type {
  CommandContext,
  PersonalizationView,
  TeachingObservation,
} from '@learning-more/contracts';
import { GenerationStreamEventSchema, type GenerationStreamEvent } from '@learning-more/contracts';
import { describe, expect, it } from 'vitest';

import { createInMemoryLearningSessionRepositories } from '../../../persistence/learning-session-repositories.js';
import { createInMemoryTeachingLedgerRepository } from '../../../persistence/teaching-ledger-repositories.js';
import type { GenerationRuntime } from '../../generation-runtime/interface.js';
import { createInMemoryMessageLog } from '../../learning-session/implementation/message-log.js';
import { createSessionModule } from '../../learning-session/implementation/session-module.js';
import type { LearningSessionModule } from '../../learning-session/interface.js';
import { createTeachingContextAssembler } from '../implementation/context-assembler.js';
import { createInteractiveTeaching } from '../implementation/interactive-teaching.js';
import { createTeachingState } from '../implementation/teaching-state-reducer.js';
import type { TeachingAgent } from '../ports/teaching-agent.js';
import type { TeachingDirective } from '../ports/teaching-agent.js';
import type { TeachingContextSources } from '../ports/teaching-context-sources.js';
import type { TeachingObserver } from '../ports/teaching-observer.js';

type GenerationTask = Awaited<ReturnType<GenerationRuntime['get']>>;

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
    streamReply?: boolean;
    deferredCompletion?: boolean;
    startGenerationFailsOnce?: boolean;
    advanceVersionDuringSubmit?: boolean;
    frameEnsureFailsOnce?: boolean;
    agentDirective?: TeachingDirective;
    legacyRecoveredTaskSourceId?: string;
  } = {},
) {
  const artifacts = new Map<string, string>([
    [
      'artifact:user:1',
      options.adjacent
        ? 'How would intervention change this in the later causal-inference topic?'
        : 'Please explain why the denominator changes.',
    ],
    ['artifact:user:2', 'Can you connect that explanation to the earlier example?'],
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
  let startGenerationShouldFail = options.startGenerationFailsOnce ?? false;
  const sessionModule: LearningSessionModule = {
    query: (query, context) => storedSessionModule.query(query, context),
    async execute(command, context) {
      if (command.type === 'StartSessionGeneration' && startGenerationShouldFail) {
        startGenerationShouldFail = false;
        throw new Error('simulated_generation_binding_failure');
      }
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
        ...(message.generationTaskId === undefined
          ? {}
          : { generationTaskId: message.generationTaskId }),
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
  let submittedRequestRef: string | undefined;
  let submittedTaskCount = 0;
  let assistantMessageCount = 0;
  const cancelledTaskIds: string[] = [];
  const generationTasks = new Map<string, GenerationTask>();
  const observedMessageBatches: string[][] = [];
  let resolveAgentCompletion: ((value: Readonly<{ markdown: string }>) => void) | undefined;
  const deferredCompletion = options.deferredCompletion
    ? new Promise<Readonly<{ markdown: string }>>((resolve) => {
        resolveAgentCompletion = resolve;
      })
    : undefined;
  const agent: TeachingAgent = {
    async submit(context, requestRef) {
      submittedContext = context;
      submittedRequestRef = requestRef;
      submittedTaskCount += 1;
      if (options.advanceVersionDuringSubmit === true) {
        await storedSessionModule.execute(
          { type: 'EstablishEvidenceCheckpoint', lessonId: 'lesson_1' },
          {
            ...commandContext,
            commandId: `advance_version_during_submit_${submittedTaskCount}`,
            idempotencyKey: `advance_version_during_submit_${submittedTaskCount}`,
            expectedVersion: undefined,
          },
        );
      }
      const taskId = `task_${submittedTaskCount}`;
      generationTasks.set(taskId, {
        id: taskId,
        taskKey: `teaching:${taskId}`,
        status: 'queued',
        createdAt: '2026-07-14T00:00:00.000Z',
        updatedAt: '2026-07-14T00:00:00.000Z',
        resourceVersion: 0,
        taskKind: 'interactive-teaching',
        taskGroup: 'interactive',
        ownerRef: 'session_1',
        requestRef,
      });
      return { taskId };
    },
    async listTasks() {
      return [
        ...generationTasks.values(),
        {
          id: 'task_recovered',
          taskKey: 'teaching:task_recovered',
          status: 'completed' as const,
          createdAt: '2026-07-14T00:00:00.000Z',
          updatedAt: '2026-07-14T00:01:00.000Z',
          resourceVersion: 1,
          taskKind: 'interactive-teaching',
          taskGroup: 'interactive' as const,
          ownerRef: 'session_1',
          ...(options.legacyRecoveredTaskSourceId === undefined
            ? { requestRef: 'message_user_1' }
            : {
                prompt: `allowed source ${JSON.stringify(options.legacyRecoveredTaskSourceId)}`,
              }),
        },
      ];
    },
    async cancel(taskId) {
      cancelledTaskIds.push(taskId);
      const current = generationTasks.get(taskId);
      if (current !== undefined) generationTasks.set(taskId, { ...current, status: 'cancelled' });
    },
    async complete(_taskId, observer) {
      if (deferredCompletion !== undefined) return deferredCompletion;
      const markdown = options.adjacent
        ? 'That is a useful adjacent direction. Let us explore it briefly, then return to the denominator change.'
        : 'Conditioning narrows the reference population, so the denominator changes with the sample space.';
      if (options.streamReply === true) {
        const split = markdown.indexOf(',') + 1;
        await observer?.onReplyDelta?.(markdown.slice(0, split));
        await observer?.onReplyDelta?.(markdown.slice(split));
      }
      const current = generationTasks.get(_taskId);
      if (current !== undefined) generationTasks.set(_taskId, { ...current, status: 'completed' });
      return {
        markdown,
        ...(options.agentDirective === undefined ? {} : { directive: options.agentDirective }),
      };
    },
    async read() {
      return options.agentDirective === undefined
        ? undefined
        : { markdown: 'Recovered teaching explanation.', directive: options.agentDirective };
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
  const capturedInteractionObservations: TeachingObservation[] = [];
  const frames: GenerationStreamEvent[] = [];
  let frameEnsureShouldFail = options.frameEnsureFailsOnce ?? false;
  const observer: TeachingObserver = {
    async observe(input): Promise<TeachingObservation> {
      if (observerShouldFail) {
        observerShouldFail = false;
        throw new Error('simulated_observer_failure');
      }
      const sourceMessageIds = input.messages.map((message) => message.messageId);
      observedMessageBatches.push(sourceMessageIds);
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
        interactions: input.messages
          .map((message, index) => ({ message, index }))
          .filter(
            ({ message }) =>
              message.role === 'assistant' && message.completionStatus === 'complete',
          )
          .map(({ message, index }) => {
            const response = input.messages
              .slice(index + 1)
              .find(
                (candidate) =>
                  candidate.role === 'user' && candidate.completionStatus === 'complete',
              );
            return {
              interactionId: `interaction:${message.messageId}`,
              knowledgePointRefs: ['knowledge:kp_1'],
              promptSourceRef: `message:${message.messageId}`,
              outcome: response === undefined ? ('pending' as const) : ('responded' as const),
              ...(response === undefined
                ? {}
                : { responseSourceRef: `message:${response.messageId}` }),
            };
          }),
        observerVersion: 'teaching-observer@1',
        observedAt: '2026-07-14T00:01:00.000Z',
        status: 'active',
      };
    },
  };
  const ledgerRepository = createInMemoryTeachingLedgerRepository();
  const created = createInteractiveTeaching({
    sessionModule,
    contextSources: sources,
    contextAssembler: createTeachingContextAssembler({ sources }),
    agent,
    observer,
    interactionSink: {
      async captureFromObservation(input) {
        capturedInteractionObservations.push(input.observation);
      },
    },
    reasoningBehaviorSink: {
      async captureFromObservation(input) {
        if (reasoningSinkShouldFail) {
          reasoningSinkShouldFail = false;
          throw new Error('simulated_reasoning_sink_failure');
        }
        capturedReasoningObservations.push(input.observation.observationId);
      },
    },
    ledgerRepository,
    unitOfWork,
    frameLog: {
      async ensureTask() {
        if (frameEnsureShouldFail) {
          frameEnsureShouldFail = false;
          throw new Error('simulated_frame_journal_failure');
        }
      },
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
    nextAssistantMessageId: () => {
      assistantMessageCount += 1;
      return `message_ai_${assistantMessageCount}`;
    },
    nextCheckpointId: () => 'checkpoint_1',
    nextTransactionId: () => 'tx_interactive_1',
    now: () => new Date('2026-07-14T00:02:00.000Z'),
  });
  return {
    ...created,
    sessionModule: storedSessionModule,
    messageLog,
    submittedContext: () => submittedContext,
    submittedRequestRef: () => submittedRequestRef,
    cancelledTaskIds,
    capturedReasoningObservations,
    capturedInteractionObservations,
    observedMessageBatches,
    ledgerRepository,
    frames,
    resolveAgentCompletion(markdown: string) {
      if (resolveAgentCompletion === undefined) throw new Error('completion_not_deferred');
      resolveAgentCompletion({ markdown });
    },
  };
}

describe('InteractiveTeaching deep module', () => {
  it('cancels a submitted task when session binding fails', async () => {
    const { module, cancelledTaskIds, submittedRequestRef } = await fixture({
      startGenerationFailsOnce: true,
    });

    await expect(
      module.advanceTurn(
        {
          courseId: 'course_1',
          lessonId: 'lesson_1',
          sessionId: 'session_1',
          userMessageId: 'message_user_1',
          userContentArtifactRef: 'artifact:user:1',
        },
        commandContext,
      ),
    ).rejects.toThrow('simulated_generation_binding_failure');

    expect(submittedRequestRef()).toBe('message_user_1');
    expect(cancelledTaskIds).toEqual(['task_1']);
  });

  it('clears the session binding when frame journal creation fails after binding', async () => {
    const { module, sessionModule, cancelledTaskIds } = await fixture({
      frameEnsureFailsOnce: true,
    });

    await expect(
      module.advanceTurn(
        {
          courseId: 'course_1',
          lessonId: 'lesson_1',
          sessionId: 'session_1',
          userMessageId: 'message_user_1',
          userContentArtifactRef: 'artifact:user:1',
        },
        commandContext,
      ),
    ).rejects.toThrow('simulated_frame_journal_failure');

    const view = await sessionModule.query(
      { type: 'GetLessonLearning', lessonId: 'lesson_1' },
      {
        correlationId: 'query_compensated_binding',
        actor: 'local-user',
        requestedAt: commandContext.requestedAt,
        receivedAt: commandContext.receivedAt,
      },
    );
    expect(view.learning.session?.activeGenerationTaskId).toBeUndefined();
    expect(cancelledTaskIds).toEqual(['task_1']);
  });

  it('re-reads the session version before binding a submitted task', async () => {
    const { module, drainObservations } = await fixture({ advanceVersionDuringSubmit: true });

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
    await drainObservations('session_1');
  });

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

  it('forwards safe assistant reply deltas without replaying the full reply at completion', async () => {
    const { module, drainObservations, frames } = await fixture({ streamReply: true });

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

    const deltas = frames.filter((frame) => frame.type === 'message.delta');
    expect(deltas).toHaveLength(2);
    expect(deltas.map((frame) => frame.data.markdown).join('')).toBe(
      'Conditioning narrows the reference population, so the denominator changes with the sample space.',
    );
    expect(frames.map((frame) => frame.type)).toEqual([
      'message.started',
      'message.delta',
      'message.delta',
      'message.completed',
      'artifact.ready',
      'task.completed',
    ]);
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

  it('commits the teaching agent directive before observation and exposes its control state', async () => {
    const { module, drainObservations } = await fixture({
      agentDirective: {
        schemaVersion: 1,
        lessonPhase: 'comprehensive_check',
        knowledgePoints: [
          {
            ref: 'knowledge:kp_1',
            status: 'completed',
            interactionStatus: 'skipped',
          },
        ],
        comprehensiveCheck: 'learning',
        closureInquiry: 'pending',
        summaryStatus: 'pending',
      },
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
    await drainObservations('session_1');

    await expect(module.getTeachingState('session_1')).resolves.toMatchObject({
      lessonPhase: 'comprehensive_check',
      knowledgePoints: [{ progress: 'completed', interactionStatus: 'skipped' }],
    });
  });

  it('rebuilds each teaching observation from the complete session history', async () => {
    const { module, drainObservations, observedMessageBatches, capturedInteractionObservations } =
      await fixture();
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
    await module.advanceTurn(
      {
        courseId: 'course_1',
        lessonId: 'lesson_1',
        sessionId: 'session_1',
        userMessageId: 'message_user_2',
        userContentArtifactRef: 'artifact:user:2',
      },
      {
        ...commandContext,
        commandId: 'command_turn_2',
        idempotencyKey: 'idempotency_2',
        expectedVersion: undefined,
      },
    );
    await drainObservations('session_1');

    expect(observedMessageBatches).toEqual([
      ['message_user_1', 'message_ai_1'],
      ['message_ai_1', 'message_user_2', 'message_ai_2'],
    ]);
    expect(capturedInteractionObservations.at(-1)?.interactions).toEqual([
      expect.objectContaining({
        interactionId: 'interaction:message_ai_1',
        outcome: 'responded',
        responseSourceRef: 'message:message_user_2',
      }),
      expect.objectContaining({
        interactionId: 'interaction:message_ai_2',
        outcome: 'pending',
      }),
    ]);
  });

  it('replays the latest hidden teaching directive when the persisted ledger is stale', async () => {
    const directive: TeachingDirective = {
      schemaVersion: 1,
      lessonPhase: 'comprehensive_check',
      knowledgePoints: [
        { ref: 'knowledge:kp_1', status: 'completed', interactionStatus: 'completed' },
      ],
      comprehensiveCheck: 'learning',
      closureInquiry: 'pending',
      summaryStatus: 'pending',
    };
    const { module, drainObservations, recoverSession, ledgerRepository } = await fixture({
      agentDirective: directive,
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
    await drainObservations('session_1');
    const current = (await ledgerRepository.get('session_1'))!;
    await ledgerRepository.save(
      tx,
      {
        ...current,
        state: createTeachingState({
          lessonId: 'lesson_1',
          sessionId: 'session_1',
          knowledgePointRefs: ['knowledge:kp_1'],
        }),
      },
      current.resourceVersion,
    );

    await recoverSession({
      courseId: 'course_1',
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      context: commandContext,
    });

    await expect(module.getTeachingState('session_1')).resolves.toMatchObject({
      lessonPhase: 'comprehensive_check',
      comprehensiveCheck: 'learning',
      knowledgePoints: [{ progress: 'completed', interactionStatus: 'completed' }],
    });
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
      {
        type: 'StartSessionGeneration',
        lessonId: 'lesson_1',
        taskId: 'task_recovered',
        mode: 'new-turn',
      },
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

  it('rebinds and commits an orphaned completed reply while the session remains paused', async () => {
    const { recoverSession, sessionModule, messageLog } = await fixture();
    const appended = await sessionModule.execute(
      {
        type: 'AppendUserMessage',
        lessonId: 'lesson_1',
        messageId: 'message_user_1',
        contentArtifactRef: 'artifact:user:1',
      },
      { ...commandContext, commandId: 'orphan_user', expectedVersion: 1 },
    );
    await sessionModule.execute(
      { type: 'PauseLesson', lessonId: 'lesson_1' },
      {
        ...commandContext,
        commandId: 'pause_before_orphan_recovery',
        expectedVersion: appended.value.resourceVersion,
      },
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
        correlationId: 'query_orphan_recovery',
        actor: 'local-user',
        requestedAt: commandContext.requestedAt,
        receivedAt: commandContext.receivedAt,
      },
    );
    expect(recoveredView.learning.session).toMatchObject({ state: 'paused' });
    expect(recoveredView.learning.session?.activeGenerationTaskId).toBeUndefined();
    await expect(messageLog.list('session_1')).resolves.toEqual([
      expect.objectContaining({ id: 'message_user_1', role: 'user' }),
      expect.objectContaining({
        role: 'assistant',
        generationTaskId: 'task_recovered',
        completionStatus: 'complete',
      }),
    ]);
  });

  it('recovers a legacy completed reply after an old retry duplicated the paused user turn', async () => {
    const { recoverSession, sessionModule, messageLog } = await fixture({
      legacyRecoveredTaskSourceId: 'message_user_original',
    });
    const original = await sessionModule.execute(
      {
        type: 'AppendUserMessage',
        lessonId: 'lesson_1',
        messageId: 'message_user_original',
        contentArtifactRef: 'artifact:user:1',
      },
      { ...commandContext, commandId: 'legacy_original_user', expectedVersion: 1 },
    );
    const duplicated = await sessionModule.execute(
      {
        type: 'AppendUserMessage',
        lessonId: 'lesson_1',
        messageId: 'message_user_duplicate',
        contentArtifactRef: 'artifact:user:1',
      },
      {
        ...commandContext,
        commandId: 'legacy_duplicate_user',
        expectedVersion: original.value.resourceVersion,
      },
    );
    await sessionModule.execute(
      { type: 'PauseLesson', lessonId: 'lesson_1' },
      {
        ...commandContext,
        commandId: 'pause_legacy_duplicate_user',
        expectedVersion: duplicated.value.resourceVersion,
      },
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
        correlationId: 'query_legacy_duplicate_recovery',
        actor: 'local-user',
        requestedAt: commandContext.requestedAt,
        receivedAt: commandContext.receivedAt,
      },
    );
    expect(recoveredView.learning.session).toMatchObject({ state: 'paused' });
    expect(recoveredView.learning.session?.activeGenerationTaskId).toBeUndefined();
    await expect(messageLog.list('session_1')).resolves.toEqual([
      expect.objectContaining({ id: 'message_user_original', role: 'user' }),
      expect.objectContaining({ id: 'message_user_duplicate', role: 'user' }),
      expect.objectContaining({
        role: 'assistant',
        generationTaskId: 'task_recovered',
        completionStatus: 'complete',
      }),
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
