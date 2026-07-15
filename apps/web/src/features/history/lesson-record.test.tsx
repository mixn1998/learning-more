// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { LessonRecordView } from './lesson-record-view.js';

afterEach(cleanup);

function renderRecord() {
  render(
    <LessonRecordView
      original={{
        sessionId: 'original',
        label: '原始学习',
        messages: [{ id: 'original-user', role: 'user', markdown: '原始内容不可修改' }],
      }}
      supplementary={[
        {
          sessionId: 'supplement-1',
          label: '7 月 14 日补充学习',
          messages: [{ id: 'supplement-user', role: 'user', markdown: '独立补充内容' }],
        },
      ]}
      finalReviewMarkdown="权威最终 Review"
    />,
  );
}

describe('lesson history record', () => {
  it('renders the immutable Review through the shared Markdown boundary', () => {
    render(
      <LessonRecordView
        original={{ sessionId: 'original', label: 'Original', messages: [] }}
        supplementary={[]}
        finalReviewMarkdown={
          '## Review evidence\n\n**Observed**\n\n- one decision\n- one revision\n\n> This is evidence, not a fixed trait.'
        }
      />,
    );

    fireEvent.click(screen.getAllByRole('tab')[1]!);
    expect(screen.getByRole('heading', { name: 'Review evidence' })).toBeVisible();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Observed').tagName).toBe('STRONG');
    expect(document.querySelector('.lesson-record-review blockquote')).toHaveTextContent(
      'This is evidence, not a fixed trait.',
    );
  });

  it('keeps the original conversation readonly and exposes no supplementary-learning creation control', () => {
    renderRecord();
    expect(screen.getByLabelText('只读学习对话')).toHaveTextContent('原始内容不可修改');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '开始补充学习' })).not.toBeInTheDocument();
  });

  it('renders message roles from structured data instead of parsing visible prefixes', () => {
    render(
      <LessonRecordView
        original={{
          sessionId: 'original',
          label: '原始学习',
          messages: [
            { id: 'user-prefix', role: 'user', markdown: '导师：这是用户输入的一部分' },
            { id: 'assistant-prefix', role: 'assistant', markdown: '你：这是导师回复的一部分' },
          ],
        }}
        supplementary={[]}
        finalReviewMarkdown="Review"
      />,
    );

    expect(screen.getByLabelText('你的消息')).toHaveTextContent('导师：这是用户输入的一部分');
    expect(screen.getByLabelText('AI 导师')).toHaveTextContent('你：这是导师回复的一部分');
  });

  it('[EQ-HIS-04] switches between original learning dialogue and the authoritative Review using two top tabs', () => {
    renderRecord();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      '学习对话',
      '课时 Review',
    ]);
    fireEvent.click(screen.getByRole('tab', { name: '课时 Review' }));
    expect(screen.getByLabelText('权威课时 Review')).toHaveTextContent('权威最终 Review');
  });

  it('[EQ-HIS-06] switches original and supplementary conversations inside the dialogue tab without changing Review', () => {
    renderRecord();
    fireEvent.click(screen.getByRole('button', { name: '7 月 14 日补充学习' }));
    expect(screen.getByLabelText('只读学习对话')).toHaveTextContent('独立补充内容');
    fireEvent.click(screen.getByRole('tab', { name: '课时 Review' }));
    expect(screen.getByLabelText('权威课时 Review')).toHaveTextContent('权威最终 Review');
  });
});
