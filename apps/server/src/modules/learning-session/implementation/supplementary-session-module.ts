import { randomUUID } from 'node:crypto';

import type { SupplementarySessionRepository } from '../../../persistence/supplementary-session-repository.js';
import type { UnitOfWork } from '../../../persistence/unit-of-work.js';
import { createSupplementarySession } from '../model/supplementary-session.js';

export type SupplementarySessionCommand =
  | Readonly<{ type: 'StartSupplementarySession'; lessonId: string }>
  | Readonly<{
      type: 'AppendSupplementaryMessage';
      supplementarySessionId: string;
      messageId: string;
      expectedVersion: number;
    }>
  | Readonly<{
      type: 'ArchiveSupplementarySession';
      supplementarySessionId: string;
      expectedVersion: number;
    }>;

class SupplementarySessionError extends Error {
  constructor(
    readonly code:
      'lesson_not_completed' | 'supplementary_session_not_found' | 'supplementary_session_archived',
  ) {
    super(code);
    this.name = 'SupplementarySessionError';
  }
}

export function createSupplementarySessionModule(options: {
  repository: SupplementarySessionRepository;
  unitOfWork: UnitOfWork;
  getCompletedLesson(
    lessonId: string,
  ): Promise<Readonly<{ courseId: string; finalReview: Readonly<{ id: string }> }> | undefined>;
  nextSessionId(): string;
  now(): Date;
}) {
  async function persist(session: Awaited<ReturnType<typeof options.repository.get>>) {
    if (session === undefined)
      throw new SupplementarySessionError('supplementary_session_not_found');
    await options.unitOfWork.execute({ transactionId: `tx_supplementary_${randomUUID()}` }, (tx) =>
      options.repository.save(tx, session, session.resourceVersion),
    );
    return (await options.repository.get(session.id))!;
  }

  return {
    async execute(command: SupplementarySessionCommand) {
      if (command.type === 'StartSupplementarySession') {
        const source = await options.getCompletedLesson(command.lessonId);
        if (source === undefined) throw new SupplementarySessionError('lesson_not_completed');
        return persist(
          createSupplementarySession({
            id: options.nextSessionId(),
            courseId: source.courseId,
            lessonId: command.lessonId,
            finalReviewId: source.finalReview.id,
            createdAt: options.now().toISOString(),
          }),
        );
      }
      const current = await options.repository.get(command.supplementarySessionId);
      if (current === undefined) {
        throw new SupplementarySessionError('supplementary_session_not_found');
      }
      if (current.status === 'archived') {
        throw new SupplementarySessionError('supplementary_session_archived');
      }
      if (current.resourceVersion !== command.expectedVersion) {
        const error = new Error('version_conflict') as Error & {
          code: string;
          currentVersion: number;
        };
        error.code = 'version_conflict';
        error.currentVersion = current.resourceVersion;
        throw error;
      }
      return persist({
        ...current,
        ...(command.type === 'AppendSupplementaryMessage'
          ? { messageIds: [...current.messageIds, command.messageId] }
          : { status: 'archived' as const }),
        updatedAt: options.now().toISOString(),
      });
    },
    get: (id: string) => options.repository.get(id),
  };
}
