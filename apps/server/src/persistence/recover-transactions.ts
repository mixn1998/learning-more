import { access, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { DataRoot } from './data-root.js';
import { acquireStoreWriteLease } from './store-write-lease.js';
import {
  applyJournalOperations,
  cleanupTransaction,
  readTransactionJournal,
  transactionDirectory,
  writeTransactionJournal,
} from './transaction-journal.js';

export async function recoverTransactions(dataRoot: DataRoot): Promise<number> {
  const lease = await acquireStoreWriteLease(dataRoot);
  let recovered = 0;
  try {
    const preparedDirectory = dataRoot.resolve('transactions', 'prepared');
    const entries = await readdir(preparedDirectory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(preparedDirectory, entry.name);
      const journalPath = path.join(directory, 'journal.json');
      const journalExists = await access(journalPath)
        .then(() => true)
        .catch(() => false);
      if (!journalExists) {
        const remnants = await readdir(directory, { withFileTypes: true });
        if (
          remnants.length === 0 ||
          (remnants.length === 1 &&
            remnants[0]?.isFile() === true &&
            remnants[0].name === 'journal.json.tmp')
        ) {
          await rm(directory, { force: true, recursive: true });
          recovered += 1;
          continue;
        }
      }
      const journal = await readTransactionJournal(dataRoot, entry.name);
      if (journal.state === 'preparing' || journal.state === 'prepared') {
        await rm(transactionDirectory(dataRoot, journal.transactionId), {
          force: true,
          recursive: true,
        });
      } else if (journal.state === 'committing') {
        await applyJournalOperations(dataRoot, journal);
        journal.state = 'committed';
        await writeTransactionJournal(dataRoot, journal);
        await cleanupTransaction(dataRoot, journal);
      } else if (journal.state === 'committed') {
        await cleanupTransaction(dataRoot, journal);
      } else {
        await rm(path.join(preparedDirectory, entry.name), { force: true, recursive: true });
      }
      recovered += 1;
    }
    return recovered;
  } finally {
    await lease.release();
  }
}
