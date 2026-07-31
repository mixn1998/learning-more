import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createBackup } from './backup.js';
import { restoreStore, type RestoreFaultPoint } from './restore.js';
import { SchemaRegistry, type StoreMigration } from './schema-registry.js';
import { verifyStore } from './verify-store.js';

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
  const root = await mkdtemp(path.join(os.tmpdir(), 'learning-more-restore-'));
  roots.push(root);
  const storeRoot = path.join(root, 'data');
  const activeStorePath = path.join(storeRoot, 'stores', 'current');
  const backupRoot = path.join(root, 'backups');
  await mkdir(path.join(activeStorePath, 'entities', 'courses'), { recursive: true });
  await mkdir(path.join(activeStorePath, 'read-models'), { recursive: true });
  await mkdir(path.join(activeStorePath, 'indexes'), { recursive: true });
  await writeFile(
    path.join(activeStorePath, 'store.json'),
    `${JSON.stringify({
      storeId: 'store_01',
      formatVersion: 1,
      minimumReaderVersion: 1,
      createdAt: '2026-07-13T00:00:00.000Z',
      lastCommittedTransactionId: 'tx_01',
      lastCommittedSequence: 1,
      timezone: 'Asia/Shanghai',
      checksumAlgorithm: 'sha256',
    })}\n`,
    'utf8',
  );
  const data = { courseId: 'course_01', title: 'Learning MORE' };
  await writeFile(
    path.join(activeStorePath, 'entities', 'courses', 'course_01.json'),
    `${JSON.stringify({ schemaVersion: 1, data, contentSha256: checksum(data) })}\n`,
    'utf8',
  );
  await writeFile(path.join(activeStorePath, 'read-models', 'history.json'), '{}\n', 'utf8');
  await writeFile(
    path.join(storeRoot, 'active-store.json'),
    `${JSON.stringify({ relativePath: 'stores/current', generation: 4, updatedAt: '2026-07-13T00:00:00.000Z' })}\n`,
    'utf8',
  );
  const backup = await createBackup({
    storePath: activeStorePath,
    backupRoot,
    buildId: 'test-build',
    trigger: 'manual',
    now: () => new Date('2026-07-13T01:00:00.000Z'),
  });
  return { root, storeRoot, activeStorePath, backupRoot, backup };
}

async function activePath(storeRoot: string): Promise<string> {
  const pointer = JSON.parse(await readFile(path.join(storeRoot, 'active-store.json'), 'utf8')) as {
    relativePath: string;
  };
  return path.resolve(storeRoot, pointer.relativePath);
}

describe('whole-store restore', () => {
  it('reconstructs a new verified store, resets derived views, switches atomically, and preserves the fault copy', async () => {
    const { storeRoot, activeStorePath, backupRoot, backup } = await fixture();
    const authoritative = path.join(activeStorePath, 'entities', 'courses', 'course_01.json');
    await writeFile(authoritative, '{truncated', 'utf8');
    const corrupted = await readFile(authoritative);
    const result = await restoreStore({
      storeRoot,
      backupRoot,
      backupId: backup.manifest.backupId,
      targetVersion: 1,
      readerVersion: 1,
      registry: new SchemaRegistry([]),
      now: () => new Date('2026-07-13T02:00:00.000Z'),
    });
    expect(result.previousStorePath).toBe(activeStorePath);
    expect(result.activeStorePath).not.toBe(activeStorePath);
    await expect(verifyStore(result.activeStorePath)).resolves.toMatchObject({
      status: 'verified',
    });
    await expect(readFile(authoritative)).resolves.toEqual(corrupted);
    await expect(stat(path.join(result.activeStorePath, 'read-models'))).resolves.toBeDefined();
    const pointer = JSON.parse(
      await readFile(path.join(storeRoot, 'active-store.json'), 'utf8'),
    ) as { generation: number };
    expect(pointer.generation).toBe(5);
  });

  it.each<RestoreFaultPoint>([
    'candidate_restored',
    'candidate_verified',
    'before_pointer_switch',
    'after_pointer_switch',
  ])('leaves the active pointer on a complete verified store after a %s crash', async (fault) => {
    const { storeRoot, activeStorePath, backupRoot, backup } = await fixture();
    await expect(
      restoreStore({
        storeRoot,
        backupRoot,
        backupId: backup.manifest.backupId,
        targetVersion: 1,
        readerVersion: 1,
        registry: new SchemaRegistry([]),
        faultInjector(point) {
          if (point === fault) throw new Error('simulated_crash');
        },
      }),
    ).rejects.toThrow('simulated_crash');
    const active = await activePath(storeRoot);
    expect(
      fault === 'after_pointer_switch' ? active !== activeStorePath : active === activeStorePath,
    ).toBe(true);
    await expect(verifyStore(active)).resolves.toMatchObject({ status: 'verified' });
  });

  it('rejects a missing backup object before switching or modifying the active store', async () => {
    const { storeRoot, activeStorePath, backupRoot, backup } = await fixture();
    const object = backup.manifest.objects[0]!;
    await rm(
      path.join(backupRoot, 'objects', 'sha256', object.checksum.slice(0, 2), object.checksum),
    );
    await expect(
      restoreStore({
        storeRoot,
        backupRoot,
        backupId: backup.manifest.backupId,
        targetVersion: 1,
        readerVersion: 1,
        registry: new SchemaRegistry([]),
      }),
    ).rejects.toThrow('restore_backup_invalid');
    expect(await activePath(storeRoot)).toBe(activeStorePath);
  });

  it('recovers a pending post-switch journal idempotently on the next restore', async () => {
    const { storeRoot, backupRoot, backup } = await fixture();
    await expect(
      restoreStore({
        storeRoot,
        backupRoot,
        backupId: backup.manifest.backupId,
        targetVersion: 1,
        readerVersion: 1,
        registry: new SchemaRegistry([]),
        faultInjector(point) {
          if (point === 'after_pointer_switch') throw new Error('simulated_crash');
        },
      }),
    ).rejects.toThrow('simulated_crash');
    const recovered = await restoreStore({
      storeRoot,
      backupRoot,
      backupId: backup.manifest.backupId,
      targetVersion: 1,
      readerVersion: 1,
      registry: new SchemaRegistry([]),
    });
    await expect(verifyStore(recovered.activeStorePath)).resolves.toMatchObject({
      status: 'verified',
    });
    const pointer = JSON.parse(
      await readFile(path.join(storeRoot, 'active-store.json'), 'utf8'),
    ) as { generation: number };
    expect(pointer.generation).toBe(6);
    await expect(
      readFile(path.join(storeRoot, 'maintenance', 'restore-journal.json'), 'utf8'),
    ).resolves.toContain('"state":"complete"');
  });

  it('runs a supported migration on the restored candidate before switching', async () => {
    const { storeRoot, backupRoot, backup } = await fixture();
    const migration: StoreMigration<unknown, unknown> = {
      name: 'v1-to-v2',
      fromVersion: 1,
      toVersion: 2,
      preconditions: () => [],
      transform: (value) => ({ ...(value as object), formatVersion: 2, minimumReaderVersion: 2 }),
      postconditions: () => [],
    };
    const result = await restoreStore({
      storeRoot,
      backupRoot,
      backupId: backup.manifest.backupId,
      targetVersion: 2,
      readerVersion: 2,
      registry: new SchemaRegistry([migration]),
    });
    await expect(
      verifyStore(result.activeStorePath, { supportedVersions: [2] }),
    ).resolves.toMatchObject({ status: 'verified', storeVersion: 2 });
  });
});
