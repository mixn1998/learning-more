import { createHash } from 'node:crypto';

import type {
  ApplicationProblem,
  CommandContext,
  TeachingCheckpointSnapshot,
  TeachingObservation,
} from '@learning-more/contracts';

import type { UnitOfWork } from '../../../persistence/unit-of-work.js';
import type { GenerationFrameLog } from '../../generation-runtime/interface.js';
import type { LearningSessionModule } from '../../learning-session/interface.js';
import type {
  InteractiveTeaching,
  TeachingTurnAccepted,
  TeachingTurnStopped,
} from '../interface.js';
import type { TeachingAgent } from '../ports/teaching-agent.js';
import type {
  TeachingContextAssembler,
  TeachingContextSources,
} from '../ports/teaching-context-sources.js';
import type { TeachingLedgerRepository } from '../ports/teaching-ledger-repository.js';
import type { TeachingObserver } from '../ports/teaching-observer.js';
import type { ReasoningBehaviorSink } from '../ports/reasoning-behavior-sink.js';
import { createObservationQueue } from './observation-queue.js';
import { teachingObservationLens } from './teaching-observation-lens.js';
import {
  validateTeachingObservation,
  type TeachingObservationValidationContext,
} from './teaching-observation-validator.js';
import {
  alignTeachingState,
  createTeachingState,
  reduceTeachingState,
} from './teaching-state-reducer.js';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function topicRef(title: string): string {
  const slug = title
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-|-$/gu, '');
  return `course-topic:${slug.length === 0 ? sha256(title).slice(0, 12) : slug}`;
}

function backgroundContext(context: CommandContext, commandId: string): CommandContext {
  const { expectedVersion: _expectedVersion, ...withoutVersion } = context;
  void _expectedVersion;
  return { ...withoutVersion, commandId, idempotencyKey: commandId };
}

function failureProblem(taskId: string): ApplicationProblem {
  return {
    type: 'https://learning-more.local/problems/internal-error',
    status: 500,
    code: 'internal_error',
    messageKey: 'errors.internalError',
    retryable: true,
    correlationId: taskId,
    recovery: { action: 'retry', resourceRef: taskId },
  };
}

export function createInteractiveTeaching(options: {
  sessionModule: LearningSessionModule;
  contextSources: TeachingContextSources;
  contextAssembler: TeachingContextAssembler;
  agent: TeachingAgent;
  observer: TeachingObserver;
  reasoningBehaviorSink?: ReasoningBehaviorSink;
  ledgerRepository: TeachingLedgerRepository;
  unitOfWork: UnitOfWork;
  frameLog?: Pick<GenerationFrameLog, 'ensureTask' | 'append'>;
  assistantArtifacts: {
    save(input: {
      artifactRef: string;
      markdown: string;
      completionStatus: 'complete' | 'interrupted';
    }): Promise<void>;
  };
  nextAssistantMessageId(): string;
  nextCheckpointId(): string;
  nextTransactionId(): string;
  now(): Date;
}): {
  module: InteractiveTeaching;
  drainObservations(sessionId: string): Promise<void>;
  recoverSession(input: {
    courseId: string;
    lessonId: string;
    sessionId: string;
    context: CommandContext;
  }): Promise<void>;
} {
  const observationQueue = createObservationQueue();
  const background = new Map<string, Set<Promise<unknown>>>();
  const taskContext = new Map<
    string,
    Readonly<{
      courseId: string;
      lessonId: string;
      sessionId: string;
      commandContext: CommandContext;
    }>
  >();

  async function scheduleGeneration(input: {
    courseId: string;
    lessonId: string;
    sessionId: string;
    context: CommandContext;
    assembled: Awaited<ReturnType<TeachingContextAssembler['assemble']>>;
    expectedVersion: number;
    observe: boolean;
  }): Promise<TeachingTurnAccepted> {
    const accepted = await options.agent.submit(input.assembled);
    const started = await options.sessionModule.execute(
      { type: 'StartSessionGeneration', lessonId: input.lessonId, taskId: accepted.taskId },
      {
        ...input.context,
        commandId: `${input.context.commandId}:start-generation`,
        idempotencyKey: `${input.context.idempotencyKey}:start-generation`,
        expectedVersion: input.expectedVersion,
      },
    );
    await options.frameLog?.ensureTask(accepted.taskId, 'running');
    taskContext.set(accepted.taskId, {
      courseId: input.courseId,
      lessonId: input.lessonId,
      sessionId: input.sessionId,
      commandContext: input.context,
    });
    const completion = (async () => {
      let replyCommitted = false;
      try {
        const result = await options.agent.complete(accepted.taskId);
        const assistantMessageId = options.nextAssistantMessageId();
        const artifactRef = `assistant-message:${assistantMessageId}`;
        await options.frameLog?.append(accepted.taskId, 'message.started', {
          messageId: assistantMessageId,
        });
        if (result.markdown.length > 0) {
          await options.frameLog?.append(accepted.taskId, 'message.delta', {
            messageId: assistantMessageId,
            markdown: result.markdown,
          });
        }
        await options.assistantArtifacts.save({
          artifactRef,
          markdown: result.markdown,
          completionStatus: 'complete',
        });
        await options.sessionModule.execute(
          {
            type: 'CommitAssistantMessage',
            lessonId: input.lessonId,
            sessionId: input.sessionId,
            messageId: assistantMessageId,
            contentArtifactRef: artifactRef,
            generationTaskId: accepted.taskId,
            completionStatus: 'complete',
          },
          backgroundContext(input.context, `${input.context.commandId}:assistant-complete`),
        );
        replyCommitted = true;
        taskContext.delete(accepted.taskId);
        await options.frameLog?.append(accepted.taskId, 'message.completed', {
          messageId: assistantMessageId,
          contentSha256: sha256(result.markdown),
        });
        await options.frameLog?.append(accepted.taskId, 'artifact.ready', {
          artifactId: artifactRef,
          kind: 'assistant-message',
          contentSha256: sha256(result.markdown),
        });
        await options.frameLog?.append(accepted.taskId, 'task.completed', {
          resultRef: artifactRef,
        });
        if (input.observe) {
          await observationQueue.enqueue(input.sessionId, () =>
            observeCompletedTurn({
              courseId: input.courseId,
              lessonId: input.lessonId,
              sessionId: input.sessionId,
              context: input.context,
            }),
          );
        }
      } catch (error) {
        taskContext.delete(accepted.taskId);
        if (replyCommitted) {
          try {
            await markObservationFailed(input.courseId, input.lessonId, input.sessionId);
          } catch {
            // Preserve the original observation failure; startup recovery still detects stale state.
          }
          throw error;
        }
        try {
          await options.sessionModule.execute(
            { type: 'StopSessionGeneration', lessonId: input.lessonId },
            backgroundContext(input.context, `${input.context.commandId}:assistant-failed`),
          );
        } catch {
          // The terminal stream event must still be emitted if session cleanup needs recovery.
        }
        await options.frameLog?.append(accepted.taskId, 'task.failed', {
          problem: failureProblem(accepted.taskId),
        });
        throw error;
      }
    })();
    track(input.sessionId, completion);
    return { taskId: accepted.taskId, resourceVersion: started.value.resourceVersion };
  }

  function track(sessionId: string, promise: Promise<unknown>): void {
    const tasks = background.get(sessionId) ?? new Set<Promise<unknown>>();
    tasks.add(promise);
    background.set(sessionId, tasks);
    void promise.then(
      () => {
        tasks.delete(promise);
        if (tasks.size === 0) background.delete(sessionId);
      },
      () => {
        tasks.delete(promise);
        if (tasks.size === 0) background.delete(sessionId);
      },
    );
  }

  async function initialState(courseId: string, lessonId: string, sessionId: string) {
    const facts = await options.contextSources.getCourseAndLesson({ courseId, lessonId });
    const knowledgePointRefs = facts.lesson.coreKnowledgePoints.map((point) => point.ref);
    const current = await options.ledgerRepository.get(sessionId);
    if (current !== undefined) {
      if (current.courseId !== courseId || current.lessonId !== lessonId) {
        throw new Error('teaching_ledger_identity_mismatch');
      }
      return alignTeachingState(current.state, knowledgePointRefs);
    }
    return createTeachingState({
      lessonId,
      sessionId,
      knowledgePointRefs,
    });
  }

  async function observeCompletedTurn(input: {
    courseId: string;
    lessonId: string;
    sessionId: string;
    context: CommandContext;
  }): Promise<void> {
    const current = await options.ledgerRepository.get(input.sessionId);
    const facts = await options.contextSources.getCourseAndLesson({
      courseId: input.courseId,
      lessonId: input.lessonId,
    });
    const previousState =
      current === undefined
        ? await initialState(input.courseId, input.lessonId, input.sessionId)
        : alignTeachingState(
            current.state,
            facts.lesson.coreKnowledgePoints.map((point) => point.ref),
          );
    const allMessages = await options.contextSources.listMessages(input.sessionId);
    const observedIndex =
      previousState.observedThroughMessageId === undefined
        ? -1
        : allMessages.findIndex(
            (message) => message.messageId === previousState.observedThroughMessageId,
          );
    const messages = allMessages.slice(observedIndex + 1);
    if (messages.length === 0) return;
    const sourceSnapshotHash = sha256(
      JSON.stringify(
        messages.map((message) => ({
          messageId: message.messageId,
          role: message.role,
          completionStatus: message.completionStatus,
          markdown: message.markdown,
        })),
      ),
    );
    const courseRelationRefs = [
      ...facts.course.lessonMap.map((lesson) => topicRef(lesson.title)),
      ...facts.course.lessonMap.map((lesson) => `lesson:${lesson.lessonId}`),
    ];
    const observation = await options.observer.observe({
      lessonId: input.lessonId,
      sessionId: input.sessionId,
      turnSequence: (current?.observations.length ?? 0) + 1,
      sourceSnapshotHash,
      knowledgePointRefs: facts.lesson.coreKnowledgePoints.map((point) => point.ref),
      courseRelationRefs,
      observationLens: teachingObservationLens(facts.course.courseMode),
      previousState,
      messages,
    });
    const validationContext: TeachingObservationValidationContext = {
      lessonId: input.lessonId,
      sessionId: input.sessionId,
      sourceSnapshotHash,
      knowledgePointRefs: facts.lesson.coreKnowledgePoints.map((point) => point.ref),
      courseRelationRefs,
      openEntryRefs: [
        ...previousState.openLoops.map((loop) => loop.entryId),
        ...previousState.explorationBranches.map((branch) => branch.entryId),
      ],
      messages: messages.map((message) => ({
        messageId: message.messageId,
        role: message.role,
        completionStatus: message.completionStatus,
      })),
    };
    const validated = validateTeachingObservation(observation, validationContext);
    const duplicate = current?.observations.find(
      (candidate) =>
        candidate.sourceSnapshotHash === validated.sourceSnapshotHash &&
        candidate.observerVersion === validated.observerVersion,
    );
    if (duplicate !== undefined) return;
    const nextState = reduceTeachingState(previousState, validated);
    await options.unitOfWork.execute({ transactionId: options.nextTransactionId() }, (tx) =>
      options.ledgerRepository.save(
        tx,
        {
          courseId: input.courseId,
          lessonId: input.lessonId,
          sessionId: input.sessionId,
          observations: [...(current?.observations ?? []), validated],
          checkpoints: current?.checkpoints ?? [],
          state: nextState,
          resourceVersion: current?.resourceVersion ?? 0,
        },
        current?.resourceVersion ?? 0,
      ),
    );
    await options.reasoningBehaviorSink?.captureFromObservation({
      courseId: input.courseId,
      courseMode: facts.course.courseMode,
      observation: validated,
    });
    if (!previousState.evidenceCheckpoint && nextState.evidenceCheckpoint) {
      await options.sessionModule.execute(
        { type: 'EstablishEvidenceCheckpoint', lessonId: input.lessonId },
        backgroundContext(input.context, `evidence_${validated.observationId}`),
      );
    }
  }

  async function markObservationPending(courseId: string, lessonId: string, sessionId: string) {
    const current = await options.ledgerRepository.get(sessionId);
    const facts = await options.contextSources.getCourseAndLesson({ courseId, lessonId });
    const state =
      current === undefined
        ? await initialState(courseId, lessonId, sessionId)
        : alignTeachingState(
            current.state,
            facts.lesson.coreKnowledgePoints.map((point) => point.ref),
          );
    if (state.observationStatus === 'pending') return state;
    const pendingState = { ...state, observationStatus: 'pending' as const };
    await options.unitOfWork.execute({ transactionId: options.nextTransactionId() }, (tx) =>
      options.ledgerRepository.save(
        tx,
        {
          courseId,
          lessonId,
          sessionId,
          observations: current?.observations ?? [],
          checkpoints: current?.checkpoints ?? [],
          state: pendingState,
          resourceVersion: current?.resourceVersion ?? 0,
        },
        current?.resourceVersion ?? 0,
      ),
    );
    return pendingState;
  }

  async function markObservationFailed(courseId: string, lessonId: string, sessionId: string) {
    const current = await options.ledgerRepository.get(sessionId);
    if (current === undefined || current.state.observationStatus !== 'pending') return;
    const failedState = { ...current.state, observationStatus: 'failed' as const };
    await options.unitOfWork.execute({ transactionId: options.nextTransactionId() }, (tx) =>
      options.ledgerRepository.save(
        tx,
        {
          ...current,
          courseId,
          lessonId,
          state: failedState,
        },
        current.resourceVersion,
      ),
    );
  }

  async function recoverEvidenceEffect(input: {
    lessonId: string;
    sessionId: string;
    context: CommandContext;
  }): Promise<void> {
    const ledger = await options.ledgerRepository.get(input.sessionId);
    if (ledger?.state.evidenceCheckpoint !== true) return;
    const session = await options.sessionModule.query(
      { type: 'GetLessonLearning', lessonId: input.lessonId },
      {
        correlationId: input.context.correlationId,
        actor: input.context.actor,
        requestedAt: input.context.requestedAt,
        receivedAt: input.context.receivedAt,
      },
    );
    if (session.learning.session?.evidenceCheckpoint === true) return;
    await options.sessionModule.execute(
      { type: 'EstablishEvidenceCheckpoint', lessonId: input.lessonId },
      backgroundContext(input.context, `recover-evidence:${input.sessionId}`),
    );
  }

  const module: InteractiveTeaching = {
    async advanceTurn(input, context) {
      const appended = await options.sessionModule.execute(
        {
          type: 'AppendUserMessage',
          lessonId: input.lessonId,
          messageId: input.userMessageId,
          contentArtifactRef: input.userContentArtifactRef,
        },
        context,
      );
      const state = await markObservationPending(input.courseId, input.lessonId, input.sessionId);
      const assembled = await options.contextAssembler.assemble({
        courseId: input.courseId,
        lessonId: input.lessonId,
        sessionId: input.sessionId,
        currentUserMessageId: input.userMessageId,
        teachingState: state,
        unobservedMessageIds: [input.userMessageId],
      });
      return scheduleGeneration({
        ...input,
        context,
        assembled,
        expectedVersion: appended.value.resourceVersion,
        observe: true,
      });
    },
    async openLesson(input, context) {
      const learning = await options.sessionModule.query(
        { type: 'GetLessonLearning', lessonId: input.lessonId },
        {
          correlationId: context.correlationId,
          actor: context.actor,
          requestedAt: context.requestedAt,
          receivedAt: context.receivedAt,
        },
      );
      const activeTaskId = learning.learning.session?.activeGenerationTaskId;
      if (activeTaskId !== undefined) {
        return { taskId: activeTaskId, resourceVersion: learning.resourceVersion };
      }
      const messages = await options.contextSources.listMessages(input.sessionId);
      if (messages.length > 0) throw new Error('teaching_opening_already_completed');
      const state = await initialState(input.courseId, input.lessonId, input.sessionId);
      const assembled = await options.contextAssembler.assemble({
        courseId: input.courseId,
        lessonId: input.lessonId,
        sessionId: input.sessionId,
        turnKind: 'opening',
        teachingState: state,
        unobservedMessageIds: [],
      });
      return scheduleGeneration({
        ...input,
        context,
        assembled,
        expectedVersion: learning.resourceVersion,
        observe: false,
      });
    },
    async stopTurn(input, context): Promise<TeachingTurnStopped> {
      const owner = taskContext.get(input.taskId);
      if (owner === undefined || owner.sessionId !== input.sessionId) {
        throw new Error('teaching_task_not_found');
      }
      const result = await options.agent.stop(input.taskId);
      taskContext.delete(input.taskId);
      const assistantMessageId = options.nextAssistantMessageId();
      const artifactRef = `assistant-message:${assistantMessageId}`;
      await options.assistantArtifacts.save({
        artifactRef,
        markdown: result.markdown,
        completionStatus: 'interrupted',
      });
      const committed = await options.sessionModule.execute(
        {
          type: 'CommitAssistantMessage',
          lessonId: owner.lessonId,
          sessionId: owner.sessionId,
          messageId: assistantMessageId,
          contentArtifactRef: artifactRef,
          generationTaskId: input.taskId,
          completionStatus: 'interrupted',
        },
        backgroundContext(context, `${context.commandId}:assistant-interrupted`),
      );
      await options.frameLog?.append(input.taskId, 'task.cancelled', {
        reason: 'user_requested',
      });
      return {
        taskId: input.taskId,
        assistantMessageId,
        draftArtifactRef: artifactRef,
        completionStatus: 'interrupted',
        resourceVersion: committed.value.resourceVersion,
      };
    },
    async getTeachingState(sessionId) {
      const record = await options.ledgerRepository.get(sessionId);
      if (record === undefined) throw new Error('teaching_state_not_found');
      return record.state;
    },
    async freezeCheckpoint(input) {
      const record = await options.ledgerRepository.get(input.sessionId);
      if (record === undefined) throw new Error('teaching_state_not_found');
      const completeness = record.state.observationStatus;
      const activeObservations = record.observations.filter(
        (observation: TeachingObservation) => observation.status === 'active',
      );
      const observationRefs = activeObservations.map(
        (observation: TeachingObservation) => `observation:${observation.observationId}`,
      );
      const sourceMessageIds = [
        ...new Set(activeObservations.flatMap((observation) => observation.sourceMessageIds)),
      ];
      const existing = record.checkpoints.find(
        (candidate) =>
          candidate.reason === input.reason &&
          candidate.sourceSnapshotHash === record.state.sourceSnapshotHash &&
          candidate.observationCompleteness ===
            (completeness === 'current' ? 'complete' : completeness) &&
          JSON.stringify(candidate.observationRefs) === JSON.stringify(observationRefs) &&
          JSON.stringify(candidate.sourceMessageIds) === JSON.stringify(sourceMessageIds),
      );
      if (existing !== undefined) return existing;
      const checkpoint: TeachingCheckpointSnapshot = {
        checkpointId: options.nextCheckpointId(),
        reason: input.reason,
        lessonId: record.lessonId,
        sessionId: record.sessionId,
        teachingState: record.state,
        observationRefs,
        sourceMessageIds,
        sourceSnapshotHash: record.state.sourceSnapshotHash,
        observationCompleteness: completeness === 'current' ? 'complete' : completeness,
        retentionDecision:
          completeness === 'current' && !record.state.evidenceCheckpoint
            ? 'discardable'
            : 'preserve',
        frozenAt: options.now().toISOString(),
      };
      await options.unitOfWork.execute({ transactionId: options.nextTransactionId() }, (tx) =>
        options.ledgerRepository.save(
          tx,
          {
            ...record,
            checkpoints: [...record.checkpoints, checkpoint],
          },
          record.resourceVersion,
        ),
      );
      return checkpoint;
    },
  };

  return {
    module,
    async drainObservations(sessionId) {
      while (true) {
        const tasks = [...(background.get(sessionId) ?? [])];
        if (tasks.length === 0) break;
        await Promise.all(tasks);
      }
      await observationQueue.drain(sessionId);
    },
    async recoverSession(input) {
      const learning = await options.sessionModule.query(
        { type: 'GetLessonLearning', lessonId: input.lessonId },
        {
          correlationId: input.context.correlationId,
          actor: input.context.actor,
          requestedAt: input.context.requestedAt,
          receivedAt: input.context.receivedAt,
        },
      );
      const activeTaskId = learning.learning.session?.activeGenerationTaskId;
      if (activeTaskId !== undefined) {
        const recovered = await options.agent.recover(activeTaskId);
        if (recovered.completionStatus === 'failed') {
          await options.sessionModule.execute(
            { type: 'StopSessionGeneration', lessonId: input.lessonId },
            backgroundContext(input.context, `recover-failed:${activeTaskId}`),
          );
          await options.frameLog?.append(activeTaskId, 'task.failed', {
            problem: failureProblem(activeTaskId),
          });
        } else {
          const assistantMessageId = options.nextAssistantMessageId();
          const artifactRef = `assistant-message:${assistantMessageId}`;
          await options.frameLog?.ensureTask(activeTaskId, 'running');
          await options.frameLog?.append(activeTaskId, 'message.started', {
            messageId: assistantMessageId,
          });
          if (recovered.markdown.length > 0) {
            await options.frameLog?.append(activeTaskId, 'message.delta', {
              messageId: assistantMessageId,
              markdown: recovered.markdown,
            });
          }
          await options.assistantArtifacts.save({
            artifactRef,
            markdown: recovered.markdown,
            completionStatus: recovered.completionStatus,
          });
          await options.sessionModule.execute(
            {
              type: 'CommitAssistantMessage',
              lessonId: input.lessonId,
              sessionId: input.sessionId,
              messageId: assistantMessageId,
              contentArtifactRef: artifactRef,
              generationTaskId: activeTaskId,
              completionStatus: recovered.completionStatus,
            },
            backgroundContext(input.context, `recover-assistant:${activeTaskId}`),
          );
          await options.frameLog?.append(activeTaskId, 'message.completed', {
            messageId: assistantMessageId,
            contentSha256: sha256(recovered.markdown),
          });
          await options.frameLog?.append(activeTaskId, 'artifact.ready', {
            artifactId: artifactRef,
            kind: 'assistant-message',
            contentSha256: sha256(recovered.markdown),
          });
          if (recovered.completionStatus === 'complete') {
            await options.frameLog?.append(activeTaskId, 'task.completed', {
              resultRef: artifactRef,
            });
          } else {
            await options.frameLog?.append(activeTaskId, 'task.cancelled', {
              reason: 'recovered_interrupted_generation',
            });
          }
        }
      }

      const messages = await options.contextSources.listMessages(input.sessionId);
      if (messages.length === 0 || !messages.some((message) => message.role === 'user')) return;
      let ledger = await options.ledgerRepository.get(input.sessionId);
      const observedThrough = ledger?.state.observedThroughMessageId;
      const lastMessage = messages.at(-1)?.messageId;
      if (
        ledger === undefined ||
        ledger.state.observationStatus !== 'current' ||
        observedThrough !== lastMessage
      ) {
        await markObservationPending(input.courseId, input.lessonId, input.sessionId);
        await observationQueue.enqueue(input.sessionId, () => observeCompletedTurn(input));
        ledger = await options.ledgerRepository.get(input.sessionId);
      }
      if (options.reasoningBehaviorSink !== undefined && ledger !== undefined) {
        const facts = await options.contextSources.getCourseAndLesson({
          courseId: input.courseId,
          lessonId: input.lessonId,
        });
        for (const observation of ledger.observations) {
          if (observation.status !== 'active') continue;
          await options.reasoningBehaviorSink.captureFromObservation({
            courseId: input.courseId,
            courseMode: facts.course.courseMode,
            observation,
          });
        }
      }
      await recoverEvidenceEffect(input);
    },
  };
}
