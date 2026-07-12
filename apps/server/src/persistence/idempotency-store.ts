import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { CommandResult } from '@learning-more/contracts';

import { DataRoot } from './data-root.js';
import type { TransactionContext, UnitOfWork } from './unit-of-work.js';

type IdempotencyReceipt =
  | Readonly<{ schemaVersion: 1; key: string; requestHash: string; status: 'in-flight' }>
  | Readonly<{
      schemaVersion: 1;
      key: string;
      requestHash: string;
      status: 'completed';
      result: CommandResult<unknown>;
    }>;

export class IdempotencyConflictError extends Error {
  readonly code = 'idempotency_conflict';

  constructor() {
    super('idempotency_conflict');
    this.name = 'IdempotencyConflictError';
  }
}

export interface IdempotencyStore {
  begin(key: string, requestHash: string): Promise<'new' | 'in-flight'>;
  replay<T>(key: string, requestHash: string): Promise<CommandResult<T> | undefined>;
  complete<T>(
    tx: TransactionContext,
    key: string,
    requestHash: string,
    result: CommandResult<T>,
  ): Promise<void>;
}

function receiptName(key: string): string {
  return `${createHash('sha256').update(key, 'utf8').digest('hex')}.json`;
}

function receiptRelativePath(key: string): string {
  return `idempotency/${receiptName(key)}`;
}

function receiptAbsolutePath(dataRoot: DataRoot, key: string): string {
  return path.join(dataRoot.absolutePath, 'idempotency', receiptName(key));
}

async function readReceipt(
  dataRoot: DataRoot,
  key: string,
): Promise<IdempotencyReceipt | undefined> {
  try {
    return JSON.parse(
      await readFile(receiptAbsolutePath(dataRoot, key), 'utf8'),
    ) as IdempotencyReceipt;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function assertMatchingRequest(receipt: IdempotencyReceipt, requestHash: string): void {
  if (receipt.requestHash !== requestHash) throw new IdempotencyConflictError();
}

export function createIdempotencyStore(
  dataRoot: DataRoot,
  unitOfWork: UnitOfWork,
): IdempotencyStore {
  return {
    async begin(key, requestHash) {
      return unitOfWork.execute({ transactionId: `tx_idempotency_${randomUUID()}` }, async (tx) => {
        const existing = await readReceipt(dataRoot, key);
        if (existing !== undefined) {
          assertMatchingRequest(existing, requestHash);
          return 'in-flight';
        }
        await tx.stageJson(receiptRelativePath(key), {
          schemaVersion: 1,
          key,
          requestHash,
          status: 'in-flight',
        } satisfies IdempotencyReceipt);
        return 'new';
      });
    },
    async replay<T>(key: string, requestHash: string): Promise<CommandResult<T> | undefined> {
      const receipt = await readReceipt(dataRoot, key);
      if (receipt === undefined) return undefined;
      assertMatchingRequest(receipt, requestHash);
      return receipt.status === 'completed' ? (receipt.result as CommandResult<T>) : undefined;
    },
    async complete<T>(
      tx: TransactionContext,
      key: string,
      requestHash: string,
      result: CommandResult<T>,
    ) {
      const receipt = await readReceipt(dataRoot, key);
      if (receipt !== undefined) assertMatchingRequest(receipt, requestHash);
      await tx.stageJson(receiptRelativePath(key), {
        schemaVersion: 1,
        key,
        requestHash,
        status: 'completed',
        result,
      } satisfies IdempotencyReceipt);
    },
  };
}
