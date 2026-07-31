import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { doctorStore } from './doctor.js';
import { quarantineIssues, repairDerivedIssues } from './quarantine.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function canonical(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonical);
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]),
  );
}

function checksum(value: unknown): string {
  return `sha256:${createHash('sha256')
    .update(`${JSON.stringify(canonical(value))}\n`)
    .digest('hex')}`;
}

async function fixture() {
  const storePath = await mkdtemp(path.join(os.tmpdir(), 'learning-more-doctor-'));
  roots.push(storePath);
  await mkdir(path.join(storePath, 'entities', 'reviews'), { recursive: true });
  await mkdir(path.join(storePath, 'read-models'), { recursive: true });
  await mkdir(path.join(storePath, 'indexes'), { recursive: true });
  await mkdir(path.join(storePath, 'events', 'segments'), { recursive: true });
  await writeFile(
    path.join(storePath, 'store.json'),
    `${JSON.stringify({
      storeId: 'store_01',
      formatVersion: 1,
      minimumReaderVersion: 1,
      createdAt: '2026-07-13T00:00:00.000Z',
      lastCommittedTransactionId: '',
      lastCommittedSequence: 0,
      timezone: 'Asia/Shanghai',
      checksumAlgorithm: 'sha256',
    })}\n`,
    'utf8',
  );
  const data = { reviewId: 'review_01', state: 'draft' };
  const reviewPath = path.join(storePath, 'entities', 'reviews', 'review_01.json');
  await writeFile(
    reviewPath,
    `${JSON.stringify({ schemaVersion: 1, entityType: 'review', entityId: 'review_01', data, contentSha256: checksum(data) })}\n`,
    'utf8',
  );
  return { storePath, reviewPath };
}

describe('read-only store doctor', () => {
  it('classifies a healthy store and derived corruption without touching source files', async () => {
    const { storePath } = await fixture();
    await expect(doctorStore(storePath)).resolves.toMatchObject({
      classification: 'healthy',
      writeProtectionRequired: false,
    });
    const derivedPath = path.join(storePath, 'read-models', 'history.json');
    await writeFile(derivedPath, '{truncated', 'utf8');
    const before = await readFile(derivedPath, 'utf8');
    const report = await doctorStore(storePath);
    expect(report).toMatchObject({
      classification: 'repairable-derived',
      writeProtectionRequired: true,
      actions: expect.arrayContaining(['rebuild:read-models']),
    });
    await expect(readFile(derivedPath, 'utf8')).resolves.toBe(before);
    await expect(repairDerivedIssues({ storePath, report })).resolves.toMatchObject({
      report: { classification: 'healthy' },
    });
  });

  it('classifies unsupported schema separately from authoritative corruption', async () => {
    const { storePath, reviewPath } = await fixture();
    const store = JSON.parse(await readFile(path.join(storePath, 'store.json'), 'utf8')) as object;
    await writeFile(
      path.join(storePath, 'store.json'),
      `${JSON.stringify({ ...store, formatVersion: 99 })}\n`,
      'utf8',
    );
    await expect(doctorStore(storePath)).resolves.toMatchObject({
      classification: 'unsupported',
      writeProtectionRequired: true,
    });

    await writeFile(
      path.join(storePath, 'store.json'),
      `${JSON.stringify({ ...store, formatVersion: 1 })}\n`,
      'utf8',
    );
    await writeFile(reviewPath, '{truncated', 'utf8');
    await expect(doctorStore(storePath)).resolves.toMatchObject({
      classification: 'requires-restore',
      writeProtectionRequired: true,
      issues: expect.arrayContaining([expect.objectContaining({ code: 'json_invalid' })]),
    });
  });

  it.each([
    ['final Review checksum tamper', 'checksum'],
    ['missing immutable Artifact reference', 'reference'],
    ['incomplete event tail', 'event-tail'],
  ])('conservatively requires restore for %s', async (_name, fault) => {
    const { storePath, reviewPath } = await fixture();
    if (fault === 'checksum') {
      const review = JSON.parse(await readFile(reviewPath, 'utf8')) as Record<string, unknown>;
      await writeFile(
        reviewPath,
        `${JSON.stringify({ ...review, contentSha256: `sha256:${'0'.repeat(64)}` })}\n`,
        'utf8',
      );
    } else if (fault === 'reference') {
      const data = { reviewId: 'review_01', state: 'final', artifactRef: 'artifact_missing' };
      await writeFile(
        reviewPath,
        `${JSON.stringify({ schemaVersion: 1, data, contentSha256: checksum(data) })}\n`,
        'utf8',
      );
    } else {
      await writeFile(
        path.join(storePath, 'events', 'segments', '00000001.ndjson'),
        '{"payload":',
        'utf8',
      );
    }
    await expect(doctorStore(storePath)).resolves.toMatchObject({
      classification: 'requires-restore',
      writeProtectionRequired: true,
    });
  });

  it('detects event records removed from the middle using the event index high-water checksum', async () => {
    const { storePath } = await fixture();
    const events = [{ id: 'event_01' }, { id: 'event_02' }];
    const records = events.map((payload) => ({ payload, checksum: checksum(payload) }));
    await writeFile(
      path.join(storePath, 'events', 'segments', '00000001.ndjson'),
      `${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
      'utf8',
    );
    await writeFile(
      path.join(storePath, 'events', 'event-log.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        segment: '00000001.ndjson',
        eventCount: 2,
        lastEventId: 'event_02',
        eventsChecksum: checksum(events),
      })}\n`,
      'utf8',
    );
    await writeFile(
      path.join(storePath, 'events', 'segments', '00000001.ndjson'),
      `${JSON.stringify(records[1])}\n`,
      'utf8',
    );
    await expect(doctorStore(storePath)).resolves.toMatchObject({
      classification: 'requires-restore',
      issues: expect.arrayContaining([expect.objectContaining({ code: 'event_index_mismatch' })]),
    });
  });

  it('requires restore for a receipt whose event is missing, but can reconcile a pending overlap', async () => {
    const { storePath } = await fixture();
    const receiptDirectory = path.join(storePath, 'outbox', 'receipts');
    const pendingDirectory = path.join(storePath, 'outbox', 'pending');
    await mkdir(receiptDirectory, { recursive: true });
    await mkdir(pendingDirectory, { recursive: true });
    await writeFile(
      path.join(receiptDirectory, 'event.json'),
      '{"schemaVersion":1,"eventId":"event_01"}\n',
      'utf8',
    );
    await expect(doctorStore(storePath)).resolves.toMatchObject({
      classification: 'requires-restore',
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'outbox_receipt_event_missing' }),
      ]),
    });

    const payload = { id: 'event_01' };
    await writeFile(
      path.join(storePath, 'events', 'segments', '00000001.ndjson'),
      `${JSON.stringify({ payload, checksum: checksum(payload) })}\n`,
      'utf8',
    );
    await writeFile(
      path.join(storePath, 'events', 'event-log.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        segment: '00000001.ndjson',
        eventCount: 1,
        lastEventId: 'event_01',
        eventsChecksum: checksum([payload]),
      })}\n`,
      'utf8',
    );
    await writeFile(path.join(pendingDirectory, 'event.json'), '{"event":{"id":"event_01"}}\n');
    await expect(doctorStore(storePath)).resolves.toMatchObject({
      classification: 'repairable-derived',
      actions: expect.arrayContaining(['reconcile:outbox-receipts']),
    });
  });
});

describe('quarantine evidence', () => {
  it('copies corrupted files, adjacent metadata, checksums, and the report without changing originals', async () => {
    const { storePath, reviewPath } = await fixture();
    const metadataPath = path.join(path.dirname(reviewPath), 'review_01.metadata.json');
    await writeFile(metadataPath, '{"source":"test"}\n', 'utf8');
    await writeFile(reviewPath, '{truncated', 'utf8');
    const original = await readFile(reviewPath);
    const report = await doctorStore(storePath);
    const result = await quarantineIssues({
      storePath,
      report,
      now: () => new Date('2026-07-13T12:34:56.000Z'),
    });
    await expect(readFile(reviewPath)).resolves.toEqual(original);
    await expect(
      readFile(path.join(result.quarantinePath, 'files', 'entities', 'reviews', 'review_01.json')),
    ).resolves.toEqual(original);
    await expect(
      readFile(
        path.join(result.quarantinePath, 'files', 'entities', 'reviews', 'review_01.metadata.json'),
      ),
    ).resolves.toBeDefined();
    const savedReport = JSON.parse(await readFile(result.reportPath, 'utf8')) as {
      classification: string;
      files: Array<{ checksum: string }>;
    };
    expect(savedReport.classification).toBe('requires-restore');
    expect(savedReport.files[0]!.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});
