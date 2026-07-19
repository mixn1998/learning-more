import { randomUUID } from 'node:crypto';

import type { CommandResult } from '@learning-more/contracts';

import type { LearningSessionRepositories } from '../../../persistence/learning-session-repositories.js';
import type { LearningSessionRecord } from '../../../persistence/learning-session-repositories.js';
import { RepositoryVersionConflictError } from '../../../persistence/repository-errors.js';
import type { TransactionContext, UnitOfWork } from '../../../persistence/unit-of-work.js';
import type {
  LearningSessionCommand,
  LearningSessionModule,
  LearningSessionResult,
} from '../interface.js';
import type { LearningSessionCommand as DomainCommand } from '../model/commands.js';
import type { LearningSessionEvent } from '../model/events.js';
import {
  createLessonLearning,
  decide,
  evolveAll,
  LearningSessionError,
} from '../model/learning-session.js';
import type { MessageLog } from './message-log.js';
import {
  actualLearningSeconds,
  closeLearningIntervals,
  openLearningInterval,
} from './time-intervals.js';
import {
  acquireSessionWriteLease,
  ownsWriteLease,
  transferSessionWriteLease,
} from './session-write-lease.js';

function domainCommand(command: LearningSessionCommand, sessionId?: string): DomainCommand {
  if (command.type === 'StartLesson') {
    if (sessionId === undefined) throw new Error('SESSION_ID_REQUIRED');
    return { type: 'start', sessionId };
  }
  if (command.type === 'PauseLesson') return { type: 'pause' };
  if (command.type === 'ResumeLesson') return { type: 'resume' };
  if (command.type === 'TransferSessionLease') {
    throw new Error('TRANSFER_HANDLED_BY_MODULE');
  }
  if (command.type === 'AppendUserMessage') {
    return {
      type: 'appendUserMessage',
      messageId: command.messageId,
    };
  }
  if (command.type === 'ReplacePendingUserTurn') {
    return {
      type: 'replacePendingUserTurn',
      replacedMessageIds: command.replacedMessageIds,
      messageId: command.messageId,
    };
  }
  if (command.type === 'CommitAssistantMessage') {
    return {
      type: 'commitAssistantMessage',
      sessionId: command.sessionId,
      generationTaskId: command.generationTaskId,
      messageId: command.messageId,
    };
  }
  if (command.type === 'EstablishEvidenceCheckpoint') {
    return { type: 'establishEvidenceCheckpoint' };
  }
  if (command.type === 'StartSessionGeneration') {
    return { type: 'startGeneration', taskId: command.taskId, mode: command.mode };
  }
  if (command.type === 'StopSessionGeneration') return { type: 'stopGeneration' };
  if (command.type === 'AbandonLesson') return { type: 'abandon' };
  if (command.type === 'RestoreLesson') return { type: 'restore' };
  if (command.type === 'CommitStageReview') {
    return { type: 'commitStageReview', reviewId: command.reviewId };
  }
  if (command.type === 'CompleteLessonPendingReview') return { type: 'completePendingReview' };
  return { type: 'commitFinalReview', reviewId: command.reviewId };
}

export function createSessionModule(options: {
  readonly repositories: LearningSessionRepositories;
  readonly messageLog: MessageLog;
  readonly unitOfWork: UnitOfWork;
  readonly instanceId: string;
  readonly nextSessionId: () => string;
  readonly nextIntervalId: () => string;
  readonly nextLeaseToken: () => string;
  readonly now: () => Date;
  readonly assertLessonWritable?: (lessonId: string) => Promise<void>;
  readonly assertLessonStartable?: (lessonId: string) => Promise<void>;
  readonly recordEvents?: (
    tx: TransactionContext,
    events: readonly LearningSessionEvent[],
    record: LearningSessionRecord,
  ) => Promise<void>;
}): LearningSessionModule {
  class WriteLeaseLostError extends Error {
    readonly code = 'write_lease_lost';
  }
  return {
    async execute(command, context) {
      const current = await options.repositories.get(command.lessonId);
      const now = options.now();
      const pageInstanceId = context.pageInstanceId;
      if (pageInstanceId === undefined) throw new LearningSessionError('session_not_writable');
      if (
        command.type !== 'StartLesson' &&
        command.type !== 'TransferSessionLease' &&
        current !== undefined &&
        !ownsWriteLease(current.writeLease, pageInstanceId)
      ) {
        throw new WriteLeaseLostError();
      }
      if (
        command.type !== 'StartLesson' &&
        current !== undefined &&
        context.expectedVersion !== undefined &&
        context.expectedVersion !== current.resourceVersion
      ) {
        throw new RepositoryVersionConflictError(current.resourceVersion);
      }

      if (command.type === 'StartLesson' && current !== undefined) {
        await options.unitOfWork.execute(
          { transactionId: `tx_learning_guard_${randomUUID()}` },
          async () => options.assertLessonWritable?.(command.lessonId),
        );
        const acquired = acquireSessionWriteLease(current.writeLease, {
          pageInstanceId,
          instanceId: options.instanceId,
          token: options.nextLeaseToken(),
          now,
        });
        const value: LearningSessionResult = {
          lessonId: current.lessonId,
          progress: current.learning.progress,
          ...(current.learning.session === undefined
            ? {}
            : { sessionId: current.learning.session.id }),
          resourceVersion: current.resourceVersion,
          writable: acquired.writable,
          ...(acquired.writable ? { leaseToken: acquired.lease.token } : {}),
        };
        return { commandId: context.commandId, outcome: 'completed', value };
      }

      if (command.type === 'TransferSessionLease') {
        if (current?.writeLease === undefined || current.learning.session === undefined) {
          throw new LearningSessionError('session_not_writable');
        }
        const lease = transferSessionWriteLease(current.writeLease, {
          pageInstanceId,
          instanceId: options.instanceId,
          token: options.nextLeaseToken(),
          now,
        });
        let intervals = closeLearningIntervals(current.intervals, now, 'lease_lost');
        if (
          current.learning.session.state === 'active' &&
          current.learning.session.activeGenerationTaskId === undefined
        ) {
          intervals = openLearningInterval(intervals, {
            id: options.nextIntervalId(),
            sessionId: current.learning.session.id,
            now,
          });
        }
        await options.unitOfWork.execute(
          { transactionId: `tx_learning_${randomUUID()}` },
          async (tx) => {
            await options.assertLessonWritable?.(command.lessonId);
            await options.repositories.save(
              tx,
              { ...current, writeLease: lease, intervals },
              current.resourceVersion,
            );
          },
        );
        const resourceVersion = current.resourceVersion + 1;
        return {
          commandId: context.commandId,
          outcome: 'completed',
          resourceVersion,
          value: {
            lessonId: command.lessonId,
            progress: current.learning.progress,
            sessionId: current.learning.session.id,
            resourceVersion,
            writable: true,
            leaseToken: lease.token,
          },
        };
      }

      const sessionId = command.type === 'StartLesson' ? options.nextSessionId() : undefined;
      const base =
        current ??
        ({
          lessonId: command.lessonId,
          learning: createLessonLearning(command.lessonId),
          intervals: [],
          resourceVersion: 0,
        } as const);
      const events = decide(base.learning, domainCommand(command, sessionId), context.commandId);
      const learning = evolveAll(base.learning, events);
      let intervals = base.intervals;
      let writeLease = base.writeLease;
      if (command.type === 'StartLesson' && learning.session !== undefined) {
        const acquired = acquireSessionWriteLease(undefined, {
          pageInstanceId,
          instanceId: options.instanceId,
          token: options.nextLeaseToken(),
          now,
        });
        writeLease = acquired.lease;
        intervals = openLearningInterval(intervals, {
          id: options.nextIntervalId(),
          sessionId: learning.session.id,
          now,
        });
      } else if (command.type === 'PauseLesson') {
        intervals = closeLearningIntervals(intervals, now, 'paused');
      } else if (
        command.type === 'ResumeLesson' &&
        learning.session !== undefined &&
        learning.session.activeGenerationTaskId === undefined
      ) {
        intervals = openLearningInterval(intervals, {
          id: options.nextIntervalId(),
          sessionId: learning.session.id,
          now,
        });
      } else if (command.type === 'StartSessionGeneration') {
        intervals = closeLearningIntervals(intervals, now, 'ai_generation');
      } else if (
        (command.type === 'CommitAssistantMessage' || command.type === 'StopSessionGeneration') &&
        learning.session?.state === 'active' &&
        learning.session.activeGenerationTaskId === undefined
      ) {
        intervals = openLearningInterval(intervals, {
          id: options.nextIntervalId(),
          sessionId: learning.session.id,
          now,
        });
      } else if (command.type === 'AbandonLesson') {
        intervals =
          learning.session === undefined ? [] : closeLearningIntervals(intervals, now, 'abandoned');
      } else if (
        command.type === 'RestoreLesson' &&
        learning.session !== undefined &&
        learning.session.activeGenerationTaskId === undefined
      ) {
        intervals = openLearningInterval(intervals, {
          id: options.nextIntervalId(),
          sessionId: learning.session.id,
          now,
        });
      } else if (command.type === 'CompleteLessonPendingReview') {
        intervals = closeLearningIntervals(intervals, now, 'completed');
      }
      const stored = {
        ...base,
        learning,
        intervals,
        ...(writeLease === undefined ? {} : { writeLease }),
        ...(command.type === 'CommitFinalReview'
          ? {
              finalReview: {
                id: command.reviewId,
                artifactRef: command.artifactRef,
                contentSha256: command.contentSha256,
                sourceSessionIds: command.sourceSessionIds,
                messageRangeChecksum: command.messageRangeChecksum,
                committedAt: now.toISOString(),
                ...(command.document === undefined ? {} : { document: command.document }),
              },
            }
          : {}),
      };
      await options.unitOfWork.execute(
        { transactionId: `tx_learning_${randomUUID()}` },
        async (tx) => {
          if (command.type === 'StartLesson' && current === undefined) {
            await options.assertLessonStartable?.(command.lessonId);
          } else {
            await options.assertLessonWritable?.(command.lessonId);
          }
          if (
            events.length > 0 &&
            learning.session !== undefined &&
            (command.type === 'AppendUserMessage' || command.type === 'CommitAssistantMessage')
          ) {
            await options.messageLog.stageAppend(tx, learning.session.id, {
              id: command.messageId,
              role: command.type === 'AppendUserMessage' ? 'user' : 'assistant',
              createdAt: now.toISOString(),
              contentArtifactRef: command.contentArtifactRef,
              ...(command.type === 'CommitAssistantMessage'
                ? { generationTaskId: command.generationTaskId }
                : {}),
              completionStatus:
                command.type === 'CommitAssistantMessage'
                  ? (command.completionStatus ?? 'complete')
                  : 'complete',
            });
          }
          if (
            events.length > 0 &&
            learning.session !== undefined &&
            command.type === 'ReplacePendingUserTurn'
          ) {
            await options.messageLog.stageReplaceTail(
              tx,
              learning.session.id,
              command.replacedMessageIds,
              {
                id: command.messageId,
                role: 'user',
                createdAt: now.toISOString(),
                contentArtifactRef: command.contentArtifactRef,
                completionStatus: 'complete',
              },
            );
          }
          if (events.length > 0) {
            await options.repositories.save(tx, stored, base.resourceVersion);
            await options.recordEvents?.(tx, events, stored);
          }
        },
      );
      const resourceVersion = base.resourceVersion + (events.length > 0 ? 1 : 0);
      const value: LearningSessionResult = {
        lessonId: command.lessonId,
        progress: learning.progress,
        ...(learning.session === undefined ? {} : { sessionId: learning.session.id }),
        resourceVersion,
        writable: true,
        ...(writeLease === undefined ? {} : { leaseToken: writeLease.token }),
      };
      const result: CommandResult<LearningSessionResult> = {
        commandId: context.commandId,
        outcome: 'completed',
        value,
        resourceVersion,
      };
      return result;
    },
    async query(query) {
      const record = await options.repositories.get(query.lessonId);
      if (record === undefined) throw new Error('LESSON_LEARNING_NOT_FOUND');
      return {
        learning: record.learning,
        resourceVersion: record.resourceVersion,
        actualSeconds: actualLearningSeconds(record.intervals),
        ...(record.finalReview === undefined ? {} : { finalReview: record.finalReview }),
      };
    },
  };
}
