import { describe, expect, it } from 'vitest';

import { collapseRetryDuplicateUserMessages } from '../implementation/effective-message-projection.js';

describe('effective learning-message projection', () => {
  it('retains only the latest copy of an adjacent identical user retry', () => {
    expect(
      collapseRetryDuplicateUserMessages([
        { id: 'user_original', role: 'user', markdown: 'same answer' },
        { id: 'user_retry', role: 'user', markdown: 'same answer' },
        { id: 'assistant_reply', role: 'assistant', markdown: 'reply' },
      ]).map((message) => message.id),
    ).toEqual(['user_retry', 'assistant_reply']);
  });

  it('preserves different user messages and repetitions separated by an assistant reply', () => {
    const messages = [
      { id: 'user_1', role: 'user' as const, markdown: 'answer' },
      { id: 'user_2', role: 'user' as const, markdown: 'another answer' },
      { id: 'assistant', role: 'assistant' as const, markdown: 'reply' },
      { id: 'user_3', role: 'user' as const, markdown: 'another answer' },
    ];

    expect(collapseRetryDuplicateUserMessages(messages)).toEqual(messages);
  });

  it('replaces an interrupted assistant fragment with its regenerated reply', () => {
    expect(
      collapseRetryDuplicateUserMessages([
        { id: 'user_1', role: 'user', markdown: 'compare the quantifiers' },
        {
          id: 'assistant_interrupted',
          role: 'assistant',
          markdown: 'Compare:',
          completionStatus: 'interrupted',
        },
        {
          id: 'assistant_retry',
          role: 'assistant',
          markdown: 'Complete comparison',
          completionStatus: 'complete',
        },
      ]).map((message) => message.id),
    ).toEqual(['user_1', 'assistant_retry']);
  });
});
