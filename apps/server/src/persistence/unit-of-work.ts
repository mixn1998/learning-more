import { mkdir, open } from 'node:fs/promises';
import path from 'node:path';

import { assertSafePathSegment, DataRoot } from './data-root.js';
import { encodeJson } from './json-codec.js';
import { acquireStoreWriteLease } from './store-write-lease.js';
import {
  applyJournalOperations,
  cleanupTransaction,
  transactionDirectory,
  transactionFilePath,
  type TransactionFaultInjector,
  type TransactionFaultPoint,
  type TransactionJournal,
  writeTransactionJournal,
} from './transaction-journal.js';

export type { TransactionFaultPoint };

export interface TransactionRequest {
  readonly transactionId: string;
}

export interface TransactionContext {
  stageJson(relativePath: string, value: unknown): Promise<void>;
  stageText(relativePath: string, value: string): Promise<void>;
  deleteOnCommit(relativePath: string): Promise<void>;
}

export interface UnitOfWork {
  execute<T>(request: TransactionRequest, work: (tx: TransactionContext) => Promise<T>): Promise<T>;
}

export interface UnitOfWorkOptions {
  readonly dataRoot: DataRoot;
  readonly faultInjector?: TransactionFaultInjector;
}

function validateRelativePath(relativePath: string): void {
  if (relativePath.length === 0 || path.isAbsolute(relativePath) || relativePath.includes('\\')) {
    throw new Error('PATH_OUTSIDE_DATA_ROOT');
  }
  for (const segment of relativePath.split('/')) assertSafePathSegment(segment);
}

async function writeStagedFile(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const handle = await open(filePath, 'w');
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export function createUnitOfWork(options: UnitOfWorkOptions): UnitOfWork {
  return {
    async execute<T>(
      request: TransactionRequest,
      work: (tx: TransactionContext) => Promise<T>,
    ): Promise<T> {
      assertSafePathSegment(request.transactionId);
      const lease = await acquireStoreWriteLease(options.dataRoot);
      const journal: TransactionJournal = {
        schemaVersion: 1,
        transactionId: request.transactionId,
        state: 'preparing',
        operations: [],
      };
      const operations = new Map<string, 'write' | 'delete'>();
      await mkdir(transactionDirectory(options.dataRoot, request.transactionId), {
        recursive: true,
      });

      try {
        await writeTransactionJournal(options.dataRoot, journal);
        await options.faultInjector?.('journal:preparing');

        const context: TransactionContext = {
          async stageJson(relativePath, value) {
            validateRelativePath(relativePath);
            operations.set(relativePath, 'write');
            await writeStagedFile(
              transactionFilePath(options.dataRoot, request.transactionId, 'staging', relativePath),
              encodeJson(value),
            );
          },
          async stageText(relativePath, value) {
            validateRelativePath(relativePath);
            operations.set(relativePath, 'write');
            await writeStagedFile(
              transactionFilePath(options.dataRoot, request.transactionId, 'staging', relativePath),
              value.replaceAll('\r\n', '\n').replaceAll('\r', '\n'),
            );
          },
          async deleteOnCommit(relativePath) {
            validateRelativePath(relativePath);
            operations.set(relativePath, 'delete');
          },
        };

        const result = await work(context);
        journal.operations.push(
          ...[...operations.entries()]
            .sort(([left], [right]) => left.localeCompare(right, 'en-US'))
            .map(([relativePath, kind]) => ({ relativePath, kind, state: 'pending' as const })),
        );
        journal.state = 'prepared';
        await writeTransactionJournal(options.dataRoot, journal);
        await options.faultInjector?.('journal:prepared');

        journal.state = 'committing';
        await writeTransactionJournal(options.dataRoot, journal);
        await options.faultInjector?.('journal:committing');
        await applyJournalOperations(options.dataRoot, journal, options.faultInjector);

        journal.state = 'committed';
        await writeTransactionJournal(options.dataRoot, journal);
        await options.faultInjector?.('journal:committed');
        await cleanupTransaction(options.dataRoot, journal, options.faultInjector);
        return result;
      } finally {
        await lease.release();
      }
    },
  };
}
