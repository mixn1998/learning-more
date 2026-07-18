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
    expect(screen.getByRole('status')).toHaveTextContent('本周快照生成中');
  });

  it('shows the current snapshot failure state without a previous report fallback', () => {
    renderState('failed');
    expect(screen.getByRole('alert')).toHaveTextContent('周报生成失败');
  });
});
