import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { doctorStore, type DoctorClassification } from '../../tools/cli/src/maintenance/doctor.js';
import { quarantineIssues } from '../../tools/cli/src/maintenance/quarantine.js';

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
  const storePath = await mkdtemp(path.join(os.tmpdir(), 'learning-more-full-fault-'));
  roots.push(storePath);
  for (const relative of [
    'entities/reviews',
    'read-models',
    'indexes',
    'events/segments',
    'outbox/receipts',
  ]) {
    await mkdir(path.join(storePath, relative), { recursive: true });
  }
  const manifest = {
    storeId: 'store_fault_matrix',
    formatVersion: 1,
    minimumReaderVersion: 1,
    createdAt: '2026-07-13T00:00:00.000Z',
    lastCommittedTransactionId: '',
    lastCommittedSequence: 0,
    timezone: 'Asia/Shanghai',
    checksumAlgorithm: 'sha256',
  };
  await writeFile(path.join(storePath, 'store.json'), `${JSON.stringify(manifest)}\n`, 'utf8');
  const reviewData = { reviewId: 'review_01', state: 'final' };
  const reviewPath = path.join(storePath, 'entities', 'reviews', 'review_01.json');
  await writeFile(
    reviewPath,
    `${JSON.stringify({ schemaVersion: 1, data: reviewData, contentSha256: checksum(reviewData) })}\n`,
    'utf8',
  );
  return { storePath, reviewPath, manifest };
}

type Fault = Readonly<{
  name: string;
  expected: DoctorClassification;
  inject(input: Awaited<ReturnType<typeof fixture>>): Promise<string>;
}>;

const faults: readonly Fault[] = [
  {
    name: 'derived projection truncation',
    expected: 'repairable-derived',
    async inject({ storePath }) {
      const target = path.join(storePath, 'read-models', 'history.json');
      await writeFile(target, '{truncated', 'utf8');
      return target;
    },
  },
  {
    name: 'authoritative JSON truncation',
    expected: 'requires-restore',
    async inject({ reviewPath }) {
      await writeFile(reviewPath, '{truncated', 'utf8');
      return reviewPath;
    },
  },
  {
    name: 'immutable final Review checksum tamper',
    expected: 'requires-restore',
    async inject({ reviewPath }) {
      const review = JSON.parse(await readFile(reviewPath, 'utf8')) as Record<string, unknown>;
      await writeFile(
        reviewPath,
        `${JSON.stringify({ ...review, contentSha256: `sha256:${'0'.repeat(64)}` })}\n`,
        'utf8',
      );
      return reviewPath;
    },
  },
  {
    name: 'unsupported future store schema',
    expected: 'unsupported',
    async inject({ storePath, manifest }) {
      const target = path.join(storePath, 'store.json');
      await writeFile(target, `${JSON.stringify({ ...manifest, formatVersion: 99 })}\n`, 'utf8');
      return target;
    },
  },
  {
    name: 'missing immutable artifact reference',
    expected: 'requires-restore',
    async inject({ reviewPath }) {
      const data = { reviewId: 'review_01', state: 'final', artifactRef: 'artifact_missing' };
      await writeFile(
        reviewPath,
        `${JSON.stringify({ schemaVersion: 1, data, contentSha256: checksum(data) })}\n`,
        'utf8',
      );
      return reviewPath;
    },
  },
  {
    name: 'incomplete event tail',
    expected: 'requires-restore',
    async inject({ storePath }) {
      const target = path.join(storePath, 'events', 'segments', '00000001.ndjson');
      await writeFile(target, '{"payload":', 'utf8');
      return target;
    },
  },
  {
    name: 'event middle gap against high-water index',
    expected: 'requires-restore',
    async inject({ storePath }) {
      const events = [{ id: 'event_01' }, { id: 'event_02' }];
      const target = path.join(storePath, 'events', 'segments', '00000001.ndjson');
      await writeFile(
        target,
        `${JSON.stringify({ payload: events[1], checksum: checksum(events[1]) })}\n`,
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
      return target;
    },
  },
  {
    name: 'outbox receipt without authoritative event',
    expected: 'requires-restore',
    async inject({ storePath }) {
      const target = path.join(storePath, 'outbox', 'receipts', 'event_01.json');
      await writeFile(target, '{"schemaVersion":1,"eventId":"event_01"}\n', 'utf8');
      return target;
    },
  },
];

describe('full release fault matrix', () => {
  it.each(faults)(
    '$name is classified conservatively and never repaired in place',
    async (fault) => {
      const input = await fixture();
      const target = await fault.inject(input);
      const before = await readFile(target);
      const report = await doctorStore(input.storePath);
      expect(report.classification).toBe(fault.expected);
      expect(report.writeProtectionRequired).toBe(true);
      await expect(readFile(target)).resolves.toEqual(before);

      if (fault.expected === 'requires-restore') {
        const quarantine = await quarantineIssues({
          storePath: input.storePath,
          report,
          now: () => new Date('2026-07-13T12:00:00.000Z'),
        });
        await expect(readFile(quarantine.reportPath, 'utf8')).resolves.toContain(
          'requires-restore',
        );
        await expect(readFile(target)).resolves.toEqual(before);
      }
    },
  );
});
