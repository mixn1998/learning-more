import { describe, expect, it } from 'vitest';

import {
  observeExistingRuntime,
  parseRuntimeManifest,
  runtimeIdentityFingerprint,
  type RuntimeManifest,
} from './runtime-observer.js';

const manifest: RuntimeManifest = {
  instanceId: 'instance_01',
  generation: 2,
  pid: 43_120,
  executable: 'C:\\Program Files\\nodejs\\node.exe',
  projectRoot: 'D:\\workspace\\Learning MORE',
  dataRootHash: 'a'.repeat(64),
  configFingerprint: 'b'.repeat(64),
  buildId: 'build_01',
  protocolVersion: '1',
  startedAt: '2026-07-13T00:00:00.000Z',
  healthUrl: 'http://127.0.0.1:43120/api/v1/runtime/ready',
};

const readiness = {
  status: 'ready',
  instanceId: manifest.instanceId,
  generation: manifest.generation,
  startedAt: manifest.startedAt,
  identityFingerprint: runtimeIdentityFingerprint(manifest),
  buildId: manifest.buildId,
  protocolVersion: manifest.protocolVersion,
};

describe('Launcher runtime observer', () => {
  it('strictly parses manifests and rejects unknown fields', () => {
    expect(parseRuntimeManifest(manifest)).toEqual(manifest);
    expect(() => parseRuntimeManifest({ ...manifest, secret: 'must-not-pass' })).toThrow(
      'runtime_manifest_invalid',
    );
  });
  it('only reuses a runtime when port, executable, manifest, and public identity all match', () => {
    expect(
      observeExistingRuntime({
        manifest,
        portOwnerPid: manifest.pid,
        processExecutable: manifest.executable,
        readiness,
      }),
    ).toEqual({
      configValid: true,
      storeState: 'ready',
      manifestState: 'valid',
      processState: 'verified_owned',
      portState: 'owned_by_manifest',
      healthState: 'identity_verified',
    });
  });

  it('classifies an unknown port owner as external and never reusable', () => {
    expect(
      observeExistingRuntime({
        manifest,
        portOwnerPid: manifest.pid + 1,
        processExecutable: manifest.executable,
        readiness,
      }),
    ).toMatchObject({
      processState: 'foreign_or_reused_pid',
      portState: 'foreign_owner',
      healthState: 'identity_mismatch',
    });
  });

  it.each([
    ['projectRoot', 'D:\\foreign'],
    ['dataRootHash', 'c'.repeat(64)],
    ['configFingerprint', 'd'.repeat(64)],
    ['buildId', 'build_other'],
    ['protocolVersion', '2'],
  ] as const)('rejects a manifest with mutated %s', (field, value) => {
    expect(
      observeExistingRuntime({
        manifest: { ...manifest, [field]: value },
        portOwnerPid: manifest.pid,
        processExecutable: manifest.executable,
        readiness,
      }).healthState,
    ).toBe('identity_mismatch');
  });

  it('treats a manifest with no live port as stale and safe to quarantine', () => {
    expect(observeExistingRuntime({ manifest })).toMatchObject({
      manifestState: 'stale',
      processState: 'missing',
      portState: 'free',
      healthState: 'unreachable',
    });
  });
});
