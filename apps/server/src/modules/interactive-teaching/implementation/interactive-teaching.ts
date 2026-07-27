import { createHash } from 'node:crypto';

import type {
  ApplicationProblem,
  CommandContext,
  TeachingCheckpointSnapshot,
  TeachingObservation,
  TeachingStateSnapshot,
} from '@learning-more/contracts';

import type { UnitOfWork } from '../../../persistence/unit-of-work.js';
import { RepositoryVersionConflictError } from '../../../persistence/repository-errors.js';
import type { GenerationFrameLog } from '../../generation-runtime/interface.js';
import type { LearningSessionModule } from '../../learning-session/interface.js';
import type {
  InteractiveTeaching,
  TeachingTurnAccepted,
  TeachingTurnStopped,
} from '../interface.js';
import type { TeachingAgent } from '../ports/teaching-agent.js';
import type { TeachingDirective } from '../ports/teaching-agent.js';
import type {
  MaterializedTeachingMessage,
  TeachingContextAssembler,
  TeachingContextSources,
} from '../ports/teaching-context-sources.js';
import type { TeachingLedgerRepository } from '../ports/teaching-ledger-repository.js';
import type { TeachingInteractionSink } from '../ports/teaching-interaction-sink.js';
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
  reconcileTeachingObservations,
  reduceTeachingState,
} from './teaching-state-reducer.js';
import {
  applyTeachingDirective,
  normalizeTeachingControlState,
  teachingDirectiveMatchesState,
} from './teaching-directive.js';
import { planTeachingGenerationReconciliation } from './teaching-generation-reconciler.js';

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

function latestTeachingTurn(messages: readonly MaterializedTeachingMessage[]) {
  let assistantIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'assistant') {
      assistantIndex = index;
      break;
    }
  }
  if (assistantIndex < 0) return [];
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      return messages.slice(index, assistantIndex + 1);
    }
  }
  return messages.slice(assistantIndex, assistantIndex + 1);
}

function backgroundContext(context: CommandContext, commandId: string): CommandContext {
  const { expectedVersion: _expectedVersion, ...withoutVersion } = context;
  void _expectedVersion;
  return { ...withoutVersion, commandId, idempotencyKey: commandId };
}

function projectLessonReviewSources(
  previous: TeachingStateSnapshot,
  nextControlState: TeachingStateSnapshot,
  input: Readonly<{
    assistantMessageId?: string;
    assistantMarkdown?: string;
  }>,
): TeachingStateSnapshot {
  const currentProjection = previous.reviewProjection;
  let comprehensiveApplicationStartSourceMessageId =
    currentProjection?.comprehensiveApplicationStartSourceMessageId;
  let comprehensiveSynthesisSourceMessageId =
    currentProjection?.comprehensiveSynthesisSourceMessageId ??
    currentProjection?.methodologyInsight?.sourceMessageId;
  let classroomSummarySourceMessageId = currentProjection?.classroomSummarySourceMessageId;
  let changed = false;

  const nextComprehensive = nextControlState.comprehensiveCheck ?? 'pending';
  if (
    nextControlState.lessonPhase === 'comprehensive_application' &&
    nextComprehensive === 'learning' &&
    input.assistantMessageId !== undefined &&
    comprehensiveApplicationStartSourceMessageId === undefined
  ) {
    comprehensiveApplicationStartSourceMessageId = input.assistantMessageId;
    changed = true;
  }

  if (
    nextControlState.lessonPhase === 'discussion' &&
    (nextComprehensive === 'completed' || nextComprehensive === 'skipped') &&
    input.assistantMessageId !== undefined
  ) {
    if (comprehensiveApplicationStartSourceMessageId === undefined) {
      comprehensiveApplicationStartSourceMessageId = input.assistantMessageId;
      changed = true;
    }
    if (comprehensiveSynthesisSourceMessageId !== input.assistantMessageId) {
      comprehensiveSynthesisSourceMessageId = input.assistantMessageId;
      changed = true;
    }
  }

  if (
    nextControlState.lessonPhase === 'ready_to_close' &&
    nextControlState.summaryStatus === 'delivered' &&
    input.assistantMessageId !== undefined &&
    classroomSummarySourceMessageId === undefined
  ) {
    classroomSummarySourceMessageId = input.assistantMessageId;
    changed = true;
  }

  if (!changed) return nextControlState;
  return {
    ...nextControlState,
    ...(nextControlState === previous ? { ledgerVersion: previous.ledgerVersion + 1 } : {}),
    reviewProjection: {
      ...(currentProjection?.methodologyInsight === undefined
        ? {}
        : { methodologyInsight: currentProjection.methodologyInsight }),
      ...(comprehensiveApplicationStartSourceMessageId === undefined
        ? {}
        : { comprehensiveApplicationStartSourceMessageId }),
      ...(comprehensiveSynthesisSourceMessageId === undefined
        ? {}
        : { comprehensiveSynthesisSourceMessageId }),
      ...(classroomSummarySourceMessageId === undefined ? {} : { classroomSummarySourceMessageId }),
    },
  };
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

function stateSyncFailureProblem(taskId: string): ApplicationProblem {
  return {
    type: 'https://learning-more.local/problems/projection-incomplete',
    status: 503,
    code: 'projection_incomplete',
    messageKey: 'errors.projectionIncomplete',
    retryable: true,
    correlationId: taskId,
    recovery: { action: 'refresh', resourceRef: taskId },
  };
}

function isWarmupFlowViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    [
      'teaching_directive_warmup_changed_knowledge_point',
      'teaching_directive_opening_warmup_required',
      'teaching_warmup_requires_learner_response',
      'teaching_directive_first_point_transition_required',
    ].includes(error.message)
  );
}

export function createInteractiveTeaching(options: {
  sessionModule: LearningSessionModule;
  contextSources: TeachingContextSources;
  contextAssembler: TeachingContextAssembler;
  agent: TeachingAgent;
  observer: TeachingObserver;
  reasoningBehaviorSink?: ReasoningBehaviorSink;
  interactionSink?: TeachingInteractionSink;
  ledgerRepository: TeachingLedgerRepository;
  unitOfWork: UnitOfWork;
  frameLog?: Pick<GenerationFrameLog, 'ensureTask' | 'append'> &
    Partial<Pick<GenerationFrameLog, 'readAfter'>>;
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
  resolveSession?(sessionId: string): Promise<{
    courseId: string;
    lessonId: string;
    sessionId: string;
  }>;
}): {
  module: InteractiveTeaching;
  drainObservations(sessionId: string): Promise<void>;
  reconcileGeneration(input: {
    courseId: string;
    lessonId: string;
    sessionId: string;
    context: CommandContext;
  }): Promise<void>;
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
      knowledgePointRef?: string;
    }>
  >();
  const cancelledTaskIds = new Set<string>();

  function isCurrentTask(taskId: string): boolean {
    return taskContext.has(taskId) && !cancelledTaskIds.has(taskId);
  }

  function assertCurrentTask(taskId: string): void {
    if (!isCurrentTask(taskId)) {
      throw new Error('teaching_generation_superseded');
    }
  }

  async function tryEnsureFrameTask(
    taskId: string,
    state: Parameters<GenerationFrameLog['ensureTask']>[1],
  ): Promise<void> {
    try {
      await options.frameLog?.ensureTask(taskId, state);
    } catch {
      // The session/message aggregate remains authoritative when stream projection is unavailable.
    }
  }

  async function tryAppendFrame(
    taskId: string,
    type: Parameters<GenerationFrameLog['append']>[1],
    data: Parameters<GenerationFrameLog['append']>[2],
  ): Promise<boolean> {
    if (options.frameLog === undefined) return true;
    try {
      await options.frameLog.append(taskId, type, data);
      return true;
    } catch {
      return false;
    }
  }

  async function clearFailedGeneration(input: {
    courseId: string;
    lessonId: string;
    sessionId: string;
    taskId: string;
    context: CommandContext;
    errorCode: string;
    invalidateCompleted: boolean;
  }): Promise<void> {
    try {
      const task = (await options.agent.listTasks(input.sessionId)).find(
        (candidate) => candidate.id === input.taskId,
      );
      if (
        task !== undefined &&
        (task.status === 'queued' ||
          task.status === 'running' ||
          (input.invalidateCompleted && task.status === 'completed'))
      ) {
        try {
          await options.agent.invalidate(input.taskId, input.errorCode);
        } catch {
          await options.agent.cancel(input.taskId);
        }
      }
    } catch {
      // Session cleanup below is still required when task projection repair fails.
    }
    try {
      const latest = await options.sessionModule.query(
        { type: 'GetLessonLearning', lessonId: input.lessonId },
        {
          correlationId: input.context.correlationId,
          actor: input.context.actor,
          requestedAt: input.context.requestedAt,
          receivedAt: input.context.receivedAt,
        },
      );
      if (
        latest.learning.session?.id === input.sessionId &&
        latest.learning.session.activeGenerationTaskId === input.taskId
      ) {
        await options.sessionModule.execute(
          {
            type: 'StopSessionGeneration',
            lessonId: input.lessonId,
            taskId: input.taskId,
          },
          backgroundContext(input.context, `${input.context.commandId}:clear-failed-generation`),
        );
      }
    } catch {
      // Session reads reconcile the durable terminal task/frame state on the next request.
    }
    try {
      await markObservationFailed(input.courseId, input.lessonId, input.sessionId);
    } catch {
      // Observation state is secondary to releasing the generation/session binding.
    }
  }

  async function scheduleGeneration(input: {
    courseId: string;
    lessonId: string;
    sessionId: string;
    context: CommandContext;
    assembled: Awaited<ReturnType<TeachingContextAssembler['assemble']>>;
    expectedVersion: number;
    observe: boolean;
    mode: 'new-turn' | 'retry';
  }): Promise<TeachingTurnAccepted> {
    const currentUserMessageId =
      input.assembled.turnKind !== undefined
        ? undefined
        : input.assembled.recentMessages.findLast(
            (message) => message.role === 'user' && message.completionStatus === 'complete',
          )?.messageId;
    const requestRef =
      currentUserMessageId ??
      `${input.assembled.turnKind === 'continuation' ? 'continuation' : 'opening'}:${input.sessionId}`;
    let messageKnowledgePointRef =
      (input.assembled.teachingState.lessonPhase ?? 'warmup') === 'warmup'
        ? undefined
        : input.assembled.teachingState.activeKnowledgePointRef;
    const accepted = await options.agent.submit(input.assembled, requestRef);
    let startedResourceVersion: number;
    try {
      const latest = await options.sessionModule.query(
        { type: 'GetLessonLearning', lessonId: input.lessonId },
        {
          correlationId: input.context.correlationId,
          actor: input.context.actor,
          requestedAt: input.context.requestedAt,
          receivedAt: input.context.receivedAt,
        },
      );
      if (latest.learning.session?.id !== input.sessionId) {
        throw Object.assign(new Error('teaching_session_identity_mismatch'), {
          code: 'session_conflict',
        });
      }
      if (latest.learning.session.activeGenerationTaskId === accepted.taskId) {
        startedResourceVersion = latest.resourceVersion;
      } else {
        const started = await options.sessionModule.execute(
          {
            type: 'StartSessionGeneration',
            lessonId: input.lessonId,
            taskId: accepted.taskId,
            mode: input.mode,
          },
          {
            ...input.context,
            commandId: `${input.context.commandId}:start-generation`,
            idempotencyKey: `${input.context.idempotencyKey}:start-generation`,
            expectedVersion: latest.resourceVersion,
          },
        );
        startedResourceVersion = started.value.resourceVersion;
      }
      await tryEnsureFrameTask(accepted.taskId, 'running');
    } catch (error) {
      try {
        await options.agent.cancel(accepted.taskId);
      } catch {
        // Startup reconciliation retries compensation for any task that could not be cancelled.
      }
      try {
        const latest = await options.sessionModule.query(
          { type: 'GetLessonLearning', lessonId: input.lessonId },
          {
            correlationId: input.context.correlationId,
            actor: input.context.actor,
            requestedAt: input.context.requestedAt,
            receivedAt: input.context.receivedAt,
          },
        );
        if (latest.learning.session?.activeGenerationTaskId === accepted.taskId) {
          await options.sessionModule.execute(
            {
              type: 'StopSessionGeneration',
              lessonId: input.lessonId,
              taskId: accepted.taskId,
            },
            backgroundContext(input.context, `${input.context.commandId}:compensate-binding`),
          );
        }
      } catch {
        // Startup reconciliation also clears a terminal binding after a process failure.
      }
      await tryAppendFrame(accepted.taskId, 'task.cancelled', {
        reason: 'session_binding_failed',
      });
      throw error;
    }
    taskContext.set(accepted.taskId, {
      courseId: input.courseId,
      lessonId: input.lessonId,
      sessionId: input.sessionId,
      commandContext: input.context,
      ...(messageKnowledgePointRef === undefined
        ? {}
        : { knowledgePointRef: messageKnowledgePointRef }),
    });
    const completion = (async () => {
      let replyCommitted = false;
      const assistantMessageId = options.nextAssistantMessageId();
      const artifactRef = `assistant-message:${assistantMessageId}`;
      let streamedMarkdown = '';
      let completedReplyMarkdown: string | undefined;
      let artifactSave: Promise<void> | undefined;
      let directiveValidated = false;
      let directiveApplied = false;
      let generationTerminalPublished = false;
      let streamProjectionAvailable = true;
      const deferReplyProjection =
        (input.assembled.teachingState.lessonPhase ?? 'warmup') === 'warmup';
      try {
        streamProjectionAvailable = await tryAppendFrame(accepted.taskId, 'message.started', {
          messageId: assistantMessageId,
        });
        const result = await options.agent.complete(accepted.taskId, {
          async onReplyDelta(markdown) {
            if (markdown.length === 0 || !streamProjectionAvailable || deferReplyProjection) {
              return;
            }
            const appended = await tryAppendFrame(accepted.taskId, 'message.delta', {
              messageId: assistantMessageId,
              markdown,
            });
            if (!appended) {
              streamProjectionAvailable = false;
              return;
            }
            streamedMarkdown += markdown;
          },
          onReplyCompleted(markdown) {
            completedReplyMarkdown = markdown;
            artifactSave ??= options.assistantArtifacts.save({
              artifactRef,
              markdown,
              completionStatus: 'complete',
            });
            void artifactSave.catch(() => undefined);
          },
        });
        completedReplyMarkdown = result.markdown;
        // The hidden control block is parsed incrementally so the visible reply can
        // stream, but it is business-validated only after the authoritative task
        // reaches completion. A partial/in-flight projection must never terminate
        // an otherwise healthy provider task.
        const validatedTeachingState = await validateDirective({
          courseId: input.courseId,
          lessonId: input.lessonId,
          sessionId: input.sessionId,
          directive: result.directive,
          baseState: input.assembled.teachingState,
          ...(input.assembled.turnKind === undefined ? {} : { turnKind: input.assembled.turnKind }),
          ...(currentUserMessageId === undefined ? {} : { currentUserMessageId }),
        });
        if (
          (input.assembled.teachingState.lessonPhase ?? 'warmup') === 'warmup' &&
          validatedTeachingState?.lessonPhase === 'knowledge_point'
        ) {
          messageKnowledgePointRef = validatedTeachingState.activeKnowledgePointRef;
        }
        directiveValidated = true;
        assertCurrentTask(accepted.taskId);
        if (!result.markdown.startsWith(streamedMarkdown)) {
          throw new Error('teaching_stream_reply_mismatch');
        }
        const remainingMarkdown = result.markdown.slice(streamedMarkdown.length);
        if (remainingMarkdown.length > 0 && streamProjectionAvailable) {
          const appended = await tryAppendFrame(accepted.taskId, 'message.delta', {
            messageId: assistantMessageId,
            markdown: remainingMarkdown,
          });
          if (appended) streamedMarkdown += remainingMarkdown;
          else streamProjectionAvailable = false;
        }
        assertCurrentTask(accepted.taskId);
        await (artifactSave ??
          options.assistantArtifacts.save({
            artifactRef,
            markdown: result.markdown,
            completionStatus: 'complete',
          }));
        await applyCommittedDirective({
          courseId: input.courseId,
          lessonId: input.lessonId,
          sessionId: input.sessionId,
          directive: result.directive,
          assistantMessageId,
          assistantMarkdown: result.markdown,
          knowledgePointRefs: input.assembled.lesson.coreKnowledgePoints.map((point) => point.ref),
          ...(currentUserMessageId === undefined ? {} : { currentUserMessageId }),
          isCurrent: () => isCurrentTask(accepted.taskId),
        });
        directiveApplied = true;
        assertCurrentTask(accepted.taskId);
        await options.sessionModule.execute(
          {
            type: 'CommitAssistantMessage',
            lessonId: input.lessonId,
            sessionId: input.sessionId,
            messageId: assistantMessageId,
            contentArtifactRef: artifactRef,
            generationTaskId: accepted.taskId,
            ...(messageKnowledgePointRef === undefined
              ? {}
              : { knowledgePointRef: messageKnowledgePointRef }),
            completionStatus: 'complete',
          },
          backgroundContext(input.context, `${input.context.commandId}:assistant-complete`),
        );
        replyCommitted = true;
        taskContext.delete(accepted.taskId);
        await tryAppendFrame(accepted.taskId, 'message.completed', {
          messageId: assistantMessageId,
          contentSha256: sha256(result.markdown),
        });
        await tryAppendFrame(accepted.taskId, 'artifact.ready', {
          artifactId: artifactRef,
          kind: 'assistant-message',
          contentSha256: sha256(result.markdown),
        });
        await tryAppendFrame(accepted.taskId, 'task.completed', {
          resultRef: artifactRef,
        });
        generationTerminalPublished = true;
        if (input.observe) {
          scheduleObservation({
            courseId: input.courseId,
            lessonId: input.lessonId,
            sessionId: input.sessionId,
            context: input.context,
          });
        }
      } catch (error) {
        taskContext.delete(accepted.taskId);
        if (cancelledTaskIds.has(accepted.taskId)) return;
        if (replyCommitted) {
          try {
            await markObservationFailed(input.courseId, input.lessonId, input.sessionId);
          } catch {
            // Preserve the original observation failure; startup recovery still detects stale state.
          }
          if (!generationTerminalPublished) {
            await tryAppendFrame(accepted.taskId, 'task.failed', {
              problem: stateSyncFailureProblem(accepted.taskId),
            });
          }
          throw error;
        }
        const failedReplyMarkdown = completedReplyMarkdown ?? streamedMarkdown;
        const failedReplyStatus = completedReplyMarkdown === undefined ? 'interrupted' : 'complete';
        if (
          failedReplyMarkdown.length > 0 &&
          (!directiveValidated || directiveApplied) &&
          !isWarmupFlowViolation(error)
        ) {
          try {
            await options.assistantArtifacts.save({
              artifactRef,
              markdown: failedReplyMarkdown,
              completionStatus: failedReplyStatus,
            });
            await options.sessionModule.execute(
              {
                type: 'CommitAssistantMessage',
                lessonId: input.lessonId,
                sessionId: input.sessionId,
                messageId: assistantMessageId,
                contentArtifactRef: artifactRef,
                generationTaskId: accepted.taskId,
                ...(messageKnowledgePointRef === undefined
                  ? {}
                  : { knowledgePointRef: messageKnowledgePointRef }),
                completionStatus: failedReplyStatus,
              },
              backgroundContext(input.context, `${input.context.commandId}:assistant-recovered`),
            );
            if (failedReplyStatus === 'complete') {
              await tryAppendFrame(accepted.taskId, 'message.completed', {
                messageId: assistantMessageId,
                contentSha256: sha256(failedReplyMarkdown),
              });
              await tryAppendFrame(accepted.taskId, 'artifact.ready', {
                artifactId: artifactRef,
                kind: 'assistant-message',
                contentSha256: sha256(failedReplyMarkdown),
              });
            }
            try {
              await markObservationFailed(input.courseId, input.lessonId, input.sessionId);
            } catch {
              // Message persistence is independent from the failed ledger projection.
            }
          } catch {
            // Fall back to clearing the active task. The original generation failure stays primary.
          }
        }
        await clearFailedGeneration({
          courseId: input.courseId,
          lessonId: input.lessonId,
          sessionId: input.sessionId,
          taskId: accepted.taskId,
          context: input.context,
          errorCode: directiveValidated ? 'teaching_generation_failed' : 'teaching_output_invalid',
          invalidateCompleted: !directiveValidated,
        });
        await tryAppendFrame(accepted.taskId, 'task.failed', {
          problem:
            failedReplyStatus === 'complete' && !directiveValidated
              ? stateSyncFailureProblem(accepted.taskId)
              : failureProblem(accepted.taskId),
        });
        throw error;
      } finally {
        cancelledTaskIds.delete(accepted.taskId);
      }
    })();
    track(input.sessionId, completion);
    return { taskId: accepted.taskId, resourceVersion: startedResourceVersion };
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

  function scheduleObservation(input: {
    courseId: string;
    lessonId: string;
    sessionId: string;
    context: CommandContext;
  }): void {
    const observation = observationQueue
      .enqueue(input.sessionId, () => observeCompletedTurn(input))
      .catch(async (error: unknown) => {
        try {
          await markObservationFailed(input.courseId, input.lessonId, input.sessionId);
        } catch {
          // Observation recovery is ledger-driven; preserve the original observer failure.
        }
        throw error;
      });
    track(input.sessionId, observation);
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

  async function applyCommittedDirective(input: {
    courseId: string;
    lessonId: string;
    sessionId: string;
    directive?: TeachingDirective | undefined;
    assistantMessageId?: string;
    assistantMarkdown?: string;
    knowledgePointRefs?: readonly string[];
    currentUserMessageId?: string;
    enforceCurrentTurn?: boolean;
    isCurrent?: () => boolean;
  }): Promise<void> {
    if (input.directive === undefined) return;
    if (input.isCurrent?.() === false) throw new Error('teaching_generation_superseded');
    const knowledgePointRefs =
      input.knowledgePointRefs ??
      (
        await options.contextSources.getCourseAndLesson({
          courseId: input.courseId,
          lessonId: input.lessonId,
        })
      ).lesson.coreKnowledgePoints.map((point) => point.ref);
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (input.isCurrent?.() === false) throw new Error('teaching_generation_superseded');
      const current = await options.ledgerRepository.get(input.sessionId);
      if (
        current !== undefined &&
        (current.courseId !== input.courseId || current.lessonId !== input.lessonId)
      ) {
        throw new Error('teaching_ledger_identity_mismatch');
      }
      const base =
        current === undefined
          ? createTeachingState({
              lessonId: input.lessonId,
              sessionId: input.sessionId,
              knowledgePointRefs,
            })
          : alignTeachingState(current.state, knowledgePointRefs);
      const directiveAlreadyApplied = teachingDirectiveMatchesState(
        base,
        input.directive,
        input.currentUserMessageId === undefined
          ? undefined
          : { currentUserMessageId: input.currentUserMessageId },
      );
      const nextControlState = directiveAlreadyApplied
        ? base
        : applyTeachingDirective(
            base,
            input.directive,
            input.currentUserMessageId === undefined
              ? undefined
              : {
                  currentUserMessageId: input.currentUserMessageId,
                  enforceCurrentTurn: input.enforceCurrentTurn ?? true,
                },
          );
      const nextState = projectLessonReviewSources(base, nextControlState, input);
      if (directiveAlreadyApplied && nextState === base) {
        return;
      }
      try {
        await options.unitOfWork.execute({ transactionId: options.nextTransactionId() }, (tx) => {
          if (input.isCurrent?.() === false) {
            throw new Error('teaching_generation_superseded');
          }
          return options.ledgerRepository.save(
            tx,
            {
              courseId: input.courseId,
              lessonId: input.lessonId,
              sessionId: input.sessionId,
              observations: current?.observations ?? [],
              checkpoints: current?.checkpoints ?? [],
              state: nextState,
              resourceVersion: current?.resourceVersion ?? 0,
            },
            current?.resourceVersion ?? 0,
          );
        });
        return;
      } catch (error) {
        if (!(error instanceof RepositoryVersionConflictError) || attempt === maxAttempts) {
          throw error;
        }
      }
    }
  }

  async function reconcileLatestCommittedDirective(input: {
    courseId: string;
    lessonId: string;
    sessionId: string;
    messages: Awaited<ReturnType<TeachingContextSources['listMessages']>>;
    tasks: Awaited<ReturnType<TeachingAgent['listTasks']>>;
  }): Promise<void> {
    const latestAssistantIndex = input.messages.findLastIndex(
      (message) =>
        message.role === 'assistant' &&
        message.completionStatus === 'complete' &&
        message.generationTaskId !== undefined,
    );
    if (latestAssistantIndex < 0) return;
    const latestAssistant = input.messages[latestAssistantIndex];
    const taskId = latestAssistant?.generationTaskId;
    if (taskId === undefined) return;
    const task = input.tasks.find((candidate) => candidate.id === taskId);
    if (task?.status !== 'completed') return;
    const currentUserMessageId = input.messages
      .slice(0, latestAssistantIndex)
      .findLast((message) => message.role === 'user')?.messageId;
    let result: Awaited<ReturnType<TeachingAgent['read']>>;
    try {
      result = await options.agent.read(taskId);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === 'teaching_control_protocol_invalid' || error.name === 'ZodError')
      ) {
        return;
      }
      throw error;
    }
    if (result?.directive === undefined) return;
    try {
      await applyCommittedDirective({
        courseId: input.courseId,
        lessonId: input.lessonId,
        sessionId: input.sessionId,
        directive: result.directive,
        assistantMarkdown: result.markdown,
        ...(latestAssistant?.messageId === undefined
          ? {}
          : { assistantMessageId: latestAssistant.messageId }),
        ...(currentUserMessageId === undefined ? {} : { currentUserMessageId }),
        enforceCurrentTurn: false,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === 'teaching_directive_phase_regression' ||
          error.message === 'teaching_directive_completed_point_regression' ||
          error.message === 'teaching_directive_learning_point_regression' ||
          error.message === 'teaching_directive_comprehensive_regression')
      ) {
        return;
      }
      throw error;
    }
  }

  async function validateDirective(input: {
    courseId: string;
    lessonId: string;
    sessionId: string;
    directive?: TeachingDirective | undefined;
    baseState?: TeachingCheckpointSnapshot['teachingState'];
    currentUserMessageId?: string;
    turnKind?: 'opening' | 'response' | 'continuation';
  }): Promise<TeachingStateSnapshot | undefined> {
    if (input.directive === undefined) return;
    const base =
      input.baseState ?? (await initialState(input.courseId, input.lessonId, input.sessionId));
    const next = applyTeachingDirective(
      base,
      input.directive,
      input.currentUserMessageId === undefined
        ? undefined
        : { currentUserMessageId: input.currentUserMessageId },
    );
    if ((base.lessonPhase ?? 'warmup') !== 'warmup') return next;
    if (input.turnKind === 'opening') {
      if (next.lessonPhase !== 'warmup' || next.turnHandoff !== 'invite_response') {
        throw new Error('teaching_directive_opening_warmup_required');
      }
      return next;
    }
    if (input.currentUserMessageId === undefined) {
      throw new Error('teaching_warmup_requires_learner_response');
    }
    const firstKnowledgePointRef = base.knowledgePoints[0]?.ref;
    const firstKnowledgePoint = next.knowledgePoints.find(
      (point) => point.ref === firstKnowledgePointRef,
    );
    if (
      firstKnowledgePointRef === undefined ||
      next.lessonPhase !== 'knowledge_point' ||
      next.activeKnowledgePointRef !== firstKnowledgePointRef ||
      firstKnowledgePoint?.progress !== 'learning'
    ) {
      throw new Error('teaching_directive_first_point_transition_required');
    }
    return next;
  }

  async function reconcileGeneration(input: {
    courseId: string;
    lessonId: string;
    sessionId: string;
    context: CommandContext;
    recoverRunning?: boolean;
  }): Promise<Awaited<ReturnType<TeachingContextSources['listMessages']>>> {
    const queryLearning = () =>
      options.sessionModule.query(
        { type: 'GetLessonLearning', lessonId: input.lessonId },
        {
          correlationId: input.context.correlationId,
          actor: input.context.actor,
          requestedAt: input.context.requestedAt,
          receivedAt: input.context.receivedAt,
        },
      );
    let learning = await queryLearning();
    if (learning.learning.session?.id !== input.sessionId) {
      throw Object.assign(new Error('teaching_session_identity_mismatch'), {
        code: 'session_conflict',
      });
    }
    let messages = await options.contextSources.listMessages(input.sessionId);
    let tasks = await options.agent.listTasks(input.sessionId);
    const activeTaskId = learning.learning.session.activeGenerationTaskId;
    const activeTask = tasks.find((task) => task.id === activeTaskId);
    if (
      activeTaskId !== undefined &&
      activeTask !== undefined &&
      (activeTask.status === 'queued' || activeTask.status === 'running') &&
      options.frameLog?.readAfter !== undefined
    ) {
      try {
        const terminalFrame = await options.frameLog.readAfter(
          activeTaskId,
          Number.MAX_SAFE_INTEGER,
        );
        if (
          terminalFrame.meta.state === 'failed' ||
          terminalFrame.meta.state === 'cancelled' ||
          terminalFrame.meta.state === 'timeout'
        ) {
          await clearFailedGeneration({
            courseId: input.courseId,
            lessonId: input.lessonId,
            sessionId: input.sessionId,
            taskId: activeTaskId,
            context: input.context,
            errorCode: `teaching_frame_${terminalFrame.meta.state}`,
            invalidateCompleted: false,
          });
          learning = await queryLearning();
          tasks = await options.agent.listTasks(input.sessionId);
        }
      } catch {
        // A missing stream projection is not a task failure; entity reconciliation continues below.
      }
    }
    const committedTaskIds = new Set(
      messages.flatMap((message) =>
        message.role === 'assistant' && message.generationTaskId !== undefined
          ? [message.generationTaskId]
          : [],
      ),
    );
    const emptyCompletedTaskIds = tasks
      .filter(
        (task) =>
          task.status === 'completed' &&
          !committedTaskIds.has(task.id) &&
          (task.draftMarkdown?.trim().length ?? 0) === 0,
      )
      .map((task) => task.id);
    for (const taskId of emptyCompletedTaskIds) {
      try {
        await options.agent.invalidate(taskId, 'provider_empty_output');
        await tryAppendFrame(taskId, 'task.failed', {
          problem: failureProblem(taskId),
        });
      } catch {
        // The reconciliation planner still refuses to bind an empty completed result.
      }
    }
    if (emptyCompletedTaskIds.length > 0) {
      tasks = await options.agent.listTasks(input.sessionId);
    }
    await reconcileLatestCommittedDirective({
      courseId: input.courseId,
      lessonId: input.lessonId,
      sessionId: input.sessionId,
      messages,
      tasks,
    });
    const reconciledActiveTaskId = learning.learning.session?.activeGenerationTaskId;
    let plan = planTeachingGenerationReconciliation({
      sessionId: input.sessionId,
      ...(reconciledActiveTaskId === undefined ? {} : { activeTaskId: reconciledActiveTaskId }),
      tasks,
      messages,
    });

    for (const taskId of plan.cancelTaskIds) {
      try {
        await options.agent.cancel(taskId);
        await tryEnsureFrameTask(taskId, 'cancelled');
        await tryAppendFrame(taskId, 'task.cancelled', {
          reason: 'superseded_or_stale_teaching_generation',
        });
      } catch {
        // A later reconciliation attempt repeats cancellation from durable task state.
      }
    }

    if (plan.clearActiveTask && reconciledActiveTaskId !== undefined) {
      await options.sessionModule.execute(
        {
          type: 'StopSessionGeneration',
          lessonId: input.lessonId,
          taskId: reconciledActiveTaskId,
        },
        backgroundContext(input.context, `reconcile-clear:${reconciledActiveTaskId}`),
      );
      learning = await queryLearning();
    }

    if (plan.taskId === undefined || taskContext.has(plan.taskId)) return messages;
    const plannedTask = tasks.find((task) => task.id === plan.taskId);
    if (
      input.recoverRunning === false &&
      (plannedTask?.status === 'queued' || plannedTask?.status === 'running')
    ) {
      return messages;
    }
    const recoveringTaskId = plan.taskId;
    if (plan.bindTask) {
      if (learning.learning.session?.activeGenerationTaskId !== undefined) return messages;
      const bound = await options.sessionModule.execute(
        {
          type: 'StartSessionGeneration',
          lessonId: input.lessonId,
          taskId: recoveringTaskId,
          mode: 'recovery',
        },
        {
          ...backgroundContext(input.context, `reconcile-bind:${recoveringTaskId}`),
          expectedVersion: learning.resourceVersion,
        },
      );
      learning = await queryLearning();
      if (
        bound.value.sessionId !== input.sessionId ||
        learning.learning.session?.activeGenerationTaskId !== recoveringTaskId
      ) {
        throw Object.assign(new Error('teaching_recovery_binding_failed'), {
          code: 'session_conflict',
        });
      }
    }

    await tryEnsureFrameTask(recoveringTaskId, 'running');
    let recovered: Awaited<ReturnType<TeachingAgent['recover']>>;
    try {
      recovered = await options.agent.recover(recoveringTaskId);
    } catch (error) {
      if (plannedTask?.status !== 'completed') throw error;
      await options.agent.invalidate(recoveringTaskId, 'teaching_output_invalid');
      learning = await queryLearning();
      if (learning.learning.session?.activeGenerationTaskId === recoveringTaskId) {
        await options.sessionModule.execute(
          { type: 'StopSessionGeneration', lessonId: input.lessonId, taskId: recoveringTaskId },
          backgroundContext(input.context, `recover-invalid:${recoveringTaskId}`),
        );
      }
      await tryAppendFrame(recoveringTaskId, 'task.failed', {
        problem: failureProblem(recoveringTaskId),
      });
      return options.contextSources.listMessages(input.sessionId);
    }
    if (recovered.completionStatus === 'failed') {
      learning = await queryLearning();
      if (learning.learning.session?.activeGenerationTaskId === recoveringTaskId) {
        await options.sessionModule.execute(
          { type: 'StopSessionGeneration', lessonId: input.lessonId, taskId: recoveringTaskId },
          backgroundContext(input.context, `recover-failed:${recoveringTaskId}`),
        );
      }
      await tryAppendFrame(recoveringTaskId, 'task.failed', {
        problem: failureProblem(recoveringTaskId),
      });
      return options.contextSources.listMessages(input.sessionId);
    }

    messages = await options.contextSources.listMessages(input.sessionId);
    const alreadyCommitted = messages.find(
      (message) => message.role === 'assistant' && message.generationTaskId === recoveringTaskId,
    );
    const currentUserMessageId = plan.sourceMessageId?.startsWith('opening:')
      ? undefined
      : plan.sourceMessageId;
    if (alreadyCommitted !== undefined) {
      await applyCommittedDirective({
        courseId: input.courseId,
        lessonId: input.lessonId,
        sessionId: input.sessionId,
        directive: recovered.directive,
        assistantMessageId: alreadyCommitted.messageId,
        assistantMarkdown: recovered.markdown,
        ...(currentUserMessageId === undefined ? {} : { currentUserMessageId }),
      });
      learning = await queryLearning();
      if (learning.learning.session?.activeGenerationTaskId === recoveringTaskId) {
        await options.sessionModule.execute(
          { type: 'StopSessionGeneration', lessonId: input.lessonId, taskId: recoveringTaskId },
          backgroundContext(input.context, `recover-clear-committed:${recoveringTaskId}`),
        );
      }
      return messages;
    }

    tasks = await options.agent.listTasks(input.sessionId);
    learning = await queryLearning();
    messages = await options.contextSources.listMessages(input.sessionId);
    plan = planTeachingGenerationReconciliation({
      sessionId: input.sessionId,
      ...(learning.learning.session?.activeGenerationTaskId === undefined
        ? {}
        : { activeTaskId: learning.learning.session.activeGenerationTaskId }),
      tasks,
      messages,
    });
    if (
      plan.taskId !== recoveringTaskId ||
      learning.learning.session?.activeGenerationTaskId !== recoveringTaskId
    ) {
      if (learning.learning.session?.activeGenerationTaskId === recoveringTaskId) {
        await options.sessionModule.execute(
          { type: 'StopSessionGeneration', lessonId: input.lessonId, taskId: recoveringTaskId },
          backgroundContext(input.context, `recover-source-changed:${recoveringTaskId}`),
        );
      }
      return messages;
    }

    const sourceMessageId = plan.sourceMessageId?.startsWith('opening:')
      ? undefined
      : plan.sourceMessageId;
    const recoveredKnowledgePointRef = (await options.ledgerRepository.get(input.sessionId))?.state
      .activeKnowledgePointRef;
    await validateDirective({
      courseId: input.courseId,
      lessonId: input.lessonId,
      sessionId: input.sessionId,
      directive: recovered.directive,
      ...(sourceMessageId === undefined ? {} : { currentUserMessageId: sourceMessageId }),
    });
    const assistantMessageId = options.nextAssistantMessageId();
    const artifactRef = `assistant-message:${assistantMessageId}`;
    await tryAppendFrame(recoveringTaskId, 'message.started', {
      messageId: assistantMessageId,
    });
    if (recovered.markdown.length > 0) {
      await tryAppendFrame(recoveringTaskId, 'message.delta', {
        messageId: assistantMessageId,
        markdown: recovered.markdown,
      });
    }
    await options.assistantArtifacts.save({
      artifactRef,
      markdown: recovered.markdown,
      completionStatus: recovered.completionStatus,
    });
    await applyCommittedDirective({
      courseId: input.courseId,
      lessonId: input.lessonId,
      sessionId: input.sessionId,
      directive: recovered.directive,
      assistantMessageId,
      assistantMarkdown: recovered.markdown,
      ...(sourceMessageId === undefined ? {} : { currentUserMessageId: sourceMessageId }),
    });
    await options.sessionModule.execute(
      {
        type: 'CommitAssistantMessage',
        lessonId: input.lessonId,
        sessionId: input.sessionId,
        messageId: assistantMessageId,
        contentArtifactRef: artifactRef,
        generationTaskId: recoveringTaskId,
        ...(recoveredKnowledgePointRef === undefined
          ? {}
          : { knowledgePointRef: recoveredKnowledgePointRef }),
        completionStatus: recovered.completionStatus,
      },
      backgroundContext(input.context, `recover-assistant:${recoveringTaskId}`),
    );
    await tryAppendFrame(recoveringTaskId, 'message.completed', {
      messageId: assistantMessageId,
      contentSha256: sha256(recovered.markdown),
    });
    await tryAppendFrame(recoveringTaskId, 'artifact.ready', {
      artifactId: artifactRef,
      kind: 'assistant-message',
      contentSha256: sha256(recovered.markdown),
    });
    await tryAppendFrame(
      recoveringTaskId,
      recovered.completionStatus === 'complete' ? 'task.completed' : 'task.cancelled',
      recovered.completionStatus === 'complete'
        ? { resultRef: artifactRef }
        : { reason: 'recovered_interrupted_generation' },
    );
    return options.contextSources.listMessages(input.sessionId);
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
    const messages = latestTeachingTurn(allMessages);
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
    const allCourseRelationRefs = [
      ...facts.course.lessonMap.map((lesson) => topicRef(lesson.title)),
      ...facts.course.lessonMap.map((lesson) => `lesson:${lesson.lessonId}`),
    ];
    const observationRelations = facts.course.lessonMap.filter(
      (lesson) => lesson.relation === 'current' || lesson.relation === 'prerequisite',
    );
    const courseRelationRefs = [
      ...observationRelations.map((lesson) => topicRef(lesson.title)),
      ...observationRelations.map((lesson) => `lesson:${lesson.lessonId}`),
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
      courseRelationRefs: allCourseRelationRefs,
      existingEntryRefs:
        current?.observations
          .filter((candidate) => candidate.status === 'active')
          .flatMap((candidate) => candidate.entries.map((entry) => entry.entryId)) ?? [],
      messages: messages.map((message) => ({
        messageId: message.messageId,
        role: message.role,
        completionStatus: message.completionStatus,
      })),
    };
    let validated: TeachingObservation;
    try {
      validated = validateTeachingObservation(observation, validationContext);
    } catch (error) {
      const validationError =
        error instanceof Error && error.message.trim() !== ''
          ? error.message.slice(0, 160)
          : 'observation_contract_invalid';
      validated = validateTeachingObservation(
        {
          observationId: `observation_fallback_${sha256(`${input.sessionId}:${sourceSnapshotHash}`).slice(0, 32)}`,
          schemaVersion: 1,
          lessonId: input.lessonId,
          sessionId: input.sessionId,
          turnSequence: (current?.observations.length ?? 0) + 1,
          sourceMessageIds: messages.map((message) => message.messageId),
          sourceSnapshotHash,
          scope: {
            alignment: 'direct',
            relationRefs: [`lesson:${input.lessonId}`],
            rationale: `Derived observer metadata was discarded (${validationError}); the durable transcript remains authoritative.`,
          },
          entries: [],
          interactions: [],
          observerVersion: 'teaching-observer-fallback@1',
          observedAt: options.now().toISOString(),
          status: 'active',
        } satisfies TeachingObservation,
        validationContext,
      );
    }
    const duplicate = current?.observations.find(
      (candidate) =>
        candidate.sourceSnapshotHash === validated.sourceSnapshotHash &&
        candidate.observerVersion === validated.observerVersion,
    );
    const nextState = reduceTeachingState(previousState, validated);
    const observations =
      duplicate === undefined
        ? [...(current?.observations ?? []), validated]
        : (current?.observations ?? []);
    await options.unitOfWork.execute({ transactionId: options.nextTransactionId() }, (tx) =>
      options.ledgerRepository.save(
        tx,
        {
          courseId: input.courseId,
          lessonId: input.lessonId,
          sessionId: input.sessionId,
          observations,
          checkpoints: current?.checkpoints ?? [],
          state: nextState,
          resourceVersion: current?.resourceVersion ?? 0,
        },
        current?.resourceVersion ?? 0,
      ),
    );
    if (duplicate === undefined) {
      await options.reasoningBehaviorSink?.captureFromObservation({
        courseId: input.courseId,
        courseMode: facts.course.courseMode,
        observation: validated,
      });
    }
    await options.interactionSink?.captureFromObservation({
      courseId: input.courseId,
      lessonId: input.lessonId,
      sessionId: input.sessionId,
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

  async function reconcileObservationHistory(sessionId: string) {
    const current = await options.ledgerRepository.get(sessionId);
    if (current === undefined) return undefined;
    const messages = await options.contextSources.listMessages(sessionId);
    const reconciled = reconcileTeachingObservations(
      current.state,
      current.observations,
      new Set(messages.map((message) => message.messageId)),
    );
    if (!reconciled.changed) return current;
    await options.unitOfWork.execute({ transactionId: options.nextTransactionId() }, (tx) =>
      options.ledgerRepository.save(
        tx,
        {
          ...current,
          observations: reconciled.observations,
          state: reconciled.state,
        },
        current.resourceVersion,
      ),
    );
    return options.ledgerRepository.get(sessionId);
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
        mode: 'new-turn',
      });
    },
    async continueTurn(input, context) {
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
      if (
        learning.learning.session?.id !== input.sessionId ||
        learning.learning.session.state !== 'active'
      ) {
        throw Object.assign(new Error('teaching_session_not_active'), {
          code: 'session_conflict',
        });
      }
      while ((background.get(input.sessionId)?.size ?? 0) > 0) {
        await Promise.all([...(background.get(input.sessionId) ?? [])]);
      }
      await observationQueue.drain(input.sessionId);
      const state = await initialState(input.courseId, input.lessonId, input.sessionId);
      if (state.turnHandoff !== 'offer_continue' || state.lessonPhase === 'ready_to_close') {
        throw Object.assign(new Error('teaching_continuation_not_offered'), {
          code: 'session_conflict',
        });
      }
      const messages = await options.contextSources.listMessages(input.sessionId);
      const latest = messages.at(-1);
      if (latest?.role !== 'assistant' || latest.completionStatus !== 'complete') {
        throw Object.assign(new Error('teaching_continuation_anchor_missing'), {
          code: 'session_conflict',
        });
      }
      const assembled = await options.contextAssembler.assemble({
        courseId: input.courseId,
        lessonId: input.lessonId,
        sessionId: input.sessionId,
        turnKind: 'continuation',
        teachingState: state,
        unobservedMessageIds: [],
      });
      return scheduleGeneration({
        ...input,
        context,
        assembled,
        expectedVersion: learning.resourceVersion,
        observe: false,
        mode: 'new-turn',
      });
    },
    async reviseTurn(input, context) {
      let learning = await options.sessionModule.query(
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
        await module.stopTurn(
          {
            sessionId: input.sessionId,
            taskId: activeTaskId,
            disposition: 'discard',
          },
          { ...context, expectedVersion: learning.resourceVersion },
        );
        learning = await options.sessionModule.query(
          { type: 'GetLessonLearning', lessonId: input.lessonId },
          {
            correlationId: context.correlationId,
            actor: context.actor,
            requestedAt: context.requestedAt,
            receivedAt: context.receivedAt,
          },
        );
      }
      const messages = await options.contextSources.listMessages(input.sessionId);
      const replacedIndex = messages.findIndex(
        (message) => message.messageId === input.replacedUserMessageId,
      );
      const replacedTail = replacedIndex < 0 ? [] : messages.slice(replacedIndex);
      if (
        replacedTail.length === 0 ||
        replacedTail[0]?.role !== 'user' ||
        replacedTail.slice(1).some((message) => message.role === 'user')
      ) {
        throw Object.assign(new Error('teaching_turn_not_revisable'), {
          code: 'session_conflict',
        });
      }
      const replaced = await options.sessionModule.execute(
        {
          type: 'ReplacePendingUserTurn',
          lessonId: input.lessonId,
          replacedMessageIds: replacedTail.map((message) => message.messageId),
          messageId: input.userMessageId,
          contentArtifactRef: input.userContentArtifactRef,
        },
        {
          ...context,
          commandId: `${context.commandId}:replace-turn`,
          idempotencyKey: `${context.idempotencyKey}:replace-turn`,
          expectedVersion: learning.resourceVersion,
        },
      );
      await reconcileObservationHistory(input.sessionId);
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
        expectedVersion: replaced.value.resourceVersion,
        observe: true,
        mode: 'new-turn',
      });
    },
    async retryTurn(input, context) {
      const reconciledMessages = await reconcileGeneration({ ...input, context });
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
      const messages = reconciledMessages;
      const lastUser = messages.findLast((message) => message.role === 'user');
      const lastUserIndex = lastUser === undefined ? -1 : messages.indexOf(lastUser);
      const recoveredAssistant = messages
        .slice(lastUserIndex + 1)
        .findLast(
          (message) =>
            message.role === 'assistant' &&
            message.completionStatus === 'complete' &&
            message.generationTaskId !== undefined,
        );
      if (lastUser !== undefined && recoveredAssistant?.generationTaskId !== undefined) {
        return {
          taskId: recoveredAssistant.generationTaskId,
          resourceVersion: learning.resourceVersion,
        };
      }
      if (
        lastUser === undefined ||
        messages
          .slice(lastUserIndex + 1)
          .some(
            (message) => message.role === 'assistant' && message.completionStatus === 'complete',
          )
      ) {
        throw Object.assign(new Error('teaching_turn_not_retryable'), {
          code: 'session_conflict',
        });
      }
      const state = await markObservationPending(input.courseId, input.lessonId, input.sessionId);
      const assembled = await options.contextAssembler.assemble({
        courseId: input.courseId,
        lessonId: input.lessonId,
        sessionId: input.sessionId,
        currentUserMessageId: lastUser.messageId,
        teachingState: state,
        unobservedMessageIds: [lastUser.messageId],
      });
      return scheduleGeneration({
        ...input,
        context,
        assembled,
        expectedVersion: learning.resourceVersion,
        observe: true,
        mode: 'retry',
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
        mode: 'new-turn',
      });
    },
    async stopTurn(input, context): Promise<TeachingTurnStopped> {
      let owner = taskContext.get(input.taskId);
      if (owner === undefined) {
        const durableTask = (await options.agent.listTasks(input.sessionId)).find(
          (task) => task.id === input.taskId,
        );
        const resolved = await options.resolveSession?.(input.sessionId);
        if (durableTask === undefined || resolved === undefined) {
          throw new Error('teaching_task_not_found');
        }
        const learning = await options.sessionModule.query(
          { type: 'GetLessonLearning', lessonId: resolved.lessonId },
          {
            correlationId: context.correlationId,
            actor: context.actor,
            requestedAt: context.requestedAt,
            receivedAt: context.receivedAt,
          },
        );
        if (
          learning.learning.session?.id !== input.sessionId ||
          learning.learning.session.activeGenerationTaskId !== input.taskId
        ) {
          throw new Error('teaching_task_not_found');
        }
        owner = {
          courseId: resolved.courseId,
          lessonId: resolved.lessonId,
          sessionId: resolved.sessionId,
          commandContext: context,
        };
      }
      if (owner.sessionId !== input.sessionId) throw new Error('teaching_task_not_found');
      cancelledTaskIds.add(input.taskId);
      taskContext.delete(input.taskId);
      const stopping = options.agent.stop(input.taskId);
      if (input.disposition === 'discard') {
        let stopped;
        try {
          stopped = await options.sessionModule.execute(
            {
              type: 'StopSessionGeneration',
              lessonId: owner.lessonId,
              taskId: input.taskId,
            },
            backgroundContext(context, `${context.commandId}:generation-discarded`),
          );
        } finally {
          // Revising a user turn only needs the durable generation binding removed.
          // Provider shutdown is best-effort cleanup; cancelledTaskIds prevents a late
          // completion from committing after the replacement turn has already started.
          void stopping.catch(() => undefined);
        }
        await tryAppendFrame(input.taskId, 'task.cancelled', {
          reason: 'user_revised_source_message',
        });
        return {
          taskId: input.taskId,
          completionStatus: 'interrupted',
          resourceVersion: stopped.value.resourceVersion,
        };
      }
      const result = await stopping;
      const assistantMessageId = options.nextAssistantMessageId();
      const artifactRef = `assistant-message:${assistantMessageId}`;
      const stoppedKnowledgePointRef =
        owner.knowledgePointRef ??
        (await options.ledgerRepository.get(owner.sessionId))?.state.activeKnowledgePointRef;
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
          ...(stoppedKnowledgePointRef === undefined
            ? {}
            : { knowledgePointRef: stoppedKnowledgePointRef }),
          completionStatus: 'interrupted',
        },
        backgroundContext(context, `${context.commandId}:assistant-interrupted`),
      );
      await tryAppendFrame(input.taskId, 'task.cancelled', {
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
      return normalizeTeachingControlState(record.state);
    },
    async freezeCheckpoint(input) {
      const record = await reconcileObservationHistory(input.sessionId);
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
    async reconcileGeneration(input) {
      await reconcileGeneration({ ...input, recoverRunning: false });
    },
    async recoverSession(input) {
      const messages = await reconcileGeneration(input);
      if (messages.length === 0 || !messages.some((message) => message.role === 'user')) return;
      const latestMessage = messages.at(-1);
      if (latestMessage?.role !== 'assistant' || latestMessage.completionStatus !== 'complete') {
        await markObservationFailed(input.courseId, input.lessonId, input.sessionId);
        await recoverEvidenceEffect(input);
        return;
      }
      let ledger = await options.ledgerRepository.get(input.sessionId);
      const observedThrough = ledger?.state.observedThroughMessageId;
      const lastMessage = messages.at(-1)?.messageId;
      const interactionBackfillRequired = ledger?.observations.some(
        (observation) => observation.status === 'active' && observation.interactions === undefined,
      );
      if (
        ledger === undefined ||
        ledger.state.observationStatus !== 'current' ||
        observedThrough !== lastMessage ||
        interactionBackfillRequired === true
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
      if (options.interactionSink !== undefined && ledger !== undefined) {
        for (const observation of ledger.observations) {
          if (observation.status !== 'active') continue;
          await options.interactionSink.captureFromObservation({
            courseId: input.courseId,
            lessonId: input.lessonId,
            sessionId: input.sessionId,
            observation,
          });
        }
      }
      await recoverEvidenceEffect(input);
    },
  };
}
