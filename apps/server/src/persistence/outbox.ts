import { createHash, randomUUID } from 'node:crypto';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { LearningEventEnvelopeSchema, type LearningEventEnvelope } from '@learning-more/contracts';

import { DataRoot } from './data-root.js';
import type { EventDispatcher } from './event-dispatcher.js';
import type { EventLog } from './event-log.js';
import type { TransactionContext, UnitOfWork } from './unit-of-work.js';

export interface Outbox {
  enqueue(tx: TransactionContext, events: readonly LearningEventEnvelope[]): Promise<void>;
  dispatchPending(limit: number): Promise<number>;
}

export interface OutboxOptions {
  readonly dataRoot: DataRoot;
  readonly unitOfWork: UnitOfWork;
  readonly eventLog: EventLog;
  readonly dispatcher: EventDispatcher;
  readonly faultInjector?: (point: 'after-event-append') => void | Promise<void>;
}

function eventFileName(eventId: string): string {
  return `${createHash('sha256').update(eventId, 'utf8').digest('hex')}.json`;
}

function pendingRelativePath(eventId: string): string {
  return `outbox/pending/${eventFileName(eventId)}`;
}

function receiptRelativePath(eventId: string): string {
  return `outbox/receipts/${eventFileName(eventId)}`;
}

async function exists(filePath: string): Promise<boolean> {
  return access(filePath)
    .then(() => true)
    .catch(() => false);
}

export function createOutbox(options: OutboxOptions): Outbox {
  return {
    async enqueue(tx, events) {
      for (const event of events) {
        const parsed = LearningEventEnvelopeSchema.parse(event);
        await tx.stageJson(pendingRelativePath(parsed.id), {
          schemaVersion: 1,
          event: parsed,
        });
      }
    },
    async dispatchPending(limit) {
      if (!Number.isInteger(limit) || limit < 0) throw new RangeError('OUTBOX_LIMIT_INVALID');
      const pendingDirectory = path.join(options.dataRoot.absolutePath, 'outbox', 'pending');
      const fileNames = (await readdir(pendingDirectory)).sort().slice(0, limit);
      let dispatched = 0;
      for (const fileName of fileNames) {
        const pendingPath = path.join(pendingDirectory, fileName);
        const raw = JSON.parse(await readFile(pendingPath, 'utf8')) as {
          event?: unknown;
        };
        const event = LearningEventEnvelopeSchema.parse(raw.event);
        const receiptPath = path.join(
          options.dataRoot.absolutePath,
          'outbox',
          'receipts',
          fileName,
        );
        if (!(await exists(receiptPath))) {
          await options.eventLog.append(event);
          await options.faultInjector?.('after-event-append');
          await options.dispatcher.dispatch(event);
        }
        await options.unitOfWork.execute(
          { transactionId: `tx_outbox_${randomUUID()}` },
          async (tx) => {
            await tx.stageJson(receiptRelativePath(event.id), {
              schemaVersion: 1,
              eventId: event.id,
              dispatchedAt: new Date().toISOString(),
            });
            await tx.deleteOnCommit(pendingRelativePath(event.id));
          },
        );
        dispatched += 1;
      }
      return dispatched;
    },
  };
}
