import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { DataRoot } from './data-root.js';
import { createReadRevisionTracker } from './read-revision.js';
import { createUnitOfWork } from './unit-of-work.js';

describe('read revisions', () => {
  it('advances only the summary scopes affected by a committed transaction', async () => {
    const dataRoot = DataRoot.create(await mkdtemp(path.join(os.tmpdir(), 'read-revision-')));
    const tracker = await createReadRevisionTracker(dataRoot);
    const unitOfWork = createUnitOfWork({ dataRoot, readRevision: tracker });

    await unitOfWork.execute({ transactionId: 'tx_schedule' }, async (transaction) => {
      await transaction.stageJson('entities/schedules/aa/schedule_1.json', { id: 'schedule_1' });
    });

    expect(tracker.current(['schedule'])).toBe('schedule:1');
    expect(tracker.current(['catalog', 'learning'])).toBe('catalog:0|learning:0');
    const reloaded = await createReadRevisionTracker(dataRoot);
    expect(reloaded.current(['schedule'])).toBe('schedule:1');
  });
});
