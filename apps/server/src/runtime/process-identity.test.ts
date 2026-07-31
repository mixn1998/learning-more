import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { verifyProcessIdentity } from './process-identity.js';
import { resolveRuntimeConfig } from './runtime-config.js';
import { createRuntimeManifest, runtimeIdentityFingerprint } from './runtime-manifest.js';
import { createRuntimeManifestRepository } from './runtime-manifest-repository.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function identity() {
  const manifest = createRuntimeManifest({
    instanceId: 'instance_01',
    generation: 2,
    pid: 42,
    executable: 'C:\\Program Files\\nodejs\\node.exe',
    projectRoot: 'D:\\workspace\\Learning MORE',
    dataRoot: 'D:\\data\\learning-more',
    configFingerprint: 'a'.repeat(64),
    buildId: 'build_01',
    protocolVersion: '1',
    startedAt: '2026-07-13T00:00:00.000Z',
    healthUrl: 'http://127.0.0.1:43120/api/v1/runtime/ready',
  });
  return {
    manifest,
    observed: {
      instanceId: manifest.instanceId,
      generation: manifest.generation,
      pid: manifest.pid,
      portOwnerPid: manifest.pid,
      executable: manifest.executable,
      projectRoot: manifest.projectRoot,
      dataRootHash: manifest.dataRootHash,
      configFingerprint: manifest.configFingerprint,
      buildId: manifest.buildId,
      protocolVersion: manifest.protocolVersion,
      startedAt: manifest.startedAt,
      identityFingerprint: runtimeIdentityFingerprint(manifest),
    },
  };
}

describe('strict runtime process identity', () => {
  it('rejects every single-field mutation including PID reuse and foreign port ownership', () => {
    const { manifest, observed } = identity();
    expect(verifyProcessIdentity(manifest, observed)).toEqual({ healthy: true, mismatches: [] });
    const mutations: Array<[keyof typeof observed, unknown]> = [
      ['instanceId', 'instance_other'],
      ['generation', 3],
      ['pid', 99],
      ['portOwnerPid', 99],
      ['executable', 'C:\\foreign\\node.exe'],
      ['projectRoot', 'D:\\foreign'],
      ['dataRootHash', 'b'.repeat(64)],
      ['configFingerprint', 'b'.repeat(64)],
      ['buildId', 'build_other'],
      ['protocolVersion', '2'],
      ['startedAt', '2026-07-13T00:00:01.000Z'],
      ['identityFingerprint', 'c'.repeat(64)],
    ];
    for (const [field, value] of mutations) {
      const result = verifyProcessIdentity(manifest, { ...observed, [field]: value });
      expect(result.healthy, field).toBe(false);
      expect(result.mismatches, field).toContain(field);
    }
  });
});

describe('RuntimeConfigResolver', () => {
  it('uses CLI > environment > runtime file > defaults and rejects unknown file keys', () => {
    expect(
      resolveRuntimeConfig({
        cli: { providerId: 'cli-provider' },
        environment: {
          LEARNING_MORE_PROVIDER_ID: 'env-provider',
          LEARNING_MORE_SERVER_PORT: '43121',
        },
        file: { providerId: 'file-provider', serverPort: 43122, timezone: 'UTC' },
      }),
    ).toMatchObject({
      deploymentMode: 'local',
      providerId: 'cli-provider',
      serverPort: 43121,
      timezone: 'UTC',
    });
    expect(
      resolveRuntimeConfig({
        environment: { LEARNING_MORE_DEPLOYMENT_MODE: 'platform' },
      }).deploymentMode,
    ).toBe('platform');
    expect(() =>
      resolveRuntimeConfig({
        environment: { LEARNING_MORE_DEPLOYMENT_MODE: 'public' },
      }),
    ).toThrow();
    expect(() =>
      resolveRuntimeConfig({ file: { providerId: 'mock', unexpected: true } }),
    ).toThrow();
  });
});

describe('RuntimeManifestRepository', () => {
  it('atomically persists and only lets the same instance generation remove its manifest', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-runtime-manifest-'));
    roots.push(directory);
    const repository = createRuntimeManifestRepository(
      path.join(directory, 'runtime-manifest.json'),
    );
    const { manifest } = identity();
    await repository.write(manifest);
    await expect(repository.read()).resolves.toEqual(manifest);
    await expect(
      repository.remove({ instanceId: manifest.instanceId, generation: 99 }),
    ).resolves.toBe(false);
    await expect(repository.read()).resolves.toEqual(manifest);
    await expect(
      repository.remove({ instanceId: manifest.instanceId, generation: manifest.generation }),
    ).resolves.toBe(true);
    await expect(repository.read()).resolves.toBeUndefined();
  });
});
