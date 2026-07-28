import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LearningEventEnvelope } from '@learning-more/contracts';

import { DataRoot } from './data-root.js';
import { createEventDispatcher } from './event-dispatcher.js';
import { createEventLog } from './event-log.js';
import { createOutbox } from './outbox.js';
import { createStorePaths, initializeStoreLayout } from './paths.js';
import { createUnitOfWork } from './unit-of-work.js';

const temporaryRoots: string[] = [];

function event(id: string): LearningEventEnvelope {
  return {
    id,
    schema_version: 1,
    type: 'CourseCreated',
    occurred_at: '2026-07-13T00:00:00.000Z',
    recorded_at: '2026-07-13T00:00:00.000Z',
    source: 'course-authoring',
    target_refs: { courseId: 'course_01' },
    payload: { title: '中文课程' },
    idempotency_key: 'create-course',
    correlation_id: 'correlation_01',
  };
}

function legacyPortraitEvent(id: string): LearningEventEnvelope {
  return {
    id,
    schema_version: 1,
    type: 'PortraitVersionCommitted',
    occurred_at: '2026-07-13T00:00:00.000Z',
    recorded_at: '2026-07-13T00:00:00.000Z',
    source: 'learning-portrait',
    target_refs: { portraitId: 'portrait_01' },
    payload: { portraitVersion: 1 },
    idempotency_key: 'legacy-portrait',
    correlation_id: 'correlation_legacy',
  };
}

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-outbox-'));
  temporaryRoots.push(directory);
  const dataRoot = DataRoot.create(directory);
  await initializeStoreLayout(createStorePaths(dataRoot));
  const unitOfWork = createUnitOfWork({ dataRoot });
  const eventLog = createEventLog(dataRoot);
  const dispatcher = createEventDispatcher();
  return { dataRoot, unitOfWork, eventLog, dispatcher };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('Outbox', () => {
  it('keeps retired portrait events readable without restoring an active portrait event type', async () => {
    const { eventLog } = await fixture();
    const legacy = legacyPortraitEvent('event_legacy_portrait');

    await eventLog.append(legacy);

    await expect(eventLog.readAll()).resolves.toEqual([legacy]);
  });

  it('recovers a crash after event append and never appends the event id twice', async () => {
    const { dataRoot, unitOfWork, eventLog, dispatcher } = await fixture();
    const handled = vi.fn();
    dispatcher.register('CourseCreated', handled);
    const crashingOutbox = createOutbox({
      dataRoot,
      unitOfWork,
      eventLog,
      dispatcher,
      faultInjector(point) {
        if (point === 'after-event-append') throw new Error('SIMULATED_DISPATCH_CRASH');
      },
    });
    await unitOfWork.execute({ transactionId: 'tx_enqueue' }, async (tx) => {
      await tx.stageJson('work/course.json', { id: 'course_01' });
      await crashingOutbox.enqueue(tx, [event('event_01')]);
    });

    await expect(crashingOutbox.dispatchPending(10)).rejects.toThrow('SIMULATED_DISPATCH_CRASH');

    const recoveredOutbox = createOutbox({ dataRoot, unitOfWork, eventLog, dispatcher });
    for (let attempt = 0; attempt < 10; attempt += 1) await recoveredOutbox.dispatchPending(10);

    await expect(eventLog.readAll()).resolves.toEqual([event('event_01')]);
    expect(handled).toHaveBeenCalledTimes(1);
  });

  it('truncates an incomplete tail but rejects corruption in the middle of a segment', async () => {
    const { dataRoot, eventLog } = await fixture();
    await eventLog.append(event('event_01'));
    const segment = path.join(dataRoot.absolutePath, 'events', 'segments', '00000001.ndjson');
    await appendFile(segment, '{"incomplete":', 'utf8');

    await expect(eventLog.readAll()).resolves.toEqual([event('event_01')]);

    await eventLog.append(event('event_02'));
    const lines = (await readFile(segment, 'utf8')).trimEnd().split('\n');
    const first = JSON.parse(lines[0]!) as { checksum: string };
    first.checksum = `sha256:${'0'.repeat(64)}`;
    lines[0] = JSON.stringify(first);
    await writeFile(segment, `${lines.join('\n')}\n`, 'utf8');

    await expect(eventLog.readAll()).rejects.toMatchObject({ code: 'storage_corrupted' });
  });
});
