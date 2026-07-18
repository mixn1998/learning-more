import { describe, expect, it } from 'vitest';

import {
  EMPTY_WEEKLY_REPORT_MARKDOWN,
  validateWeeklyReportMarkdown,
  weeklyReportMarkdownForRead,
} from '../implementation/weekly-report-output.js';

describe('validateWeeklyReportMarkdown', () => {
  it('accepts flexible Markdown when each concrete claim cites the frozen snapshot', () => {
    expect(
      validateWeeklyReportMarkdown(
        '## 一个有用的变化\n\n学习者完成了一节课。 <!-- sources:fact:completed -->\n\n> 这还不能证明已经掌握。 <!-- sources:fact:review -->',
        new Set(['fact:completed', 'fact:review']),
      ),
    ).toEqual({ sourceRefs: ['fact:completed', 'fact:review'] });
  });

  it('rejects uncited claims, unsupported refs, and runtime telemetry', () => {
    expect(() =>
      validateWeeklyReportMarkdown('一个具体但没有引用的判断。', new Set(['fact:one'])),
    ).toThrow('weekly_report_claim_missing_source');
    expect(() =>
      validateWeeklyReportMarkdown(
        '一个判断。 <!-- sources:fact:invented -->',
        new Set(['fact:one']),
      ),
    ).toThrow('weekly_report_source_unsupported:fact:invented');
    expect(() => validateWeeklyReportMarkdown('本次 taskId 响应很慢。', new Set())).toThrow(
      'weekly_report_telemetry_forbidden',
    );
  });

  it('requires user-visible weekly reports to be written in Simplified Chinese', () => {
    expect(() =>
      validateWeeklyReportMarkdown(
        '## Weekly Learning Review\n\nInsufficient evidence to infer a stable change.',
        new Set(),
      ),
    ).toThrow('weekly_report_language_must_be_zh_cn');

    expect(
      validateWeeklyReportMarkdown(
        '## 本周学习回顾\n\n证据不足，暂时无法判断稳定变化。',
        new Set(),
      ),
    ).toEqual({ sourceRefs: [] });
  });

  it('projects an already-finalized English empty report to the localized empty state', () => {
    expect(
      weeklyReportMarkdownForRead(
        '# Weekly Learning Review\n\nEvidence is insufficient because the snapshot is empty.',
        0,
      ),
    ).toBe(EMPTY_WEEKLY_REPORT_MARKDOWN);
    expect(weeklyReportMarkdownForRead('# 本周学习回顾\n\n已有中文内容。', 0)).toBe(
      '# 本周学习回顾\n\n已有中文内容。',
    );
  });
});
