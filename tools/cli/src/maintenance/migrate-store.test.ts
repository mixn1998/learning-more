import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { migrateStore, type MigrationFaultPoint } from './migrate-store.js';
import { SchemaRegistry, type StoreMigration } from './schema-registry.js';
import { verifyStore } from './verify-store.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function checksum(root: string): Promise<string> {
  const hash = createHash('sha256');
  const visit = async (directory: string) => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else hash.update(path.relative(root, absolute)).update(await readFile(absolute));
    }
  };
  await visit(root);
  return hash.digest('hex');
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'learning-more-migration-'));
  roots.push(root);
  const active = path.join(root, 'stores', 'store-v1');
  await mkdir(path.join(active, 'read-models'), { recursive: true });
  await mkdir(path.join(active, 'indexes'), { recursive: true });
  await writeFile(
    path.join(active, 'store.json'),
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
  await writeFile(
    path.join(root, 'active-store.json'),
    `${JSON.stringify({ relativePath: 'stores/store-v1', generation: 1, updatedAt: '2026-07-13T00:00:00.000Z' })}\n`,
    'utf8',
  );
  return { root, active };
}

const migration: StoreMigration<unknown, unknown> = {
  name: 'v1-to-v2',
  fromVersion: 1,
  toVersion: 2,
  preconditions: () => [],
  transform: (input) => ({ ...(input as object), formatVersion: 2, minimumReaderVersion: 2 }),
  postconditions: () => [],
};

describe('safe store migration', () => {
  it('builds and verifies a sibling store before atomically switching the pointer', async () => {
    const { root, active } = await fixture();
    const original = await checksum(active);
    const result = await migrateStore({
      storeRoot: root,
      targetVersion: 2,
      readerVersion: 2,
      registry: new SchemaRegistry([migration]),
    });
    expect(result.previousStorePath).toBe(active);
    expect(await checksum(active)).toBe(original);
    await expect(
      verifyStore(result.activeStorePath, { supportedVersions: [2] }),
    ).resolves.toMatchObject({
      status: 'verified',
      storeVersion: 2,
    });
    expect(
      (
        JSON.parse(await readFile(path.join(root, 'active-store.json'), 'utf8')) as {
          generation: number;
        }
      ).generation,
    ).toBe(2);
  });

  it.each<MigrationFaultPoint>(['candidate_copied', 'transformed', 'verified'])(
    'keeps the original pointer and checksum after a %s crash',
    async (fault) => {
      const { root, active } = await fixture();
      const original = await checksum(active);
      await expect(
        migrateStore({
          storeRoot: root,
          targetVersion: 2,
          readerVersion: 2,
          registry: new SchemaRegistry([migration]),
          faultInjector(point) {
            if (point === fault) throw new Error('simulated_crash');
          },
        }),
      ).rejects.toThrow('simulated_crash');
      expect(await checksum(active)).toBe(original);
      expect(
        (
          JSON.parse(await readFile(path.join(root, 'active-store.json'), 'utf8')) as {
            relativePath: string;
          }
        ).relativePath,
      ).toBe('stores/store-v1');
    },
  );

  it('rejects missing paths, downgrades, and future versions without touching the store', async () => {
    const { root, active } = await fixture();
    const original = await checksum(active);
    await expect(
      migrateStore({
        storeRoot: root,
        targetVersion: 2,
        readerVersion: 2,
        registry: new SchemaRegistry([]),
      }),
    ).rejects.toThrow('migration_path_missing');
    await expect(
      migrateStore({
        storeRoot: root,
        targetVersion: 0,
        readerVersion: 2,
        registry: new SchemaRegistry([migration]),
      }),
    ).rejects.toThrow('migration_downgrade_forbidden');
    const futureFixture = await fixture();
    const futureRoot = futureFixture.root;
    const futureActive = path.join(futureFixture.active, 'store.json');
    const future = JSON.parse(await readFile(futureActive, 'utf8')) as Record<string, unknown>;
    await writeFile(futureActive, `${JSON.stringify({ ...future, formatVersion: 99 })}\n`, 'utf8');
    await expect(
      migrateStore({
        storeRoot: futureRoot,
        targetVersion: 100,
        readerVersion: 2,
        registry: new SchemaRegistry([]),
      }),
    ).rejects.toThrow('store_version_unsupported');
    expect(await checksum(active)).toBe(original);
  });
});
