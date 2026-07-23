import { describe, expect, it } from 'vitest';

import {
  LauncherControlStatusSchema,
  LauncherRuntimeStatusSchema,
  WebBuildMetaSchema,
  WorkspaceActivationProgressSchema,
} from './runtime.js';

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

  it('accepts terminal activation progress and served web identity', () => {
    const activation = WorkspaceActivationProgressSchema.parse({
      schemaVersion: 2,
      requestId: 'request_01',
      phase: 'failed',
      sourceBuildId: 'build_new',
      activeBuildId: 'build_old',
      targetBuildId: 'build_new',
      attempt: 2,
      errorCode: 'candidate_build_failed',
      errorStage: 'building',
      startedAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:01:00.000Z',
      completedAt: '2026-07-16T00:01:00.000Z',
    });

    expect(
      LauncherRuntimeStatusSchema.parse({
        state: 'activation_failed',
        crashCount: 0,
        targetBuildId: 'build_new',
        activation,
      }),
    ).toMatchObject({ state: 'activation_failed', activation: { attempt: 2 } });
    expect(
      WebBuildMetaSchema.parse({
        schemaVersion: 1,
        buildId: 'build_new',
        protocolVersion: '1',
      }),
    ).toEqual({ schemaVersion: 1, buildId: 'build_new', protocolVersion: '1' });
  });

  it('rejects activation details and served web metadata with undeclared fields', () => {
    expect(() =>
      WebBuildMetaSchema.parse({
        schemaVersion: 1,
        buildId: 'build_new',
        protocolVersion: '1',
        absolutePath: 'D:/secret',
      }),
    ).toThrow();
  });
});
