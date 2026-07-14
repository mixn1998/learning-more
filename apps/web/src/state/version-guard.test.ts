import { describe, expect, it } from 'vitest';

import { evaluateRuntimeVersion } from './version-guard.js';

const readiness = {
  status: 'ready',
  instanceId: 'instance_01',
  buildId: 'build_01',
  protocolVersion: '1',
  storeStatus: 'ready',
  projectionStatus: 'ready',
  providerStatus: 'ready',
} as const;

describe('runtime version guard', () => {
  it('blocks protocol mismatch and requires refresh for build mismatch', () => {
    expect(
      evaluateRuntimeVersion(readiness, { buildId: 'build_01', protocolVersion: '2' }),
    ).toEqual({ kind: 'protocol-mismatch', writesAllowed: false });
    expect(
      evaluateRuntimeVersion(readiness, { buildId: 'build_old', protocolVersion: '1' }),
    ).toEqual({ kind: 'build-mismatch', writesAllowed: false });
    expect(
      evaluateRuntimeVersion(readiness, { buildId: 'build_01', protocolVersion: '1' }),
    ).toEqual({ kind: 'compatible', writesAllowed: true });
  });

  it('releases only the verified recovered build when the protocol still matches', () => {
    expect(
      evaluateRuntimeVersion(
        readiness,
        { buildId: 'build_old', protocolVersion: '1' },
        { recoveredBuildId: 'build_01' },
      ),
    ).toEqual({ kind: 'compatible', writesAllowed: true });
    expect(
      evaluateRuntimeVersion(
        readiness,
        { buildId: 'build_old', protocolVersion: '1' },
        { recoveredBuildId: 'another_build' },
      ),
    ).toEqual({ kind: 'build-mismatch', writesAllowed: false });
    expect(
      evaluateRuntimeVersion(
        readiness,
        { buildId: 'build_old', protocolVersion: '2' },
        { recoveredBuildId: 'build_01' },
      ),
    ).toEqual({ kind: 'protocol-mismatch', writesAllowed: false });
  });
});
