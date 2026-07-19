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
import type { TeachingDirective } from '../ports/teaching-agent.js';
import type {
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
  interactionSink?: TeachingInteractionSink;
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
      input.assembled.turnKind === 'opening'
        ? undefined
        : input.assembled.recentMessages.findLast(
            (message) => message.role === 'user' && message.completionStatus === 'complete',
          )?.messageId;
    const requestRef = currentUserMessageId ?? `opening:${input.sessionId}`;
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
    });
    const completion = (async () => {
      let replyCommitted = false;
      const assistantMessageId = options.nextAssistantMessageId();
      const artifactRef = `assistant-message:${assistantMessageId}`;
      let streamedMarkdown = '';
      let streamProjectionAvailable = true;
      let directiveValidated = false;
      try {
        streamProjectionAvailable = await tryAppendFrame(accepted.taskId, 'message.started', {
          messageId: assistantMessageId,
        });
        const result = await options.agent.complete(accepted.taskId, {
          async onDirective(directive) {
            await validateDirective({
              courseId: input.courseId,
              lessonId: input.lessonId,
              sessionId: input.sessionId,
              directive,
              baseState: input.assembled.teachingState,
              ...(currentUserMessageId === undefined ? {} : { currentUserMessageId }),
            });
            directiveValidated = true;
          },
          async onReplyDelta(markdown) {
            if (markdown.length === 0 || !streamProjectionAvailable) return;
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
        });
        if (!directiveValidated) {
          await validateDirective({
            courseId: input.courseId,
            lessonId: input.lessonId,
            sessionId: input.sessionId,
            directive: result.directive,
            baseState: input.assembled.teachingState,
            ...(currentUserMessageId === undefined ? {} : { currentUserMessageId }),
          });
        }
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
        await applyCommittedDirective({
          courseId: input.courseId,
          lessonId: input.lessonId,
          sessionId: input.sessionId,
          directive: result.directive,
          ...(currentUserMessageId === undefined ? {} : { currentUserMessageId }),
        });
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
            {
              type: 'StopSessionGeneration',
              lessonId: input.lessonId,
              taskId: accepted.taskId,
            },
            backgroundContext(input.context, `${input.context.commandId}:assistant-failed`),
          );
        } catch {
          // The terminal stream event must still be emitted if session cleanup needs recovery.
        }
        await tryAppendFrame(accepted.taskId, 'task.failed', {
          problem: failureProblem(accepted.taskId),
        });
        throw error;
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
    currentUserMessageId?: string;
  }): Promise<void> {
    if (input.directive === undefined) return;
    const current = await options.ledgerRepository.get(input.sessionId);
    const base = await initialState(input.courseId, input.lessonId, input.sessionId);
    if (teachingDirectiveMatchesState(base, input.directive)) return;
    const nextState = applyTeachingDirective(
      base,
      input.directive,
      input.currentUserMessageId === undefined
        ? undefined
        : { currentUserMessageId: input.currentUserMessageId },
    );
    await options.unitOfWork.execute({ transactionId: options.nextTransactionId() }, (tx) =>
      options.ledgerRepository.save(
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
      ),
    );
  }

  async function validateDirective(input: {
    courseId: string;
    lessonId: string;
    sessionId: string;
    directive?: TeachingDirective | undefined;
    baseState?: TeachingCheckpointSnapshot['teachingState'];
    currentUserMessageId?: string;
  }): Promise<void> {
    if (input.directive === undefined) return;
    const base =
      input.baseState ?? (await initialState(input.courseId, input.lessonId, input.sessionId));
    applyTeachingDirective(
      base,
      input.directive,
      input.currentUserMessageId === undefined
        ? undefined
        : { currentUserMessageId: input.currentUserMessageId },
    );
  }

  async function reconcileGeneration(input: {
    courseId: string;
    lessonId: string;
    sessionId: string;
    context: CommandContext;
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
    let plan = planTeachingGenerationReconciliation({
      sessionId: input.sessionId,
      ...(learning.learning.session.activeGenerationTaskId === undefined
        ? {}
        : { activeTaskId: learning.learning.session.activeGenerationTaskId }),
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

    if (plan.clearActiveTask && learning.learning.session.activeGenerationTaskId !== undefined) {
      await options.sessionModule.execute(
        {
          type: 'StopSessionGeneration',
          lessonId: input.lessonId,
          taskId: learning.learning.session.activeGenerationTaskId,
        },
        backgroundContext(
          input.context,
          `reconcile-clear:${learning.learning.session.activeGenerationTaskId}`,
        ),
      );
      learning = await queryLearning();
    }

    if (plan.taskId === undefined || taskContext.has(plan.taskId)) return messages;
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
    const recovered = await options.agent.recover(recoveringTaskId);
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
    await options.sessionModule.execute(
      {
        type: 'CommitAssistantMessage',
        lessonId: input.lessonId,
        sessionId: input.sessionId,
        messageId: assistantMessageId,
        contentArtifactRef: artifactRef,
        generationTaskId: recoveringTaskId,
        completionStatus: recovered.completionStatus,
      },
      backgroundContext(input.context, `recover-assistant:${recoveringTaskId}`),
    );
    await applyCommittedDirective({
      courseId: input.courseId,
      lessonId: input.lessonId,
      sessionId: input.sessionId,
      directive: recovered.directive,
      ...(sourceMessageId === undefined ? {} : { currentUserMessageId: sourceMessageId }),
    });
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
    const interactionBackfillRequired = current?.observations.some(
      (observation) => observation.status === 'active' && observation.interactions === undefined,
    );
    const observedThroughIndex =
      interactionBackfillRequired === true || previousState.observedThroughMessageId === undefined
        ? -1
        : allMessages.findIndex(
            (message) => message.messageId === previousState.observedThroughMessageId,
          );
    const messages =
      observedThroughIndex < 0 ? allMessages : allMessages.slice(observedThroughIndex);
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
          { sessionId: input.sessionId, taskId: activeTaskId },
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
        replacedTail
          .slice(1)
          .some((message) => message.role === 'user' || message.completionStatus === 'complete')
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
      const messages = await reconcileGeneration(input);
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index]!;
        if (
          message.role !== 'assistant' ||
          message.completionStatus !== 'complete' ||
          message.generationTaskId === undefined
        ) {
          continue;
        }
        try {
          const result = await options.agent.read(message.generationTaskId);
          if (result?.directive === undefined) continue;
          await applyCommittedDirective({
            courseId: input.courseId,
            lessonId: input.lessonId,
            sessionId: input.sessionId,
            directive: result.directive,
          });
          break;
        } catch {
          // Older or unavailable generation tasks do not prevent observation recovery.
        }
      }
      if (messages.length === 0 || !messages.some((message) => message.role === 'user')) return;
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
