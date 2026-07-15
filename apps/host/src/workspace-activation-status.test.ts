import { describe, expect, it } from 'vitest';

import { parseWorkspaceActivationStatus } from './workspace-activation-status.js';

describe('workspace activation status protocol', () => {
  it('rejects undeclared fields instead of persisting diagnostic details', () => {
    expect(
      parseWorkspaceActivationStatus({
        schemaVersion: 2,
        requestId: 'request-01',
        phase: 'failed',
        attempt: 2,
        errorCode: 'candidate_build_failed',
        errorStage: 'building',
        startedAt: '2026-07-16T00:00:00.000Z',
        updatedAt: '2026-07-16T00:01:00.000Z',
        completedAt: '2026-07-16T00:01:00.000Z',
        stack: 'D:\\private\\workspace',
      }),
    ).toBeUndefined();
  });
});
