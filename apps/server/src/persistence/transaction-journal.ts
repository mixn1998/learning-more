import { access, copyFile, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { DataRoot } from './data-root.js';
import { encodeJson } from './json-codec.js';

export type JournalState = 'preparing' | 'prepared' | 'committing' | 'committed' | 'cleaned';
export type TransactionFaultPoint =
  | 'journal:preparing'
  | 'journal:prepared'
  | 'journal:committing'
  | 'journal:committed'
  | 'before-cleanup'
  | 'after-cleanup'
  | `before-apply:${number}`
  | `after-backup:${number}`
  | `after-apply:${number}`;

export type TransactionFaultInjector = (point: TransactionFaultPoint) => void | Promise<void>;

export interface JournalOperation {
  readonly relativePath: string;
  readonly kind: 'write' | 'delete';
  state: 'pending' | 'backed-up' | 'applied';
}

export interface TransactionJournal {
  readonly schemaVersion: 1;
  readonly transactionId: string;
  state: JournalState;
  readonly operations: JournalOperation[];
}

export class TransactionRecoveryError extends Error {
  constructor(
    readonly code: 'storage_corrupted' | 'store_version_unsupported',
    cause?: unknown,
  ) {
    super(code, { cause });
    this.name = 'TransactionRecoveryError';
  }
}

const JournalSchema = z.strictObject({
  schemaVersion: z.literal(1),
  transactionId: z.string().min(1),
  state: z.enum(['preparing', 'prepared', 'committing', 'committed', 'cleaned']),
  operations: z.array(
    z.strictObject({
      relativePath: z.string().min(1),
      kind: z.enum(['write', 'delete']),
      state: z.enum(['pending', 'backed-up', 'applied']),
    }),
  ),
});

function relativeSegments(relativePath: string): string[] {
  return relativePath.split('/');
}

export function transactionDirectory(dataRoot: DataRoot, transactionId: string): string {
  return dataRoot.resolve('transactions', 'prepared', transactionId);
}

export function transactionFilePath(
  dataRoot: DataRoot,
  transactionId: string,
  area: 'staging' | 'rollback',
  relativePath: string,
): string {
  return path.join(
    transactionDirectory(dataRoot, transactionId),
    area,
    ...relativeSegments(relativePath),
  );
}

export function storeFilePath(dataRoot: DataRoot, relativePath: string): string {
  return path.join(dataRoot.absolutePath, ...relativeSegments(relativePath));
}

async function exists(filePath: string): Promise<boolean> {
  return access(filePath)
    .then(() => true)
    .catch(() => false);
}

async function writeDurable(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  const handle = await open(temporaryPath, 'w');
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, filePath);
}

export async function writeTransactionJournal(
  dataRoot: DataRoot,
  journal: TransactionJournal,
): Promise<void> {
  await writeDurable(
    path.join(transactionDirectory(dataRoot, journal.transactionId), 'journal.json'),
    encodeJson(journal),
  );
}

export async function readTransactionJournal(
  dataRoot: DataRoot,
  transactionId: string,
): Promise<TransactionJournal> {
  const journalPath = path.join(transactionDirectory(dataRoot, transactionId), 'journal.json');
  try {
    const raw = JSON.parse(await readFile(journalPath, 'utf8')) as unknown;
    if (
      typeof raw === 'object' &&
      raw !== null &&
      'schemaVersion' in raw &&
      raw.schemaVersion !== 1
    ) {
      throw new TransactionRecoveryError('store_version_unsupported');
    }
    return JournalSchema.parse(raw) as TransactionJournal;
  } catch (error) {
    if (error instanceof TransactionRecoveryError) throw error;
    throw new TransactionRecoveryError('storage_corrupted', error);
  }
}

export async function applyJournalOperations(
  dataRoot: DataRoot,
  journal: TransactionJournal,
  injectFault?: TransactionFaultInjector,
): Promise<void> {
  for (const [index, operation] of journal.operations.entries()) {
    const target = storeFilePath(dataRoot, operation.relativePath);
    const staged = transactionFilePath(
      dataRoot,
      journal.transactionId,
      'staging',
      operation.relativePath,
    );
    const rollback = transactionFilePath(
      dataRoot,
      journal.transactionId,
      'rollback',
      operation.relativePath,
    );

    if (operation.state === 'pending') {
      await injectFault?.(`before-apply:${index}`);
      if (await exists(target)) {
        await mkdir(path.dirname(rollback), { recursive: true });
        // Keep the last committed value readable until the staged replacement is
        // atomically moved into place. Moving the target into rollback first
        // creates a short ENOENT window that high-frequency generation polling
        // can mistake for a missing task.
        await copyFile(target, rollback);
      }
      operation.state = 'backed-up';
      await writeTransactionJournal(dataRoot, journal);
      await injectFault?.(`after-backup:${index}`);
    }

    if (operation.state === 'backed-up') {
      if (operation.kind === 'write') {
        if (await exists(staged)) {
          await mkdir(path.dirname(target), { recursive: true });
          await rename(staged, target);
        } else if (!(await exists(target))) {
          throw new TransactionRecoveryError('storage_corrupted');
        }
      } else {
        await rm(target, { force: true });
      }
      operation.state = 'applied';
      await writeTransactionJournal(dataRoot, journal);
      await injectFault?.(`after-apply:${index}`);
    }
  }
}

export async function cleanupTransaction(
  dataRoot: DataRoot,
  journal: TransactionJournal,
  injectFault?: TransactionFaultInjector,
): Promise<void> {
  await injectFault?.('before-cleanup');
  const directory = transactionDirectory(dataRoot, journal.transactionId);
  await rm(path.join(directory, 'staging'), { force: true, recursive: true });
  await rm(path.join(directory, 'rollback'), { force: true, recursive: true });
  journal.state = 'cleaned';
  await writeTransactionJournal(dataRoot, journal);
  await injectFault?.('after-cleanup');
  await rm(directory, { force: true, recursive: true });
}
