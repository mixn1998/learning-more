import { describe, expect, it } from 'vitest';

import { latestLearningActivityAt } from './home-dashboard.js';

describe('home dashboard activity projection', () => {
  it('uses the latest ended or active interval timestamp', () => {
    expect(
      latestLearningActivityAt([
        {
          id: 'interval_01',
          sessionId: 'session_01',
          startedAt: '2026-07-12T09:00:00.000Z',
          endedAt: '2026-07-12T09:30:00.000Z',
          endReason: 'paused',
          recovered: false,
        },
        {
          id: 'interval_02',
          sessionId: 'session_02',
          startedAt: '2026-07-12T12:30:00.000Z',
          recovered: false,
        },
      ]),
    ).toBe('2026-07-12T12:30:00.000Z');
  });

  it('returns undefined when no learning interval exists', () => {
    expect(latestLearningActivityAt([])).toBeUndefined();
  });
});
