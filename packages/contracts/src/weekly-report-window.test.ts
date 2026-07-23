import { describe, expect, it } from 'vitest';

import {
  completedWeeklyReportWindow,
  currentLocalWeekdayCycleDate,
  nextLocalWeekdayBoundary,
  nextWeeklyReportBoundary,
  weeklyReportWindowForKey,
} from './weekly-report-window.js';

describe('weekly report window', () => {
  it('selects the last complete Monday-to-Monday window in Asia/Shanghai', () => {
    expect(
      completedWeeklyReportWindow(new Date('2026-07-16T04:00:00.000Z'), 'Asia/Shanghai'),
    ).toEqual({
      localWeekKey: '2026-W28',
      startLocalDate: '2026-07-06',
      endLocalDate: '2026-07-13',
    });

    expect(
      completedWeeklyReportWindow(new Date('2026-07-20T04:00:00.000Z'), 'Asia/Shanghai'),
    ).toEqual({
      localWeekKey: '2026-W29',
      startLocalDate: '2026-07-13',
      endLocalDate: '2026-07-20',
    });
  });

  it('resolves the next Monday midnight as an exact instant', () => {
    expect(
      nextWeeklyReportBoundary(new Date('2026-07-19T15:59:30.000Z'), 'Asia/Shanghai').toISOString(),
    ).toBe('2026-07-19T16:00:00.000Z');
    expect(
      nextWeeklyReportBoundary(new Date('2026-07-19T16:00:00.000Z'), 'Asia/Shanghai').toISOString(),
    ).toBe('2026-07-26T16:00:00.000Z');
  });

  it('derives the canonical Monday-to-Monday window from every valid ISO week key', () => {
    expect(weeklyReportWindowForKey('2026-W28')).toEqual({
      localWeekKey: '2026-W28',
      startLocalDate: '2026-07-06',
      endLocalDate: '2026-07-13',
    });
    expect(weeklyReportWindowForKey('2026-W53')).toEqual({
      localWeekKey: '2026-W53',
      startLocalDate: '2026-12-28',
      endLocalDate: '2027-01-04',
    });
    expect(() => weeklyReportWindowForKey('2026-W54')).toThrow(
      'weekly_report_week_key_invalid:2026-W54',
    );
  });

  it('resolves Saturday portrait cycles and their next local-midnight boundary', () => {
    expect(
      currentLocalWeekdayCycleDate(new Date('2026-07-17T15:59:30.000Z'), 'Asia/Shanghai', 6),
    ).toBe('2026-07-11');
    expect(
      nextLocalWeekdayBoundary(
        new Date('2026-07-17T15:59:30.000Z'),
        'Asia/Shanghai',
        6,
      ).toISOString(),
    ).toBe('2026-07-17T16:00:00.000Z');
    expect(
      currentLocalWeekdayCycleDate(new Date('2026-07-17T16:00:00.000Z'), 'Asia/Shanghai', 6),
    ).toBe('2026-07-18');
    expect(
      nextLocalWeekdayBoundary(
        new Date('2026-07-17T16:00:00.000Z'),
        'Asia/Shanghai',
        6,
      ).toISOString(),
    ).toBe('2026-07-24T16:00:00.000Z');
  });
});
