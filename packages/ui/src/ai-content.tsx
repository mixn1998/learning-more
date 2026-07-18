import { Children, isValidElement, lazy, Suspense } from 'react';
import ReactMarkdown from 'react-markdown';
import 'katex/dist/katex.min.css';
import rehypeKatex from 'rehype-katex';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

import { parseMathPlotContract } from './math-plot-contract.js';

const mermaidLanguagePattern = /(?:^|\s)language-mermaid(?:\s|$)/;
const mathPlotLanguagePattern = /(?:^|\s)language-math-plot(?:\s|$)/;
const compactTableSeparatorPattern = /\|?\s*:?-{1,}:?\s*(?:\|\s*:?-{1,}:?\s*)+\|?/;

function stripTableEdgePipes(value: string) {
  return value.trim().replace(/^\|/, '').replace(/\|$/, '').trim();
}

/**
 * Some model responses collapse a complete pipe table onto one physical line.
 * GFM intentionally does not guess that layout, so repair only the unambiguous
 * header/separator/row shape and leave every other pipe-containing prose alone.
 */
function normalizeCompactGfmTables(markdown: string) {
  return markdown
    .split('\n')
    .flatMap((line) => {
      const separatorMatch = compactTableSeparatorPattern.exec(line);
      if (!separatorMatch || separatorMatch.index === undefined) return [line];

      const before = line.slice(0, separatorMatch.index).trim();
      const after = line.slice(separatorMatch.index + separatorMatch[0].length).trim();
      if (!before.includes('|') || !after.includes('|')) return [line];

      const rows = after.split(/\s*\|\s*\|\s*/).map(stripTableEdgePipes);
      return [before, separatorMatch[0].trim(), ...rows.map((row) => `| ${row} |`)];
    })
    .join('\n');
}

/**
 * Models commonly emit LaTeX with TeX delimiters or a bare bracketed display
 * block. Normalize those equivalent forms to remark-math's `$` delimiters,
 * while leaving fenced code examples untouched.
 */
function normalizeLatexMath(markdown: string) {
  const normalized: string[] = [];
  let inFence = false;

  for (const line of markdown.split('\n')) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      normalized.push(line);
      continue;
    }

    if (inFence) {
      normalized.push(line);
      continue;
    }

    if (/^\s*\\\[\s*$/.test(line)) {
      normalized.push('$$');
      continue;
    }
    if (/^\s*\\\]\s*$/.test(line)) {
      normalized.push('$$');
      continue;
    }

    const trimmed = line.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']') && /\\[A-Za-z]+/.test(trimmed)) {
      normalized.push('$$', trimmed.slice(1, -1).trim(), '$$');
      continue;
    }

    normalized.push(
      line
        .replace(/\\\[([^\n]*?)\\\]/g, (_, expression: string) => `$$${expression}$$`)
        .replace(/\\\(([^\n]*?)\\\)/g, (_, expression: string) => `$${expression}$`),
    );
  }

  return normalized.join('\n');
}

const LazyMathPlot = lazy(async () => {
  const module = await import('./math-plot.js');
  return { default: module.MathPlot };
});

function MathPlotBlock(props: { readonly source: string }) {
  const parsed = parseMathPlotContract(props.source);
  if (!parsed.ok) {
    return (
      <figure className="lm-math-plot lm-math-plot-fallback" data-math-plot-state={parsed.code}>
        <figcaption>函数图像暂时无法渲染</figcaption>
        <p>{parsed.detail}</p>
        <details>
          <summary>查看原始图像描述</summary>
          <pre>
            <code>{props.source}</code>
          </pre>
        </details>
      </figure>
    );
  }
  return (
    <Suspense
      fallback={
        <figure className="lm-math-plot lm-math-plot-loading" aria-live="polite">
          <figcaption>{parsed.value.title ?? '函数图像'}</figcaption>
          <p>正在绘制函数图像……</p>
        </figure>
      }
    >
      <LazyMathPlot spec={parsed.value} />
    </Suspense>
  );
}

export function AiContent(props: { readonly markdown: string; readonly className?: string }) {
  const className = ['lm-ai-content', props.className].filter(Boolean).join(' ');
  return (
    <div className={className} data-ai-content="true">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        // Sanitize authored Markdown before KaTeX expands math into HTML. This
        // keeps raw HTML out while allowing the trusted renderer output through.
        rehypePlugins={[rehypeSanitize, rehypeKatex]}
        components={{
          pre: ({ children, ...preProps }) => {
            const child = Children.count(children) === 1 ? Children.only(children) : undefined;
            const childClassName = isValidElement<{ className?: string }>(child)
              ? child.props.className
              : undefined;
            return childClassName && mathPlotLanguagePattern.test(childClassName) ? (
              child
            ) : (
              <pre {...preProps}>{children}</pre>
            );
          },
          table: ({ children, ...tableProps }) => (
            <div className="lm-ai-table-wrap">
              <table {...tableProps}>{children}</table>
            </div>
          ),
          code: ({ children, className: codeClassName, ...codeProps }) => {
            const isMermaid = Boolean(codeClassName && mermaidLanguagePattern.test(codeClassName));
            const isMathPlot = Boolean(
              codeClassName && mathPlotLanguagePattern.test(codeClassName),
            );
            if (isMathPlot) return <MathPlotBlock source={String(children).trim()} />;
            return (
              <code
                {...codeProps}
                className={codeClassName}
                data-diagram-fallback={isMermaid ? 'mermaid' : undefined}
              >
                {children}
              </code>
            );
          },
        }}
      >
        {normalizeLatexMath(normalizeCompactGfmTables(props.markdown))}
      </ReactMarkdown>
    </div>
  );
}
