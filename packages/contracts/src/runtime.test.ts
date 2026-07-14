import { describe, expect, it } from 'vitest';

import { LauncherControlStatusSchema, LauncherRuntimeStatusSchema } from './runtime.js';

describe('launcher runtime contracts', () => {
  it('accepts the public control status and write response shapes', () => {
    expect(
      LauncherControlStatusSchema.parse({
        state: 'healthy',
        crashCount: 0,
        capability: 'capability_01',
        capabilityExpiresAt: 1,
      }),
    ).toMatchObject({ state: 'healthy', capability: 'capability_01' });
    expect(LauncherRuntimeStatusSchema.parse({ state: 'restarting', crashCount: 2 })).toEqual({
      state: 'restarting',
      crashCount: 2,
    });
  });

  it('rejects undeclared states and malformed capabilities', () => {
    expect(() =>
      LauncherControlStatusSchema.parse({
        state: 'unknown',
        crashCount: 0,
        capability: '',
        capabilityExpiresAt: 0,
      }),
    ).toThrow();
  });
});
