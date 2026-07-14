import type { TransactionContext } from '../../../persistence/unit-of-work.js';
import type { OutlineSession } from '../model/outline-session.js';

export interface OutlineSessionRecord {
  readonly session: OutlineSession;
  readonly resourceVersion: number;
  readonly candidateCommandReceipts: Readonly<Record<string, { taskId: string }>>;
  readonly messages: readonly Readonly<{
    messageId: string;
    role: 'user' | 'assistant';
    content: string;
    status: 'complete' | 'failed';
    createdAt: string;
    inReplyToMessageId?: string;
    alignmentAction?: 'clarify' | 'regenerate' | 'patch';
    targetModuleIds?: readonly string[];
  }>[];
}

export interface OutlineSessionRepository {
  get(outlineSessionId: string): Promise<OutlineSessionRecord | undefined>;
  save(
    tx: TransactionContext,
    record: OutlineSessionRecord,
    expectedVersion: number,
  ): Promise<void>;
  list(): AsyncIterable<OutlineSessionRecord>;
}
