import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { backupCommand } from '../commands/backup.js';
import { createBackup, verifyBackup } from './backup.js';
import type { BackupManifest } from './backup-manifest.js';
import {
  applyBackupRetention,
  resumeBackupRetention,
  selectBackupsForRetention,
  shouldCreateAutomaticBackup,
} from './retention.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'learning-more-backup-'));
  roots.push(root);
  const storePath = path.join(root, 'store');
  const backupRoot = path.join(root, 'backups');
  await mkdir(path.join(storePath, 'courses'), { recursive: true });
  await mkdir(path.join(storePath, 'read-models'), { recursive: true });
  await mkdir(path.join(storePath, 'indexes'), { recursive: true });
  await mkdir(path.join(storePath, 'transactions'), { recursive: true });
  await mkdir(path.join(storePath, 'secrets'), { recursive: true });
  await mkdir(path.join(storePath, 'runtime'), { recursive: true });
  await writeFile(
    path.join(storePath, 'store.json'),
    `${JSON.stringify({
      storeId: 'store_01',
      formatVersion: 1,
      minimumReaderVersion: 1,
      createdAt: '2026-07-13T00:00:00.000Z',
      lastCommittedTransactionId: 'tx_02',
      lastCommittedSequence: 2,
      timezone: 'Asia/Shanghai',
      checksumAlgorithm: 'sha256',
    })}\n`,
    'utf8',
  );
  await writeFile(path.join(storePath, 'courses', 'course-01.md'), '# Course 01\n', 'utf8');
  await writeFile(path.join(storePath, 'read-models', 'history.json'), '{}\n', 'utf8');
  await writeFile(path.join(storePath, 'indexes', 'courses.json'), '{}\n', 'utf8');
  await writeFile(path.join(storePath, 'transactions', 'pending.json'), '{}\n', 'utf8');
  await writeFile(path.join(storePath, 'secrets', 'provider-key.txt'), 'must-not-leak', 'utf8');
  await writeFile(path.join(storePath, 'runtime', 'server.log'), 'must-not-leak', 'utf8');
  return { root, storePath, backupRoot };
}

function manifest(input: Partial<BackupManifest> & Pick<BackupManifest, 'backupId' | 'createdAt'>) {
  return {
    storeId: 'store_01',
    schemaVersion: 1,
    sourceCheckpoint: { transactionId: '', sequence: 0 },
    objects: [],
    buildId: 'test',
    status: 'complete',
    verificationStatus: 'verified',
    trigger: 'automatic',
    ...input,
  } satisfies BackupManifest;
}

describe('consistent verified backups', () => {
  it('waits for the store write lease and excludes derived, secret, runtime, and temporary data', async () => {
    const { storePath, backupRoot } = await fixture();
    await mkdir(path.join(storePath, 'locks'), { recursive: true });
    const lockPath = path.join(storePath, 'locks', 'store-write.lock');
    await writeFile(lockPath, '{}\n', 'utf8');
    const release = setTimeout(() => void unlink(lockPath), 100);
    const result = await createBackup({
      storePath,
      backupRoot,
      buildId: 'test-build',
      trigger: 'manual',
    });
    clearTimeout(release);
    expect(result.manifest.sourceCheckpoint).toEqual({ transactionId: 'tx_02', sequence: 2 });
    expect(result.manifest.objects.map((object) => object.relativePath)).toEqual([
      'courses/course-01.md',
      'store.json',
    ]);
    await expect(verifyBackup(backupRoot, result.manifest.backupId)).resolves.toEqual({
      status: 'verified',
      issues: [],
    });
  });

  it('does not publish a complete manifest when object copying crashes', async () => {
    const { storePath, backupRoot } = await fixture();
    await expect(
      createBackup({
        storePath,
        backupRoot,
        buildId: 'test-build',
        trigger: 'manual',
        faultInjector(point) {
          if (point === 'object_copied') throw new Error('simulated_crash');
        },
      }),
    ).rejects.toThrow('simulated_crash');
    await expect(readdir(path.join(backupRoot, 'manifests'))).resolves.toEqual([]);
    expect(await readdir(path.join(backupRoot, 'partial'))).toHaveLength(1);
  });

  it('releases the write lease after a point-in-time snapshot and ignores later appends', async () => {
    const { storePath, backupRoot } = await fixture();
    const eventDirectory = path.join(storePath, 'events');
    const eventPath = path.join(eventDirectory, 'learning.ndjson');
    const checkpointContent = '{"sequence":1}\n';
    await mkdir(eventDirectory, { recursive: true });
    await writeFile(eventPath, checkpointContent, 'utf8');
    const result = await createBackup({
      storePath,
      backupRoot,
      buildId: 'test-build',
      trigger: 'manual',
      async faultInjector(point) {
        if (point === 'manifest_partial') await appendFile(eventPath, '{"sequence":2}\n', 'utf8');
      },
    });
    const eventObject = result.manifest.objects.find(
      (object) => object.relativePath === 'events/learning.ndjson',
    )!;
    expect(eventObject.size).toBe(Buffer.byteLength(checkpointContent));
    const backedUp = await readFile(
      path.join(
        backupRoot,
        'objects',
        'sha256',
        eventObject.checksum.slice(0, 2),
        eventObject.checksum,
      ),
      'utf8',
    );
    expect(backedUp).toBe(checkpointContent);
    await expect(readFile(eventPath, 'utf8')).resolves.toContain('"sequence":2');
  });

  it('allows a verified diagnostic snapshot of a corrupted source without claiming it is healthy', async () => {
    const { storePath, backupRoot } = await fixture();
    await writeFile(path.join(storePath, 'store.json'), '{truncated', 'utf8');
    await expect(
      createBackup({
        storePath,
        backupRoot,
        buildId: 'test-build',
        trigger: 'manual',
      }),
    ).rejects.toThrow('backup_source_invalid');
    const diagnostic = await createBackup({
      storePath,
      backupRoot,
      buildId: 'test-build',
      trigger: 'diagnostic',
    });
    expect(diagnostic.manifest).toMatchObject({ storeId: 'unknown', schemaVersion: 0 });
    await expect(verifyBackup(backupRoot, diagnostic.manifest.backupId)).resolves.toMatchObject({
      status: 'verified',
    });
  });

  it('rejects missing or corrupted objects and reuses verified content on the next backup', async () => {
    const { storePath, backupRoot } = await fixture();
    const first = await createBackup({
      storePath,
      backupRoot,
      buildId: 'test-build',
      trigger: 'manual',
    });
    const second = await createBackup({
      storePath,
      backupRoot,
      buildId: 'test-build',
      trigger: 'manual',
    });
    expect(first.copiedObjects).toBe(2);
    expect(second.copiedObjects).toBe(0);
    expect(second.reusedObjects).toBe(2);

    const object = first.manifest.objects[0]!;
    const objectPath = path.join(
      backupRoot,
      'objects',
      'sha256',
      object.checksum.slice(0, 2),
      object.checksum,
    );
    await writeFile(objectPath, 'corrupted', 'utf8');
    await expect(verifyBackup(backupRoot, first.manifest)).resolves.toMatchObject({
      status: 'invalid',
    });
    await rm(objectPath);
    await expect(verifyBackup(backupRoot, first.manifest)).resolves.toMatchObject({
      status: 'invalid',
      issues: expect.arrayContaining([expect.stringContaining('backup_object_missing')]),
    });
  });

  it('reports a machine-readable verified result through the CLI command seam', async () => {
    const { storePath, backupRoot } = await fixture();
    let output = '';
    const original = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stdout.write;
    try {
      await expect(backupCommand([storePath, backupRoot, '--verify', '--json'])).resolves.toBe(0);
    } finally {
      process.stdout.write = original;
    }
    expect(JSON.parse(output)).toMatchObject({ status: 'verified', copiedObjects: 2 });
  });
});

describe('backup triggers and retention', () => {
  it('requests the first run after the last verified backup becomes older than 24 hours', () => {
    expect(shouldCreateAutomaticBackup([], new Date('2026-07-13T12:00:00.000Z'))).toBe(true);
    expect(
      shouldCreateAutomaticBackup(
        [manifest({ backupId: 'recent', createdAt: '2026-07-12T13:00:00.000Z' })],
        new Date('2026-07-13T12:00:00.000Z'),
      ),
    ).toBe(false);
    expect(
      shouldCreateAutomaticBackup(
        [manifest({ backupId: 'old', createdAt: '2026-07-12T11:59:59.000Z' })],
        new Date('2026-07-13T12:00:00.000Z'),
      ),
    ).toBe(true);
  });

  it('never removes the final verified backup and preserves pre-upgrade snapshots', () => {
    const only = manifest({ backupId: 'only', createdAt: '2025-01-01T00:00:00.000Z' });
    expect(selectBackupsForRetention([only], new Date('2026-07-13T00:00:00.000Z'))).toEqual({
      keep: ['only'],
      remove: [],
    });

    const preUpgrade = manifest({
      backupId: 'upgrade',
      createdAt: '2025-01-01T00:00:00.000Z',
      trigger: 'pre-upgrade',
    });
    const latest = manifest({ backupId: 'latest', createdAt: '2026-07-13T00:00:00.000Z' });
    expect(
      selectBackupsForRetention([preUpgrade, latest], new Date('2026-07-13T00:00:00.000Z')),
    ).toMatchObject({ keep: expect.arrayContaining(['upgrade', 'latest']) });
  });

  it('keeps seven daily, four weekly, and six monthly recovery points', () => {
    const backups = Array.from({ length: 400 }, (_, index) =>
      manifest({
        backupId: `backup-${index}`,
        createdAt: new Date(Date.UTC(2026, 6, 13 - index)).toISOString(),
      }),
    );
    const decision = selectBackupsForRetention(backups, new Date('2026-07-13T12:00:00.000Z'));
    expect(decision.keep).toEqual(
      expect.arrayContaining([
        'backup-0',
        'backup-1',
        'backup-2',
        'backup-3',
        'backup-4',
        'backup-5',
        'backup-6',
        'backup-8',
        'backup-15',
        'backup-13',
        'backup-43',
        'backup-74',
        'backup-104',
        'backup-135',
      ]),
    );
    expect(decision.remove.length).toBeGreaterThan(0);
    expect(new Set([...decision.keep, ...decision.remove]).size).toBe(backups.length);
  });

  it('journals retention before deletion and resumes safely after a crash', async () => {
    const { storePath, backupRoot } = await fixture();
    const seed = await createBackup({
      storePath,
      backupRoot,
      buildId: 'test-build',
      trigger: 'manual',
      now: () => new Date('2026-07-13T00:00:00.000Z'),
    });
    for (let index = 1; index < 20; index += 1) {
      const backupId = `retention-fixture-${index}`;
      await writeFile(
        path.join(backupRoot, 'manifests', `${backupId}.json`),
        `${JSON.stringify({
          ...seed.manifest,
          backupId,
          createdAt: new Date(Date.UTC(2026, 6, 13 - index * 40)).toISOString(),
        })}\n`,
        'utf8',
      );
    }
    await expect(
      applyBackupRetention(backupRoot, new Date('2026-07-13T12:00:00.000Z'), (point) => {
        if (point === 'manifest_deleted') throw new Error('simulated_crash');
      }),
    ).rejects.toThrow('simulated_crash');
    const journalDirectory = path.join(backupRoot, 'retention-journals');
    const [journalName] = await readdir(journalDirectory);
    expect(
      JSON.parse(await readFile(path.join(journalDirectory, journalName!), 'utf8')),
    ).toMatchObject({ state: 'pending' });

    await resumeBackupRetention(backupRoot);
    expect(
      JSON.parse(await readFile(path.join(journalDirectory, journalName!), 'utf8')),
    ).toMatchObject({ state: 'complete' });
    expect((await readdir(path.join(backupRoot, 'manifests'))).length).toBeGreaterThan(0);
  });
});
