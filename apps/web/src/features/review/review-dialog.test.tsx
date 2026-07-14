// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReviewDialog } from './review-dialog.js';

afterEach(cleanup);

describe('ReviewDialog', () => {
  it('renders final Review Markdown as headings, lists, emphasis, and quotes', () => {
    render(
      <ReviewDialog
        markdown={
          '## What changed\n\n**Evidence:**\n\n- revised a claim\n- tested an example\n\n> Adjacent exploration did not complete the lesson core.'
        }
        open
        title="Semantic Review"
      />,
    );

    expect(screen.getByRole('heading', { name: 'What changed' })).toBeVisible();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Evidence:').tagName).toBe('STRONG');
    expect(document.querySelector('.review-markdown blockquote')).toHaveTextContent(
      'Adjacent exploration did not complete the lesson core.',
    );
  });

  it('uses the shared dialog keyboard contract while preserving the two approved actions', () => {
    const close = vi.fn();
    render(
      <ReviewDialog
        courseTitle="测试课程"
        markdown="正文"
        onBackToOutline={vi.fn()}
        onClose={close}
        onViewRecord={vi.fn()}
        open
        title="测试课节"
      />,
    );

    const dialog = screen.getByRole('dialog', { name: '测试课节' });
    expect(screen.getByRole('heading', { name: '测试课节' })).toHaveFocus();
    expect(screen.getAllByRole('button').map((button) => button.textContent?.trim())).toEqual([
      '返回课程大纲',
      '查看课节记录',
    ]);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
  });
});
