// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { WeeklyReportWorkspace } from './weekly-report-workspace.js';

afterEach(cleanup);

function renderState(state: 'generating' | 'failed') {
  render(
    <WeeklyReportWorkspace
      activeDayCount={0}
      actualSeconds={0}
      completedLessonCount={0}
      endLocalDate="2026-07-12"
      onBack={() => undefined}
      onOpenRecord={() => undefined}
      records={[]}
      reportState={state}
      startLocalDate="2026-07-05"
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /上周学习报告/u }));
}

describe('weekly snapshot state', () => {
  it('shows the current snapshot generation state without a previous report fallback', () => {
    renderState('generating');
    expect(screen.getByRole('status')).toHaveTextContent('上周学习成果正在汇总');
  });

  it('shows the current snapshot failure state without a previous report fallback', () => {
    renderState('failed');
    expect(screen.getByRole('alert')).toHaveTextContent('周报生成失败');
  });

  it('shows one learning outcome summary without a next-week suggestion panel', () => {
    render(
      <WeeklyReportWorkspace
        activeDayCount={1}
        actualSeconds={600}
        completedLessonCount={1}
        endLocalDate="2026-07-20"
        onBack={() => undefined}
        onOpenRecord={() => undefined}
        records={[]}
        reportState="finalized"
        startLocalDate="2026-07-13"
        summaryMarkdown="建立了函数多种表示之间的转换能力。"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /上周学习报告/u }));
    expect(screen.getByText('建立了函数多种表示之间的转换能力。')).toBeInTheDocument();
    expect(screen.queryByText('下周建议')).not.toBeInTheDocument();
    expect(screen.queryByText('AI 总结')).not.toBeInTheDocument();
  });
});
