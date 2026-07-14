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

  it('renders GFM tables as semantic, scrollable table markup', () => {
    const { container } = render(
      <AiContent markdown={'| 维度 | 核心问题 |\n| --- | --- |\n| 技术 | 能否交付？ |'} />,
    );

    expect(container.querySelector('.lm-ai-table-wrap')).toBeInTheDocument();
    expect(container.querySelector('table')).toBeInTheDocument();
    expect(container.querySelectorAll('th')).toHaveLength(2);
    expect(container.querySelectorAll('td')).toHaveLength(2);
    expect(container.querySelector('table')).toHaveTextContent('能否交付？');
  });

  it('repairs a compact one-line pipe table without changing ordinary prose', () => {
    const { container } = render(
      <AiContent
        markdown={
          '| 维度 | 核心问题 | |---|---| 技术 | 能否交付？ | | 市场 | 谁会使用？ |\n\nA | B is ordinary prose.'
        }
      />,
    );

    expect(container.querySelector('table')).toBeInTheDocument();
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(container).toHaveTextContent('A | B is ordinary prose.');
  });

  it('renders inline and display math through the shared Markdown boundary', () => {
    const { container } = render(
      <AiContent markdown={'内联公式 $a^2+b^2=c^2$\n\n$$\n\\int_0^1 x^2 dx\n$$'} />,
    );

    expect(container.querySelector('.katex')).toBeInTheDocument();
    expect(container.querySelector('.katex-display')).toBeInTheDocument();
  });

  it('normalizes common AI LaTeX delimiters and bracketed display math', () => {
    const { container } = render(
      <AiContent markdown={'内联：\\(a^2+b^2=c^2\\)\n\n[\\lim_{x\\to a} f(x)=L]'} />,
    );

    expect(container.querySelectorAll('.katex')).toHaveLength(2);
    expect(container.querySelector('.katex-display')).toBeInTheDocument();
  });

  it('keeps Mermaid diagrams readable as a safe code fallback', () => {
    const { container } = render(<AiContent markdown={'```mermaid\ngraph TD\n  A --> B\n```'} />);

    const diagramCode = container.querySelector('[data-diagram-fallback="mermaid"]');
    expect(diagramCode).toBeInTheDocument();
    expect(diagramCode).toHaveTextContent('A --> B');
    expect(container.querySelector('svg')).toBeNull();
  });
});

// @ts-expect-error raw strings must use the markdown property
const invalidAiContent = <AiContent>raw AI text</AiContent>;
void invalidAiContent;
