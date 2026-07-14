// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AiContent } from './ai-content.js';

describe('AiContent', () => {
  it('renders semantic Markdown and removes unsafe HTML', () => {
    const { container } = render(
      <AiContent
        markdown={
          '## 结论\n\n这是 **重点**。\n\n- 第一项\n- 第二项\n\n> 有边界的引用\n\n<script>alert(1)</script>'
        }
      />,
    );
    expect(container.querySelector('.lm-ai-content')).toHaveAttribute('data-ai-content', 'true');
    expect(screen.getByRole('heading', { name: '结论' })).toBeVisible();
    expect(screen.getByText('重点')).toHaveProperty('tagName', 'STRONG');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(container.querySelector('blockquote')).toHaveTextContent('有边界的引用');
    expect(container.querySelector('script')).toBeNull();
  });
});

// @ts-expect-error raw strings must use the markdown property
const invalidAiContent = <AiContent>raw AI text</AiContent>;
void invalidAiContent;
