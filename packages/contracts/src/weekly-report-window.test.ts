import { describe, expect, it } from 'vitest';

import { completedWeeklyReportWindow, nextWeeklyReportBoundary } from './weekly-report-window.js';

describe('weekly report window', () => {
  it('selects the last complete Sunday-to-Sunday window in Asia/Shanghai', () => {
    expect(
      completedWeeklyReportWindow(new Date('2026-07-16T04:00:00.000Z'), 'Asia/Shanghai'),
    ).toEqual({
      localWeekKey: '2026-W28',
      startLocalDate: '2026-07-05',
      endLocalDate: '2026-07-12',
    });
  });

  it('resolves the next Sunday midnight as an exact instant', () => {
    expect(
      nextWeeklyReportBoundary(new Date('2026-07-11T15:59:30.000Z'), 'Asia/Shanghai').toISOString(),
    ).toBe('2026-07-11T16:00:00.000Z');
    expect(
      nextWeeklyReportBoundary(new Date('2026-07-11T16:00:00.000Z'), 'Asia/Shanghai').toISOString(),
    ).toBe('2026-07-18T16:00:00.000Z');
  });
});
