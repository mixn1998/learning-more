import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { DataRoot } from '../../../persistence/data-root.js';
import { checksumJson, encodeJson, StorageDocumentError } from '../../../persistence/json-codec.js';
import { ImmutableResourceError } from '../../../persistence/repository-errors.js';
import type { TransactionContext } from '../../../persistence/unit-of-work.js';

export type LearningMessage = Readonly<{
  id: string;
  role: 'user' | 'assistant';
  createdAt: string;
  contentArtifactRef: string;
  generationTaskId?: string | undefined;
  completionStatus: 'complete' | 'interrupted';
}>;

export interface MessageLog {
  stageAppend(tx: TransactionContext, sessionId: string, message: LearningMessage): Promise<void>;
  list(sessionId: string): Promise<readonly LearningMessage[]>;
}

const LearningMessageSchema = z.strictObject({
  id: z.string().min(1),
  role: z.enum(['user', 'assistant']),
  createdAt: z.iso.datetime({ offset: true }),
  contentArtifactRef: z.string().min(1),
  generationTaskId: z.string().min(1).optional(),
  completionStatus: z.enum(['complete', 'interrupted']),
});
const StoredLearningMessageSchema = LearningMessageSchema.extend({
  completionStatus: z.enum(['complete', 'interrupted']).optional(),
});

function relativePath(sessionId: string): string {
  const hash = createHash('sha256').update(sessionId, 'utf8').digest('hex');
  return `work/session-messages/${hash}.ndjson`;
}

async function readMessages(dataRoot: DataRoot, sessionId: string): Promise<LearningMessage[]> {
  let text: string;
  try {
    text = await readFile(path.join(dataRoot.absolutePath, relativePath(sessionId)), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const record = JSON.parse(line) as { message?: unknown; checksum?: unknown };
      const storedMessage = StoredLearningMessageSchema.parse(record.message);
      if (record.checksum !== checksumJson(storedMessage)) {
        throw new StorageDocumentError('storage_corrupted');
      }
      return LearningMessageSchema.parse({
        ...storedMessage,
        completionStatus: storedMessage.completionStatus ?? 'complete',
      });
    });
}

export function createInMemoryMessageLog(): MessageLog {
  const messages = new Map<string, LearningMessage[]>();
  return {
    async stageAppend(_tx, sessionId, message) {
      const current = messages.get(sessionId) ?? [];
      if (current.some((candidate) => candidate.id === message.id)) return;
      messages.set(sessionId, [...current, structuredClone(message)]);
    },
    async list(sessionId) {
      return structuredClone(messages.get(sessionId) ?? []);
    },
  };
}

export function createLocalFileMessageLog(dataRoot: DataRoot): MessageLog {
  return {
    async stageAppend(tx, sessionId, input) {
      const message = LearningMessageSchema.parse(input);
      const messages = await readMessages(dataRoot, sessionId);
      const existing = messages.find((candidate) => candidate.id === message.id);
      if (existing !== undefined) {
        if (checksumJson(existing) !== checksumJson(message)) throw new ImmutableResourceError();
        return;
      }
      const content = [...messages, message]
        .map((item) => encodeJson({ message: item, checksum: checksumJson(item) }))
        .join('');
      await tx.stageText(relativePath(sessionId), content);
    },
    list: (sessionId) => readMessages(dataRoot, sessionId),
  };
}
