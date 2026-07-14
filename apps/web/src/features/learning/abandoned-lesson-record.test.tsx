// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AbandonedLessonRecord } from './abandoned-lesson-record.js';

afterEach(cleanup);

describe('abandoned lesson record', () => {
  it('[EQ-LESSON-11] exposes only learned/remaining points, readonly record, and explicit restore without supplemental/global-history context', () => {
    render(
      <AbandonedLessonRecord
        learnedPoints={['已理解反馈']}
        remainingPoints={['待验证节奏']}
        stageReviewMarkdown="阶段 Review 只读"
        onViewRecord={vi.fn()}
        onRestore={vi.fn()}
      />,
    );
    expect(screen.getByText('已学习：已理解反馈')).toBeInTheDocument();
    expect(screen.getByText('待完成：待验证节奏')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看记录' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '恢复学习' })).toBeInTheDocument();
    expect(screen.queryByText(/补充学习|全局历史|继承上下文/u)).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});
