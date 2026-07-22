import { randomUUID } from 'node:crypto';

import type { SupplementarySessionRepository } from '../../../persistence/supplementary-session-repository.js';
import type { UnitOfWork } from '../../../persistence/unit-of-work.js';
import type { LearningMessage, MessageLog } from './message-log.js';
import { createSupplementarySession } from '../model/supplementary-session.js';

export type SupplementarySessionCommand =
  | Readonly<{ type: 'StartSupplementarySession'; lessonId: string }>
  | Readonly<{
      type: 'StartSupplementaryTurn';
      supplementarySessionId: string;
      message: LearningMessage;
      taskId: string;
      expectedVersion: number;
      replacedUserMessageId?: string;
    }>
  | Readonly<{
      type: 'RetrySupplementaryTurn';
      supplementarySessionId: string;
      taskId: string;
      expectedVersion: number;
    }>
  | Readonly<{
      type: 'CommitSupplementaryReply';
      supplementarySessionId: string;
      taskId: string;
      message: LearningMessage;
    }>
  | Readonly<{
      type: 'FailSupplementaryGeneration';
      supplementarySessionId: string;
      taskId: string;
      errorCode: string;
    }>
  | Readonly<{
      type: 'ArchiveSupplementarySession';
      supplementarySessionId: string;
      expectedVersion: number;
    }>
  | Readonly<{
      type: 'RenameSupplementarySession';
      supplementarySessionId: string;
      title: string;
      expectedVersion: number;
    }>;

export class SupplementarySessionError extends Error {
  constructor(
    readonly code:
      | 'lesson_not_completed'
      | 'supplementary_session_not_found'
      | 'supplementary_session_archived'
      | 'supplementary_generation_active'
      | 'supplementary_retry_unavailable',
  ) {
    super(code);
    this.name = 'SupplementarySessionError';
  }
}

function versionConflict(currentVersion: number): Error {
  return Object.assign(new Error('version_conflict'), {
    code: 'version_conflict',
    currentVersion,
  });
}

function withoutGenerationError<T extends { generationErrorCode?: string }>(value: T) {
  const rest = { ...value };
  delete rest.generationErrorCode;
  return rest as Omit<T, 'generationErrorCode'>;
}

function withoutGeneration<
  T extends { activeGenerationTaskId?: string; generationErrorCode?: string },
>(value: T) {
  const rest = { ...value };
  delete rest.activeGenerationTaskId;
  delete rest.generationErrorCode;
  return rest as Omit<T, 'activeGenerationTaskId' | 'generationErrorCode'>;
}

export function createSupplementarySessionModule(options: {
  repository: SupplementarySessionRepository;
  messageLog: MessageLog;
  unitOfWork: UnitOfWork;
  getCompletedLesson(
    lessonId: string,
  ): Promise<Readonly<{ courseId: string; finalReview: Readonly<{ id: string }> }> | undefined>;
  nextSessionId(): string;
  now(): Date;
}) {
  async function getRequired(id: string) {
    const current = await options.repository.get(id);
    if (current === undefined)
      throw new SupplementarySessionError('supplementary_session_not_found');
    return current;
  }

  async function save(
    current: Awaited<ReturnType<typeof getRequired>>,
    next: Awaited<ReturnType<typeof getRequired>>,
    stageMessages?: (tx: Parameters<Parameters<UnitOfWork['execute']>[1]>[0]) => Promise<void>,
  ) {
    await options.unitOfWork.execute(
      { transactionId: `tx_supplementary_${randomUUID()}` },
      async (tx) => {
        await stageMessages?.(tx);
        await options.repository.save(tx, next, current.resourceVersion);
      },
    );
    return (await options.repository.get(next.id))!;
  }

  return {
    async execute(command: SupplementarySessionCommand) {
      if (command.type === 'StartSupplementarySession') {
        const source = await options.getCompletedLesson(command.lessonId);
        if (source === undefined) throw new SupplementarySessionError('lesson_not_completed');
        const created = createSupplementarySession({
          id: options.nextSessionId(),
          courseId: source.courseId,
          lessonId: command.lessonId,
          finalReviewId: source.finalReview.id,
          createdAt: options.now().toISOString(),
        });
        await options.unitOfWork.execute(
          { transactionId: `tx_supplementary_${randomUUID()}` },
          (tx) => options.repository.save(tx, created, 0),
        );
        return (await options.repository.get(created.id))!;
      }

      const current = await getRequired(command.supplementarySessionId);
      if (
        command.type !== 'FailSupplementaryGeneration' &&
        command.type !== 'RenameSupplementarySession' &&
        current.status === 'archived'
      ) {
        throw new SupplementarySessionError('supplementary_session_archived');
      }

      if (command.type === 'RenameSupplementarySession') {
        if (current.resourceVersion !== command.expectedVersion) {
          throw versionConflict(current.resourceVersion);
        }
        return save(current, {
          ...current,
          title: command.title,
          updatedAt: options.now().toISOString(),
        });
      }

      if (command.type === 'StartSupplementaryTurn') {
        if (current.resourceVersion !== command.expectedVersion) {
          throw versionConflict(current.resourceVersion);
        }
        if (current.activeGenerationTaskId !== undefined) {
          throw new SupplementarySessionError('supplementary_generation_active');
        }
        const messages = await options.messageLog.list(current.id);
        const replacedIndex =
          command.replacedUserMessageId === undefined
            ? -1
            : messages.findIndex((message) => message.id === command.replacedUserMessageId);
        const currentMessageIndex =
          command.replacedUserMessageId === undefined
            ? -1
            : current.messageIds.indexOf(command.replacedUserMessageId);
        if (command.replacedUserMessageId !== undefined && currentMessageIndex < 0) {
          throw new SupplementarySessionError('supplementary_retry_unavailable');
        }
        const replaced = replacedIndex < 0 ? [] : messages.slice(replacedIndex).map(({ id }) => id);
        const nextMessageIds =
          command.replacedUserMessageId === undefined
            ? [...current.messageIds, command.message.id]
            : [...current.messageIds.slice(0, currentMessageIndex), command.message.id];
        return save(
          current,
          {
            ...withoutGenerationError(current),
            messageIds: nextMessageIds,
            activeGenerationTaskId: command.taskId,
            updatedAt: options.now().toISOString(),
          },
          (tx) =>
            replaced.length === 0
              ? options.messageLog.stageAppend(tx, current.id, command.message)
              : options.messageLog.stageReplaceTail(tx, current.id, replaced, command.message),
        );
      }

      if (command.type === 'RetrySupplementaryTurn') {
        if (current.resourceVersion !== command.expectedVersion) {
          throw versionConflict(current.resourceVersion);
        }
        if (current.activeGenerationTaskId !== undefined) {
          throw new SupplementarySessionError('supplementary_generation_active');
        }
        const messages = await options.messageLog.list(current.id);
        if (messages.findLast((message) => message.role === 'user') === undefined) {
          throw new SupplementarySessionError('supplementary_retry_unavailable');
        }
        return save(current, {
          ...withoutGenerationError(current),
          activeGenerationTaskId: command.taskId,
          updatedAt: options.now().toISOString(),
        });
      }

      if (command.type === 'CommitSupplementaryReply') {
        if (current.activeGenerationTaskId !== command.taskId || current.status !== 'active') {
          return current;
        }
        return save(
          current,
          {
            ...withoutGeneration(current),
            messageIds: [...current.messageIds, command.message.id],
            updatedAt: options.now().toISOString(),
          },
          (tx) => options.messageLog.stageAppend(tx, current.id, command.message),
        );
      }

      if (command.type === 'FailSupplementaryGeneration') {
        if (current.activeGenerationTaskId !== command.taskId) return current;
        return save(current, {
          ...withoutGeneration(current),
          generationErrorCode: command.errorCode,
          updatedAt: options.now().toISOString(),
        });
      }

      if (current.resourceVersion !== command.expectedVersion) {
        throw versionConflict(current.resourceVersion);
      }
      return save(current, {
        ...withoutGeneration(current),
        status: 'archived',
        updatedAt: options.now().toISOString(),
      });
    },
    get: (id: string) => options.repository.get(id),
    listByLesson: (lessonId: string) => options.repository.listByLesson(lessonId),
    listMessages: (sessionId: string) => options.messageLog.list(sessionId),
  };
}
