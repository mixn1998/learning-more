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
});
