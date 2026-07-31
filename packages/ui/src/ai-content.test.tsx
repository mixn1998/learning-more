// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { MathPlotContract } from './math-plot-contract.js';

vi.mock('./math-plot.js', () => ({
  MathPlot: ({ spec }: { readonly spec: MathPlotContract }) => (
    <figure data-testid="rendered-math-plot">{spec.title ?? '函数图像'}</figure>
  ),
}));

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

  it('decodes HTML entities inside math without changing code examples', () => {
    const { container } = render(
      <AiContent
        markdown={
          '内联：\\(x&lt;a\\)，直接分隔符：$x&gt;a$。\n\n\\[\nf(x)=\\begin{cases}\nx+2,&amp;x&lt;0,\\\\\nx+5,&amp;x&gt;0.\n\\end{cases}\n\\]\n\n`\\(x&lt;a\\)`'
        }
      />,
    );

    const renderedMath = [...container.querySelectorAll('.katex')]
      .map((element) => element.textContent ?? '')
      .join(' ');
    expect(container.querySelectorAll('.katex')).toHaveLength(3);
    expect(container.querySelector('.katex-error')).toBeNull();
    expect(renderedMath).not.toContain('amp;');
    expect(renderedMath).not.toContain('lt;');
    expect(renderedMath).not.toContain('gt;');
    expect(container.querySelector('code')).toHaveTextContent('\\(x&lt;a\\)');
  });

  it('normalizes the traditional variant of 趋近 in learner-facing copy only', () => {
    const { container } = render(
      <AiContent markdown={'当 x 趨近於 a 时观察函数值。\n\n`术语：趨近於`'} />,
    );

    expect(container).toHaveTextContent('当 x 趋近于 a 时观察函数值。');
    expect(container).not.toHaveTextContent('当 x 趨近於 a 时观察函数值。');
    expect(container.querySelector('code')).toHaveTextContent('术语：趨近於');
  });

  it('renders TeX display math inside Markdown blockquotes', () => {
    const { container } = render(
      <AiContent markdown={'> 给定函数，记作  \n> \\[\n> f:A\\to B.\n> \\]'} />,
    );

    const blockquote = container.querySelector('blockquote');
    expect(blockquote).toBeInTheDocument();
    expect(blockquote?.querySelector('.katex-display')).toBeInTheDocument();
    expect(blockquote).not.toHaveTextContent('[ f:A\\to B. ]');
  });

  it('renders display math in nested blockquotes and list items', () => {
    const nestedQuote = render(<AiContent markdown={'> > \\[\n> > x^2+y^2=z^2\n> > \\]'} />);
    expect(nestedQuote.container.querySelectorAll('blockquote')).toHaveLength(2);
    expect(nestedQuote.container.querySelector('.katex-display')).toBeInTheDocument();
    nestedQuote.unmount();

    const list = render(<AiContent markdown={'- \\[\n  x^2\n  \\]\n- 下一项'} />);
    expect(list.container.querySelectorAll('li')).toHaveLength(2);
    expect(list.container.querySelector('li .katex-display')).toBeInTheDocument();
    list.unmount();

    const nestedList = render(
      <AiContent markdown={'- 外层\n  - \\[\n    x^2\n    \\]\n  - 下一项'} />,
    );
    expect(nestedList.container.querySelectorAll('li')).toHaveLength(3);
    expect(nestedList.container.querySelector('li li .katex-display')).toBeInTheDocument();
  });

  it('normalizes bracketed display math inside a blockquote', () => {
    const { container } = render(<AiContent markdown={'> [\\lim_{x\\to a} f(x)=L]'} />);

    expect(container.querySelector('blockquote .katex-display')).toBeInTheDocument();
  });

  it('does not normalize TeX-like text in quoted fenced or inline code', () => {
    const { container } = render(
      <AiContent
        markdown={'> ```tex\n> \\[\n> f:A\\to B.\n> \\]\n> ```\n\n> `\\(x\\to y\\)`\n\n\\(z\\)'}
      />,
    );

    expect(container.querySelectorAll('.katex')).toHaveLength(1);
    expect(container.querySelector('pre .katex')).toBeNull();
    expect(container.querySelector('p code .katex')).toBeNull();
    expect(container.querySelector('pre code')).toHaveTextContent('\\[');
    expect(container.querySelector('pre code')).toHaveTextContent('f:A\\to B.');
    expect(container.querySelector('pre code')).toHaveTextContent('\\]');
    expect(container.querySelector('p code')).toHaveTextContent('\\(x\\to y\\)');
  });

  it('keeps Mermaid diagrams readable as a safe code fallback', () => {
    const { container } = render(<AiContent markdown={'```mermaid\ngraph TD\n  A --> B\n```'} />);

    const diagramCode = container.querySelector('[data-diagram-fallback="mermaid"]');
    expect(diagramCode).toBeInTheDocument();
    expect(diagramCode).toHaveTextContent('A --> B');
    expect(container.querySelector('svg')).toBeNull();
  });

  it('recognizes a safe math-plot block and lazy-renders the interactive graph', async () => {
    const source = JSON.stringify({
      version: 1,
      title: '正弦函数',
      view: { type: 'cartesian2d', xRange: [-6, 6], yRange: [-2, 2] },
      series: [{ kind: 'explicit', expression: 'sin(x)' }],
    });
    const { container } = render(
      <AiContent markdown={`正文\n\n\`\`\`math-plot\n${source}\n\`\`\``} />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('rendered-math-plot')).toHaveTextContent('正弦函数'),
    );
    expect(container.querySelector('pre [data-testid="rendered-math-plot"]')).toBeNull();
    expect(container).toHaveTextContent('正文');
  });

  it('preserves a rendered math plot across an equivalent markdown rerender', async () => {
    const source = JSON.stringify({
      version: 1,
      view: { type: 'cartesian2d', xRange: [-1, 5], yRange: [-2, 6] },
      series: [{ kind: 'explicit', expression: 'x-2' }],
    });
    const markdown = `\`\`\`math-plot\n${source}\n\`\`\``;
    const rendered = render(<AiContent markdown={markdown} />);
    await waitFor(() =>
      expect(rendered.container.querySelector('[data-testid="rendered-math-plot"]')).toBeTruthy(),
    );
    const initialPlot = rendered.container.querySelector('[data-testid="rendered-math-plot"]');

    rendered.rerender(<AiContent markdown={markdown} />);

    expect(rendered.container.querySelector('[data-testid="rendered-math-plot"]')).toBe(
      initialPlot,
    );
  });

  it('keeps invalid math plots readable without exposing executable HTML', () => {
    const source = '{"version":1,"view":{"type":"cartesian2d"},"series":[],"script":"alert(1)"}';
    const { container } = render(<AiContent markdown={`\`\`\`math-plot\n${source}\n\`\`\``} />);

    expect(
      container.querySelector('[data-math-plot-state="contract_invalid"]'),
    ).toBeInTheDocument();
    expect(container).toHaveTextContent('函数图像暂时无法渲染');
    expect(container.querySelector('script')).toBeNull();
  });
});

// @ts-expect-error raw strings must use the markdown property
const invalidAiContent = <AiContent>raw AI text</AiContent>;
void invalidAiContent;
