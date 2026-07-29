import { Children, isValidElement, lazy, Suspense } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
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

type MarkdownContainer = {
  readonly prefix: string;
  readonly continuationPrefix: string;
  readonly content: string;
  readonly isIndentedCode: boolean;
};

const blockquotePrefixPattern = /^[ \t]{0,3}>[ \t]?/;
const listPrefixPattern = /^[ \t]{0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/;

/**
 * Separate Markdown container markers from their content so model-friendly
 * TeX delimiters can be normalized without flattening quotes or list items.
 */
function splitMarkdownContainer(line: string): MarkdownContainer {
  let content = line;
  let prefix = '';
  let continuationPrefix = '';

  while (content.length > 0) {
    const blockquoteMatch = blockquotePrefixPattern.exec(content);
    if (blockquoteMatch) {
      prefix += blockquoteMatch[0];
      continuationPrefix += blockquoteMatch[0];
      content = content.slice(blockquoteMatch[0].length);
      continue;
    }

    const listMatch = listPrefixPattern.exec(content);
    if (listMatch) {
      prefix += listMatch[0];
      continuationPrefix += ' '.repeat(listMatch[0].length);
      content = content.slice(listMatch[0].length);
      continue;
    }

    break;
  }

  const indentation = /^[ \t]*/.exec(content)?.[0] ?? '';
  prefix += indentation;
  continuationPrefix += indentation;
  content = content.slice(indentation.length);

  return {
    prefix,
    continuationPrefix,
    content,
    isIndentedCode: indentation.includes('\t') || indentation.length >= 4,
  };
}

type MarkdownFence = {
  readonly marker: '`' | '~';
  readonly length: number;
};

function readFenceStart(content: string): MarkdownFence | undefined {
  const match = /^(`{3,}|~{3,})/.exec(content);
  if (!match) return undefined;
  const marker = match[0][0];
  if (marker !== '`' && marker !== '~') return undefined;
  return { marker, length: match[0].length };
}

function isFenceEnd(content: string, fence: MarkdownFence) {
  const match = /^(`{3,}|~{3,})[ \t]*$/.exec(content);
  return Boolean(match && match[0][0] === fence.marker && match[0].trim().length >= fence.length);
}

function replaceOutsideInlineCode(value: string, replace: (plainText: string) => string) {
  let cursor = 0;
  let plainStart = 0;
  let result = '';

  while (cursor < value.length) {
    if (value[cursor] !== '`') {
      cursor += 1;
      continue;
    }

    let openingEnd = cursor + 1;
    while (value[openingEnd] === '`') openingEnd += 1;
    const openingLength = openingEnd - cursor;
    let closingStart = openingEnd;
    let closingEnd = -1;

    while (closingStart < value.length) {
      if (value[closingStart] !== '`') {
        closingStart += 1;
        continue;
      }
      let runEnd = closingStart + 1;
      while (value[runEnd] === '`') runEnd += 1;
      if (runEnd - closingStart === openingLength) {
        closingEnd = runEnd;
        break;
      }
      closingStart = runEnd;
    }

    if (closingEnd < 0) {
      cursor = openingEnd;
      continue;
    }

    result += replace(value.slice(plainStart, cursor));
    result += value.slice(cursor, closingEnd);
    cursor = closingEnd;
    plainStart = closingEnd;
  }

  return result + replace(value.slice(plainStart));
}

/**
 * Models commonly emit LaTeX with TeX delimiters or a bare bracketed display
 * block. Normalize those equivalent forms to remark-math's `$` delimiters,
 * while leaving fenced code examples untouched.
 */
function normalizeLatexMath(markdown: string) {
  const normalized: string[] = [];
  let activeFence: MarkdownFence | undefined;
  let inTexDisplay = false;

  for (const line of markdown.split('\n')) {
    const container = splitMarkdownContainer(line);

    if (activeFence) {
      normalized.push(line);
      if (isFenceEnd(container.content, activeFence)) activeFence = undefined;
      continue;
    }

    const fenceStart = readFenceStart(container.content);
    if (fenceStart) {
      activeFence = fenceStart;
      normalized.push(line);
      continue;
    }

    if (inTexDisplay && /^\\\][ \t]*$/.test(container.content)) {
      normalized.push(`${container.prefix}$$`);
      inTexDisplay = false;
      continue;
    }

    if (container.isIndentedCode) {
      normalized.push(line);
      continue;
    }

    if (/^\\\[[ \t]*$/.test(container.content)) {
      normalized.push(`${container.prefix}$$`);
      inTexDisplay = true;
      continue;
    }
    if (/^\\\][ \t]*$/.test(container.content)) {
      normalized.push(`${container.prefix}$$`);
      continue;
    }

    const trimmed = container.content.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']') && /\\[A-Za-z]+/.test(trimmed)) {
      normalized.push(
        `${container.prefix}$$`,
        `${container.continuationPrefix}${trimmed.slice(1, -1).trim()}`,
        `${container.continuationPrefix}$$`,
      );
      continue;
    }

    normalized.push(
      `${container.prefix}${replaceOutsideInlineCode(container.content, (plainText) =>
        plainText
          .replace(/\\\[([^\n]*?)\\\]/g, (_, expression: string) => `$$${expression}$$`)
          .replace(/\\\(([^\n]*?)\\\)/g, (_, expression: string) => `$${expression}$`),
      )}`,
    );
  }

  return normalized.join('\n');
}

type HtmlAstNode = {
  readonly type?: string;
  value?: unknown;
  readonly tagName?: string;
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly children?: HtmlAstNode[];
};

function decodeMathHtmlEntities(value: string) {
  return value
    .replace(/&(?:lt|#0*60|#x0*3c);/giu, '<')
    .replace(/&(?:gt|#0*62|#x0*3e);/giu, '>')
    .replace(/&(?:quot|#0*34|#x0*22);/giu, '"')
    .replace(/&(?:apos|#0*39|#x0*27);/giu, "'")
    .replace(/&(?:amp|#0*38|#x0*26);/giu, '&');
}

function normalizeLearnerFacingChineseVariants(value: string) {
  return value
    .replace(/趨近於/gu, '趋近于')
    .replace(/趨近于/gu, '趋近于')
    .replace(/趨近/gu, '趋近');
}

function rehypeNormalizeLearnerFacingChinese() {
  return (tree: HtmlAstNode) => {
    const visit = (node: HtmlAstNode): void => {
      if (node.type === 'element' && (node.tagName === 'code' || node.tagName === 'pre')) return;
      if (node.type === 'text' && typeof node.value === 'string') {
        node.value = normalizeLearnerFacingChineseVariants(node.value);
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

/**
 * Markdown entities are not decoded inside remark-math nodes. Repair only the
 * generated math code elements before KaTeX reads them, without decoding
 * prose, raw HTML, or authored code examples.
 */
function rehypeDecodeMathHtmlEntities() {
  return (tree: HtmlAstNode) => {
    const decodeText = (node: HtmlAstNode): void => {
      if (node.type === 'text' && typeof node.value === 'string') {
        node.value = decodeMathHtmlEntities(node.value);
      }
      node.children?.forEach(decodeText);
    };
    const visit = (node: HtmlAstNode): void => {
      const className = node.properties?.className;
      const classes = Array.isArray(className)
        ? className.filter((value): value is string => typeof value === 'string')
        : typeof className === 'string'
          ? className.split(/\s+/u)
          : [];
      if (node.type === 'element' && node.tagName === 'code' && classes.includes('language-math')) {
        node.children?.forEach(decodeText);
        return;
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
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

const aiContentComponents: Components = {
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
    const isMathPlot = Boolean(codeClassName && mathPlotLanguagePattern.test(codeClassName));
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
};

export function AiContent(props: { readonly markdown: string; readonly className?: string }) {
  const className = ['lm-ai-content', props.className].filter(Boolean).join(' ');
  return (
    <div className={className} data-ai-content="true">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        // Sanitize authored Markdown before KaTeX expands math into HTML. This
        // keeps raw HTML out while allowing the trusted renderer output through.
        rehypePlugins={[
          rehypeNormalizeLearnerFacingChinese,
          rehypeDecodeMathHtmlEntities,
          rehypeSanitize,
          rehypeKatex,
        ]}
        components={aiContentComponents}
      >
        {normalizeLatexMath(normalizeCompactGfmTables(props.markdown))}
      </ReactMarkdown>
    </div>
  );
}
