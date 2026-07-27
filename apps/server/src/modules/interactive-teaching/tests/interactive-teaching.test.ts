import type {
  CommandContext,
  PersonalizationView,
  TeachingObservation,
  TeachingStateSnapshot,
} from '@learning-more/contracts';
import { GenerationStreamEventSchema, type GenerationStreamEvent } from '@learning-more/contracts';
import { describe, expect, it } from 'vitest';

import { createInMemoryLearningSessionRepositories } from '../../../persistence/learning-session-repositories.js';
import { createInMemoryTeachingLedgerRepository } from '../../../persistence/teaching-ledger-repositories.js';
import { RepositoryVersionConflictError } from '../../../persistence/repository-errors.js';
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
import type { TeachingLedgerRepository } from '../ports/teaching-ledger-repository.js';
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
    observerReturnsInvalidInteraction?: boolean;
    evidenceEffectFailsOnce?: boolean;
    reasoningSinkFailsOnce?: boolean;
    artifactSaveFails?: boolean;
    streamReply?: boolean;
    deferredCompletion?: boolean;
    startGenerationFailsOnce?: boolean;
    advanceVersionDuringSubmit?: boolean;
    frameEnsureFailsOnce?: boolean;
    frameDeltaFailsOnce?: boolean;
    agentDirective?: TeachingDirective;
    legacyRecoveredTaskSourceId?: string;
    recoveredTaskStatus?: GenerationTask['status'];
    recoveredTaskMarkdown?: string;
    ledgerDirectiveSaveConflictsOnce?: boolean;
    agentReadError?: Error;
    agentRecoverError?: Error;
    stopNeverSettles?: boolean;
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
  const ledgerRepositoryForCommit: { current?: TeachingLedgerRepository } = {};
  const ledgerStatesAtAssistantCommit: TeachingStateSnapshot[] = [];
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
      if (command.type === 'CommitAssistantMessage') {
        const ledger = await ledgerRepositoryForCommit.current?.get('session_1');
        if (ledger !== undefined) ledgerStatesAtAssistantCommit.push(ledger.state);
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
  const invalidatedTaskIds: string[] = [];
  const generationTasks = new Map<string, GenerationTask>();
  let recoveredTaskStatus = options.recoveredTaskStatus ?? ('completed' as const);
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
          status: recoveredTaskStatus,
          createdAt: '2026-07-14T00:00:00.000Z',
          updatedAt: '2026-07-14T00:01:00.000Z',
          resourceVersion: 1,
          taskKind: 'interactive-teaching',
          taskGroup: 'interactive' as const,
          ownerRef: 'session_1',
          draftMarkdown: options.recoveredTaskMarkdown ?? 'Recovered teaching explanation.',
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
    async invalidate(taskId, errorCode) {
      invalidatedTaskIds.push(taskId);
      if (taskId === 'task_recovered') recoveredTaskStatus = 'failed';
      const current = generationTasks.get(taskId);
      if (current !== undefined) {
        generationTasks.set(taskId, { ...current, status: 'failed', errorCode });
      }
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
        await observer?.onReplyCompleted?.(markdown);
      }
      const current = generationTasks.get(_taskId);
      if (current !== undefined) generationTasks.set(_taskId, { ...current, status: 'completed' });
      return {
        markdown,
        ...(options.agentDirective === undefined ? {} : { directive: options.agentDirective }),
      };
    },
    async read() {
      if (options.agentReadError !== undefined) throw options.agentReadError;
      return options.agentDirective === undefined
        ? undefined
        : { markdown: 'Recovered teaching explanation.', directive: options.agentDirective };
    },
    async recover() {
      if (options.agentRecoverError !== undefined) throw options.agentRecoverError;
      return {
        markdown: 'Recovered teaching explanation.',
        completionStatus: 'complete',
      };
    },
    async stop() {
      if (options.stopNeverSettles === true) {
        return new Promise<never>(() => undefined);
      }
      return { markdown: 'Partial', completionStatus: 'interrupted' };
    },
  };
  let observerShouldFail = options.observerFailsOnce ?? false;
  let reasoningSinkShouldFail = options.reasoningSinkFailsOnce ?? false;
  const capturedReasoningObservations: string[] = [];
  const capturedInteractionObservations: TeachingObservation[] = [];
  const frames: GenerationStreamEvent[] = [];
  let frameEnsureShouldFail = options.frameEnsureFailsOnce ?? false;
  let frameDeltaShouldFail = options.frameDeltaFailsOnce ?? false;
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
            if (options.observerReturnsInvalidInteraction) {
              return {
                interactionId: `interaction:${message.messageId}`,
                knowledgePointRefs: ['knowledge:kp_1'],
                promptSourceRef: `message:${message.messageId}`,
                outcome: 'responded' as const,
                responseSourceRef: `message:${message.messageId}`,
              };
            }
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
  const storedLedgerRepository = createInMemoryTeachingLedgerRepository();
  let ledgerDirectiveSaveShouldConflict = options.ledgerDirectiveSaveConflictsOnce ?? false;
  const ledgerRepository: TeachingLedgerRepository = {
    get: (sessionId) => storedLedgerRepository.get(sessionId),
    async save(context, record, expectedVersion) {
      if (record.state.summaryStatus === 'delivered' && ledgerDirectiveSaveShouldConflict) {
        ledgerDirectiveSaveShouldConflict = false;
        throw new RepositoryVersionConflictError(expectedVersion);
      }
      return storedLedgerRepository.save(context, record, expectedVersion);
    },
    delete: (context, sessionId, expectedVersion) =>
      storedLedgerRepository.delete(context, sessionId, expectedVersion),
    list: (filter) => storedLedgerRepository.list(filter),
  };
  ledgerRepositoryForCommit.current = ledgerRepository;
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
        if (type === 'message.delta' && frameDeltaShouldFail) {
          frameDeltaShouldFail = false;
          throw new Error('simulated_frame_delta_failure');
        }
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
    async resolveSession(sessionId) {
      if (sessionId !== 'session_1') throw new Error('teaching_session_not_found');
      return { courseId: 'course_1', lessonId: 'lesson_1', sessionId: 'session_1' };
    },
  });
  return {
    ...created,
    sessionModule: storedSessionModule,
    messageLog,
    submittedContext: () => submittedContext,
    submittedRequestRef: () => submittedRequestRef,
    cancelledTaskIds,
    invalidatedTaskIds,
    capturedReasoningObservations,
    capturedInteractionObservations,
    observedMessageBatches,
    ledgerRepository,
    ledgerStatesAtAssistantCommit,
    frames,
    resolveAgentCompletion(markdown: string) {
      if (resolveAgentCompletion === undefined) throw new Error('completion_not_deferred');
      resolveAgentCompletion({ markdown });
    },
  };
}

async function seedLearningKnowledgePoint(ledgerRepository: TeachingLedgerRepository) {
  const initial = createTeachingState({
    lessonId: 'lesson_1',
    sessionId: 'session_1',
    knowledgePointRefs: ['knowledge:kp_1'],
  });
  await ledgerRepository.save(
    tx,
    {
      courseId: 'course_1',
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      observations: [],
      checkpoints: [],
      state: {
        ...initial,
        lessonPhase: 'knowledge_point',
        activeKnowledgePointRef: 'knowledge:kp_1',
        knowledgePoints: initial.knowledgePoints.map((point) => ({
          ...point,
          progress: 'learning',
          interactionStatus: 'pending',
        })),
      },
      resourceVersion: 0,
    },
    0,
  );
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

  it('keeps the authoritative generation running when frame journal creation fails', async () => {
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
    ).resolves.toEqual({ taskId: 'task_1', resourceVersion: 3 });

    const view = await sessionModule.query(
      { type: 'GetLessonLearning', lessonId: 'lesson_1' },
      {
        correlationId: 'query_preserved_binding',
        actor: 'local-user',
        requestedAt: commandContext.requestedAt,
        receivedAt: commandContext.receivedAt,
      },
    );
    expect(view.learning.session?.activeGenerationTaskId).toBe('task_1');
    expect(cancelledTaskIds).toEqual([]);
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

  it('binds an assistant reply to the active knowledge point before applying its directive', async () => {
    const { module, drainObservations, ledgerRepository, messageLog } = await fixture();
    await seedLearningKnowledgePoint(ledgerRepository);

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

    expect(await messageLog.list('session_1')).toContainEqual(
      expect.objectContaining({
        id: 'message_ai_1',
        knowledgePointRef: 'knowledge:kp_1',
      }),
    );
  });

  it('continues from an offered handoff without appending or observing a learner message', async () => {
    const { module, drainObservations, messageLog, submittedContext, observedMessageBatches } =
      await fixture({
        agentDirective: {
          schemaVersion: 3,
          lessonPhase: 'warmup',
          turnHandoff: 'offer_continue',
        },
      });

    await module.openLesson(
      { courseId: 'course_1', lessonId: 'lesson_1', sessionId: 'session_1' },
      commandContext,
    );
    await drainObservations('session_1');
    const continued = await module.continueTurn(
      { courseId: 'course_1', lessonId: 'lesson_1', sessionId: 'session_1' },
      { ...commandContext, commandId: 'continue_turn', idempotencyKey: 'continue_turn' },
    );
    await drainObservations('session_1');

    expect(continued.taskId).toBe('task_2');
    expect(submittedContext()).toMatchObject({ turnKind: 'continuation' });
    expect(await messageLog.list('session_1')).toEqual([
      expect.objectContaining({ role: 'assistant' }),
      expect.objectContaining({ role: 'assistant' }),
    ]);
    expect(observedMessageBatches).toEqual([]);
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

  it('keeps a completed streamed reply independent when the trailing teaching directive is invalid', async () => {
    const { module, drainObservations, frames, messageLog } = await fixture({
      streamReply: true,
      agentDirective: {
        schemaVersion: 1,
        lessonPhase: 'warmup',
        knowledgePoints: [
          {
            ref: 'knowledge:unknown',
            status: 'pending',
            interactionStatus: 'pending',
          },
        ],
        comprehensiveCheck: 'pending',
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

    await expect(drainObservations('session_1')).rejects.toThrow(
      'teaching_directive_knowledge_points_mismatch',
    );
    await expect(messageLog.list('session_1')).resolves.toEqual([
      expect.objectContaining({ id: 'message_user_1', role: 'user' }),
      expect.objectContaining({
        id: 'message_ai_1',
        role: 'assistant',
        completionStatus: 'complete',
      }),
    ]);
    await expect(module.getTeachingState('session_1')).resolves.toMatchObject({
      lessonPhase: 'warmup',
      observationStatus: 'failed',
      knowledgePoints: [{ ref: 'knowledge:kp_1', progress: 'pending' }],
    });
    expect(frames.map((frame) => frame.type)).toEqual([
      'message.started',
      'message.delta',
      'message.delta',
      'message.completed',
      'artifact.ready',
      'task.failed',
    ]);
    expect(frames.at(-1)).toMatchObject({
      type: 'task.failed',
      data: { problem: { code: 'projection_incomplete', recovery: { action: 'refresh' } } },
    });
  });

  it('commits the authoritative reply when incremental frame projection fails', async () => {
    const { module, drainObservations, frames, messageLog } = await fixture({
      streamReply: true,
      frameDeltaFailsOnce: true,
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

    await expect(messageLog.list('session_1')).resolves.toEqual([
      expect.objectContaining({ id: 'message_user_1', role: 'user' }),
      expect.objectContaining({
        id: 'message_ai_1',
        role: 'assistant',
        completionStatus: 'complete',
      }),
    ]);
    expect(frames.some((frame) => frame.type === 'task.failed')).toBe(false);
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

  it('stops a durable generation after volatile task ownership is lost', async () => {
    const { module, sessionModule, messageLog, ledgerRepository } = await fixture();
    await seedLearningKnowledgePoint(ledgerRepository);
    await sessionModule.execute(
      {
        type: 'StartSessionGeneration',
        lessonId: 'lesson_1',
        taskId: 'task_recovered',
        mode: 'new-turn',
      },
      { ...commandContext, commandId: 'bind_durable_task', expectedVersion: 1 },
    );

    const stopped = await module.stopTurn(
      { sessionId: 'session_1', taskId: 'task_recovered' },
      { ...commandContext, commandId: 'stop_durable_task', expectedVersion: 2 },
    );

    expect(stopped).toMatchObject({ taskId: 'task_recovered', completionStatus: 'interrupted' });
    const view = await sessionModule.query(
      { type: 'GetLessonLearning', lessonId: 'lesson_1' },
      {
        correlationId: 'query_after_durable_stop',
        actor: 'local-user',
        requestedAt: commandContext.requestedAt,
        receivedAt: commandContext.receivedAt,
      },
    );
    expect(view.learning.session?.activeGenerationTaskId).toBeUndefined();
    await expect(messageLog.list('session_1')).resolves.toEqual([
      expect.objectContaining({
        generationTaskId: 'task_recovered',
        completionStatus: 'interrupted',
        knowledgePointRef: 'knowledge:kp_1',
      }),
    ]);
  });

  it('discards a cancelled turn before a late completion can update the transcript', async () => {
    const { module, drainObservations, messageLog, resolveAgentCompletion, sessionModule } =
      await fixture({ deferredCompletion: true });
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

    const stopped = await module.stopTurn(
      {
        sessionId: 'session_1',
        taskId: accepted.taskId,
        disposition: 'discard',
      },
      {
        ...commandContext,
        commandId: 'discard_active_turn',
        expectedVersion: accepted.resourceVersion,
      },
    );
    resolveAgentCompletion('This late reply must not be committed.');
    await drainObservations('session_1');

    expect(stopped).toMatchObject({
      taskId: accepted.taskId,
      completionStatus: 'interrupted',
    });
    expect(stopped).not.toHaveProperty('assistantMessageId');
    await expect(messageLog.list('session_1')).resolves.toEqual([
      expect.objectContaining({ id: 'message_user_1', role: 'user' }),
    ]);
    const view = await sessionModule.query(
      { type: 'GetLessonLearning', lessonId: 'lesson_1' },
      {
        correlationId: 'query_after_discard',
        actor: 'local-user',
        requestedAt: commandContext.requestedAt,
        receivedAt: commandContext.receivedAt,
      },
    );
    expect(view.learning.session?.activeGenerationTaskId).toBeUndefined();
  });

  it('releases a discarded turn without waiting for provider cancellation to settle', async () => {
    const { module, sessionModule } = await fixture({
      deferredCompletion: true,
      stopNeverSettles: true,
    });
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

    const outcome = await Promise.race([
      module
        .stopTurn(
          {
            sessionId: 'session_1',
            taskId: accepted.taskId,
            disposition: 'discard',
          },
          {
            ...commandContext,
            commandId: 'discard_without_provider_wait',
            expectedVersion: accepted.resourceVersion,
          },
        )
        .then(() => 'stopped' as const),
      new Promise<'timed-out'>((resolve) => setTimeout(() => resolve('timed-out'), 10)),
    ]);

    expect(outcome).toBe('stopped');
    const view = await sessionModule.query(
      { type: 'GetLessonLearning', lessonId: 'lesson_1' },
      {
        correlationId: 'query_after_fast_discard',
        actor: 'local-user',
        requestedAt: commandContext.requestedAt,
        receivedAt: commandContext.receivedAt,
      },
    );
    expect(view.learning.session?.activeGenerationTaskId).toBeUndefined();
  });

  it('replaces the latest completed assistant reply when its user message is revised', async () => {
    const { module, drainObservations, messageLog } = await fixture();
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

    const revised = await module.reviseTurn(
      {
        courseId: 'course_1',
        lessonId: 'lesson_1',
        sessionId: 'session_1',
        replacedUserMessageId: 'message_user_1',
        userMessageId: 'message_user_2',
        userContentArtifactRef: 'artifact:user:2',
      },
      {
        ...commandContext,
        commandId: 'revise_completed_turn',
        idempotencyKey: 'revise_completed_turn',
        expectedVersion: 3,
      },
    );
    expect(revised.taskId).toBe('task_2');
    await drainObservations('session_1');

    await expect(messageLog.list('session_1')).resolves.toEqual([
      expect.objectContaining({ id: 'message_user_2', role: 'user' }),
      expect.objectContaining({
        id: 'message_ai_2',
        role: 'assistant',
        generationTaskId: 'task_2',
        completionStatus: 'complete',
      }),
    ]);
  });

  it.each(['failed', 'cancelled', 'timeout'] as const)(
    'clears a %s durable task binding during read reconciliation',
    async (status) => {
      const { reconcileGeneration, sessionModule } = await fixture({
        recoveredTaskStatus: status,
      });
      await sessionModule.execute(
        {
          type: 'StartSessionGeneration',
          lessonId: 'lesson_1',
          taskId: 'task_recovered',
          mode: 'new-turn',
        },
        { ...commandContext, commandId: `bind_${status}_task`, expectedVersion: 1 },
      );

      await reconcileGeneration({
        courseId: 'course_1',
        lessonId: 'lesson_1',
        sessionId: 'session_1',
        context: { ...commandContext, commandId: `reconcile_${status}_task` },
      });

      const view = await sessionModule.query(
        { type: 'GetLessonLearning', lessonId: 'lesson_1' },
        {
          correlationId: `query_${status}_task`,
          actor: 'local-user',
          requestedAt: commandContext.requestedAt,
          receivedAt: commandContext.receivedAt,
        },
      );
      expect(view.learning.session?.activeGenerationTaskId).toBeUndefined();
    },
  );

  it('leaves a running task active while a paused session snapshot is reconciled', async () => {
    const { reconcileGeneration, sessionModule } = await fixture({
      recoveredTaskStatus: 'running',
    });
    const appended = await sessionModule.execute(
      {
        type: 'AppendUserMessage',
        lessonId: 'lesson_1',
        messageId: 'message_user_1',
        contentArtifactRef: 'artifact:user:1',
      },
      { ...commandContext, commandId: 'append_running_task_user', expectedVersion: 1 },
    );
    const bound = await sessionModule.execute(
      {
        type: 'StartSessionGeneration',
        lessonId: 'lesson_1',
        taskId: 'task_recovered',
        mode: 'new-turn',
      },
      {
        ...commandContext,
        commandId: 'bind_running_task',
        expectedVersion: appended.value.resourceVersion,
      },
    );
    await sessionModule.execute(
      { type: 'PauseLesson', lessonId: 'lesson_1' },
      {
        ...commandContext,
        commandId: 'pause_running_task',
        expectedVersion: bound.value.resourceVersion,
      },
    );

    await reconcileGeneration({
      courseId: 'course_1',
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      context: { ...commandContext, commandId: 'reconcile_running_task' },
    });

    const view = await sessionModule.query(
      { type: 'GetLessonLearning', lessonId: 'lesson_1' },
      {
        correlationId: 'query_running_task',
        actor: 'local-user',
        requestedAt: commandContext.requestedAt,
        receivedAt: commandContext.receivedAt,
      },
    );
    expect(view.learning.session).toMatchObject({
      state: 'paused',
      activeGenerationTaskId: 'task_recovered',
    });
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
    const { module, drainObservations, ledgerRepository } = await fixture({
      agentDirective: {
        schemaVersion: 1,
        lessonPhase: 'comprehensive_application',
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
    await seedLearningKnowledgePoint(ledgerRepository);

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
      lessonPhase: 'comprehensive_application',
      knowledgePoints: [{ progress: 'completed', interactionStatus: 'skipped' }],
    });
  });

  it('atomically completes discussion and summary before publishing the final reply', async () => {
    const directive: TeachingDirective = {
      schemaVersion: 1,
      lessonPhase: 'ready_to_close',
      knowledgePoints: [
        { ref: 'knowledge:kp_1', status: 'completed', interactionStatus: 'completed' },
      ],
      comprehensiveCheck: 'completed',
      closureInquiry: 'confirmed_no_questions',
      summaryStatus: 'delivered',
    };
    const {
      module,
      drainObservations,
      ledgerRepository,
      ledgerStatesAtAssistantCommit,
      messageLog,
    } = await fixture({
      agentDirective: directive,
      ledgerDirectiveSaveConflictsOnce: true,
    });
    const initial = createTeachingState({
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      knowledgePointRefs: ['knowledge:kp_1'],
    });
    await ledgerRepository.save(
      tx,
      {
        courseId: 'course_1',
        lessonId: 'lesson_1',
        sessionId: 'session_1',
        observations: [],
        checkpoints: [],
        state: {
          ...initial,
          lessonPhase: 'discussion',
          comprehensiveCheck: 'completed',
          closureInquiry: 'awaiting_confirmation',
          summaryStatus: 'pending',
          knowledgePoints: initial.knowledgePoints.map((point) => ({
            ...point,
            progress: 'completed',
            interactionStatus: 'completed',
          })),
        },
        resourceVersion: 0,
      },
      0,
    );

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
      lessonPhase: 'ready_to_close',
      closureInquiry: 'confirmed_no_questions',
      summaryStatus: 'delivered',
    });
    expect(ledgerStatesAtAssistantCommit).toEqual([
      expect.objectContaining({
        lessonPhase: 'ready_to_close',
        closureInquiry: 'confirmed_no_questions',
        summaryStatus: 'delivered',
      }),
    ]);
    await expect(messageLog.list('session_1')).resolves.toEqual([
      expect.objectContaining({ role: 'user' }),
      expect.objectContaining({ role: 'assistant', completionStatus: 'complete' }),
    ]);
  });

  it('keeps the first delivered classroom summary as the Review projection source', async () => {
    const directive: TeachingDirective = {
      schemaVersion: 1,
      lessonPhase: 'ready_to_close',
      knowledgePoints: [
        { ref: 'knowledge:kp_1', status: 'completed', interactionStatus: 'completed' },
      ],
      comprehensiveCheck: 'completed',
      closureInquiry: 'confirmed_no_questions',
      summaryStatus: 'delivered',
    };
    const { module, drainObservations, ledgerRepository } = await fixture({
      agentDirective: directive,
    });
    const initial = createTeachingState({
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      knowledgePointRefs: ['knowledge:kp_1'],
    });
    await ledgerRepository.save(
      tx,
      {
        courseId: 'course_1',
        lessonId: 'lesson_1',
        sessionId: 'session_1',
        observations: [],
        checkpoints: [],
        state: {
          ...initial,
          lessonPhase: 'discussion',
          comprehensiveCheck: 'completed',
          closureInquiry: 'awaiting_confirmation',
          summaryStatus: 'pending',
          knowledgePoints: initial.knowledgePoints.map((point) => ({
            ...point,
            progress: 'completed',
            interactionStatus: 'completed',
          })),
        },
        resourceVersion: 0,
      },
      0,
    );

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
      reviewProjection: { classroomSummarySourceMessageId: 'message_ai_1' },
    });

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
        commandId: 'command_repeat_summary',
        idempotencyKey: 'command_repeat_summary',
        expectedVersion: undefined,
      },
    );
    await drainObservations('session_1');

    await expect(module.getTeachingState('session_1')).resolves.toMatchObject({
      reviewProjection: { classroomSummarySourceMessageId: 'message_ai_1' },
    });
  });

  it('builds each teaching observation from only the latest completed teaching turn', async () => {
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
      ['message_user_2', 'message_ai_2'],
    ]);
    expect(capturedInteractionObservations.at(-1)?.interactions).toEqual([
      expect.objectContaining({
        interactionId: 'interaction:message_ai_2',
        outcome: 'pending',
      }),
    ]);
  });

  it('degrades invalid derived interaction metadata without blocking the durable transcript', async () => {
    const { module, drainObservations, ledgerRepository, capturedInteractionObservations } =
      await fixture({ observerReturnsInvalidInteraction: true });

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

    await expect(drainObservations('session_1')).resolves.toBeUndefined();
    const ledger = await ledgerRepository.get('session_1');
    expect(ledger?.state.observationStatus).toBe('current');
    expect(ledger?.observations.at(-1)).toMatchObject({
      observerVersion: 'teaching-observer-fallback@1',
      sourceMessageIds: ['message_user_1', 'message_ai_1'],
      entries: [],
      interactions: [],
    });
    expect(capturedInteractionObservations.at(-1)?.observerVersion).toBe(
      'teaching-observer-fallback@1',
    );
  });

  it('replays the latest hidden teaching directive during read reconciliation', async () => {
    const directive: TeachingDirective = {
      schemaVersion: 1,
      lessonPhase: 'comprehensive_application',
      knowledgePoints: [
        { ref: 'knowledge:kp_1', status: 'completed', interactionStatus: 'completed' },
      ],
      comprehensiveCheck: 'learning',
      closureInquiry: 'pending',
      summaryStatus: 'pending',
    };
    const { module, drainObservations, reconcileGeneration, ledgerRepository } = await fixture({
      agentDirective: directive,
    });
    await seedLearningKnowledgePoint(ledgerRepository);
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

    await reconcileGeneration({
      courseId: 'course_1',
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      context: commandContext,
    });

    await expect(module.getTeachingState('session_1')).resolves.toMatchObject({
      lessonPhase: 'comprehensive_application',
      comprehensiveCheck: 'learning',
      knowledgePoints: [{ progress: 'completed', interactionStatus: 'completed' }],
    });
  });

  it.each([
    new Error('teaching_control_protocol_invalid'),
    Object.assign(new Error('invalid persisted directive'), { name: 'ZodError' }),
  ])('does not let an invalid committed control block break read reconciliation', async (error) => {
    const { module, drainObservations, reconcileGeneration } = await fixture({
      agentReadError: error,
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

    await expect(
      reconcileGeneration({
        courseId: 'course_1',
        lessonId: 'lesson_1',
        sessionId: 'session_1',
        context: commandContext,
      }),
    ).resolves.toBeUndefined();
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
    const { recoverSession, sessionModule, messageLog, ledgerRepository } = await fixture();
    await seedLearningKnowledgePoint(ledgerRepository);
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
      expect.objectContaining({
        generationTaskId: 'task_recovered',
        completionStatus: 'complete',
        knowledgePointRef: 'knowledge:kp_1',
      }),
    ]);
  });

  it('invalidates an unreadable completed task and clears its active session binding', async () => {
    const { recoverSession, sessionModule, messageLog } = await fixture({
      agentRecoverError: new Error('teaching_control_protocol_invalid'),
    });
    await sessionModule.execute(
      {
        type: 'AppendUserMessage',
        lessonId: 'lesson_1',
        messageId: 'message_user_1',
        contentArtifactRef: 'artifact:user:1',
      },
      { ...commandContext, commandId: 'invalid_user', expectedVersion: 1 },
    );
    await sessionModule.execute(
      {
        type: 'StartSessionGeneration',
        lessonId: 'lesson_1',
        taskId: 'task_recovered',
        mode: 'recovery',
      },
      { ...commandContext, commandId: 'invalid_generation', expectedVersion: 2 },
    );

    await expect(
      recoverSession({
        courseId: 'course_1',
        lessonId: 'lesson_1',
        sessionId: 'session_1',
        context: commandContext,
      }),
    ).resolves.toBeUndefined();

    const recoveredView = await sessionModule.query(
      { type: 'GetLessonLearning', lessonId: 'lesson_1' },
      {
        correlationId: 'query_invalid_generation',
        actor: 'local-user',
        requestedAt: commandContext.requestedAt,
        receivedAt: commandContext.receivedAt,
      },
    );
    expect(recoveredView.learning.session?.activeGenerationTaskId).toBeUndefined();
    await expect(messageLog.list('session_1')).resolves.toEqual([
      expect.objectContaining({ id: 'message_user_1', role: 'user' }),
    ]);
  });

  it('repairs a legacy completed task with no output before reading the session', async () => {
    const { recoverSession, sessionModule, invalidatedTaskIds } = await fixture({
      recoveredTaskMarkdown: '',
    });
    await sessionModule.execute(
      {
        type: 'AppendUserMessage',
        lessonId: 'lesson_1',
        messageId: 'message_user_1',
        contentArtifactRef: 'artifact:user:1',
      },
      { ...commandContext, commandId: 'empty_user', expectedVersion: 1 },
    );
    await sessionModule.execute(
      {
        type: 'StartSessionGeneration',
        lessonId: 'lesson_1',
        taskId: 'task_recovered',
        mode: 'recovery',
      },
      { ...commandContext, commandId: 'empty_generation', expectedVersion: 2 },
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
        correlationId: 'query_empty_generation',
        actor: 'local-user',
        requestedAt: commandContext.requestedAt,
        receivedAt: commandContext.receivedAt,
      },
    );
    expect(recoveredView.learning.session?.activeGenerationTaskId).toBeUndefined();
    expect(invalidatedTaskIds).toContain('task_recovered');
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
