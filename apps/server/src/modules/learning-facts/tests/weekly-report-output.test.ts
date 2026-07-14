import { describe, expect, it } from 'vitest';

import { validateWeeklyReportMarkdown } from '../implementation/weekly-report-output.js';

describe('validateWeeklyReportMarkdown', () => {
  it('accepts flexible Markdown when each concrete claim cites the frozen snapshot', () => {
    expect(
      validateWeeklyReportMarkdown(
        '## A useful pattern\n\nThe learner completed one lesson. <!-- sources:fact:completed -->\n\n> This does not prove mastery. <!-- sources:fact:review -->',
        new Set(['fact:completed', 'fact:review']),
      ),
    ).toEqual({ sourceRefs: ['fact:completed', 'fact:review'] });
  });

  it('rejects uncited claims, unsupported refs, and runtime telemetry', () => {
    expect(() =>
      validateWeeklyReportMarkdown('A concrete but uncited claim.', new Set(['fact:one'])),
    ).toThrow('weekly_report_claim_missing_source');
    expect(() =>
      validateWeeklyReportMarkdown(
        'A claim. <!-- sources:fact:invented -->',
        new Set(['fact:one']),
      ),
    ).toThrow('weekly_report_source_unsupported:fact:invented');
    expect(() => validateWeeklyReportMarkdown('taskId was slow.', new Set())).toThrow(
      'weekly_report_telemetry_forbidden',
    );
  });

  it('allows an explicit insufficient-evidence statement without inventing a citation', () => {
    expect(
      validateWeeklyReportMarkdown(
        '## This week\n\nInsufficient evidence to infer a stable change.',
        new Set(),
      ),
    ).toEqual({ sourceRefs: [] });
  });
});
