import type { TeachingAgentResult, TeachingDirective } from '../ports/teaching-agent.js';
import { TeachingDirectiveSchema } from './teaching-directive.js';
import {
  CONTROL_END,
  CONTROL_START,
  parseTeachingAgentResult,
  REPLY_END,
  REPLY_START,
} from './teaching-control-protocol.js';

export type TeachingResponseStreamEvent =
  | Readonly<{ type: 'directive.ready'; directive: TeachingDirective }>
  | Readonly<{ type: 'reply.delta'; markdown: string }>;

type Fence = Readonly<{
  start: number;
  end: number;
  closed: boolean;
  language: string;
  source: string;
}>;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function validateFence(language: string, source: string): void {
  if (language === 'math-plot') {
    let value: unknown;
    try {
      value = JSON.parse(source);
    } catch {
      throw new Error('teaching_math_plot_invalid');
    }
    const root = record(value);
    const view = record(root?.view);
    const series = root?.series;
    if (
      root?.version !== 1 ||
      !['cartesian2d', 'polar2d', 'cartesian3d'].includes(String(view?.type ?? '')) ||
      !Array.isArray(series) ||
      series.length === 0 ||
      series.some((item) => typeof record(item)?.kind !== 'string')
    ) {
      throw new Error('teaching_math_plot_invalid');
    }
  }
  if (['image', 'image-description', 'image-prompt'].includes(language) && source.trim() === '') {
    throw new Error('teaching_image_description_invalid');
  }
}

function fencedRanges(markdown: string, final: boolean): readonly Fence[] {
  const fences: Fence[] = [];
  const linePattern = /^( {0,3})(`{3,}|~{3,})([^\r\n]*)(?:\r?\n|$)/gmu;
  let open:
    | Readonly<{
        start: number;
        marker: string;
        length: number;
        language: string;
        bodyStart: number;
      }>
    | undefined;
  for (const match of markdown.matchAll(linePattern)) {
    const marker = match[2]!;
    const rest = match[3] ?? '';
    const start = match.index;
    const end = start + match[0].length;
    if (open === undefined) {
      open = {
        start,
        marker: marker[0]!,
        length: marker.length,
        language: rest.trim().split(/\s+/u)[0]?.toLocaleLowerCase('en-US') ?? '',
        bodyStart: end,
      };
      continue;
    }
    if (marker[0] === open.marker && marker.length >= open.length && rest.trim() === '') {
      const source = markdown.slice(open.bodyStart, start).replace(/\r?\n$/u, '');
      validateFence(open.language, source);
      fences.push({
        start: open.start,
        end,
        closed: true,
        language: open.language,
        source,
      });
      open = undefined;
    }
  }
  if (open !== undefined) {
    if (final) throw new Error('teaching_reply_render_unit_incomplete');
    fences.push({
      start: open.start,
      end: markdown.length,
      closed: false,
      language: open.language,
      source: markdown.slice(open.bodyStart),
    });
  }
  return fences;
}

function escaped(value: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function safeMarkdownBoundary(markdown: string, final: boolean): number {
  const fences = fencedRanges(markdown, final);
  const fencesByStart = new Map(fences.map((fence) => [fence.start, fence]));
  let boundary = 0;
  let inlineCodeTicks = 0;
  let mathDelimiter: '$' | '$$' | '\\(' | '\\[' | undefined;
  let bracketDepth = 0;
  let linkTargetDepth = 0;
  let htmlTag = false;

  for (let index = 0; index < markdown.length;) {
    const fence = fencesByStart.get(index);
    if (fence !== undefined) {
      if (!fence.closed) return boundary;
      boundary = fence.end;
      index = fence.end;
      continue;
    }

    const character = markdown[index]!;
    if (inlineCodeTicks > 0) {
      if (character === '`' && !escaped(markdown, index)) {
        let count = 1;
        while (markdown[index + count] === '`') count += 1;
        if (count === inlineCodeTicks) inlineCodeTicks = 0;
        index += count;
      } else {
        index += 1;
      }
      continue;
    }
    if (mathDelimiter !== undefined) {
      const close =
        mathDelimiter === '\\(' ? '\\)' : mathDelimiter === '\\[' ? '\\]' : mathDelimiter;
      if (markdown.startsWith(close, index) && !escaped(markdown, index)) {
        mathDelimiter = undefined;
        index += close.length;
      } else {
        index += 1;
      }
      continue;
    }
    if (character === '`' && !escaped(markdown, index)) {
      let count = 1;
      while (markdown[index + count] === '`') count += 1;
      inlineCodeTicks = count;
      index += count;
      continue;
    }
    if (!escaped(markdown, index) && markdown.startsWith('$$', index)) {
      mathDelimiter = '$$';
      index += 2;
      continue;
    }
    if (
      !escaped(markdown, index) &&
      (markdown.startsWith('\\(', index) || markdown.startsWith('\\[', index))
    ) {
      mathDelimiter = markdown.startsWith('\\(', index) ? '\\(' : '\\[';
      index += 2;
      continue;
    }
    if (character === '$' && !escaped(markdown, index)) {
      const laterClose = markdown.indexOf('$', index + 1);
      if (!final || laterClose >= 0) {
        mathDelimiter = '$';
        index += 1;
        continue;
      }
    }
    if (
      character === '<' &&
      !escaped(markdown, index) &&
      /[A-Za-z/!]/u.test(markdown[index + 1] ?? '')
    ) {
      htmlTag = true;
    }
    if (htmlTag) {
      if (character === '>') htmlTag = false;
      index += 1;
      continue;
    }
    if (character === '[' && !escaped(markdown, index)) bracketDepth += 1;
    if (character === ']' && bracketDepth > 0 && !escaped(markdown, index)) {
      bracketDepth -= 1;
      if (markdown[index + 1] === '(') {
        linkTargetDepth = 1;
        index += 2;
        continue;
      }
    }
    if (linkTargetDepth > 0) {
      if (character === '(' && !escaped(markdown, index)) linkTargetDepth += 1;
      if (character === ')' && !escaped(markdown, index)) linkTargetDepth -= 1;
      index += 1;
      continue;
    }

    const neutral = bracketDepth === 0;
    if (neutral && ['。', '！', '？', '；'].includes(character)) boundary = index + 1;
    if (neutral && character === '\n') boundary = index + 1;
    if (neutral && ['.', '!', '?', ';'].includes(character)) {
      const next = markdown[index + 1];
      if (next !== undefined && /\s/u.test(next)) boundary = index + 1;
      if (final && index === markdown.length - 1) boundary = index + 1;
    }
    index += 1;
  }

  if (final) {
    if (
      inlineCodeTicks > 0 ||
      mathDelimiter !== undefined ||
      bracketDepth > 0 ||
      linkTargetDepth > 0 ||
      htmlTag
    ) {
      throw new Error('teaching_reply_render_unit_incomplete');
    }
    return markdown.length;
  }
  return boundary;
}

export function createTeachingResponseStream(): Readonly<{
  push(delta: string): readonly TeachingResponseStreamEvent[];
  finish(): Readonly<{
    events: readonly TeachingResponseStreamEvent[];
    result: TeachingAgentResult;
  }>;
}> {
  let raw = '';
  let directive: TeachingDirective | undefined;
  let replyStart = -1;
  let emittedReplyLength = 0;

  function synchronize(final: boolean): TeachingResponseStreamEvent[] {
    const events: TeachingResponseStreamEvent[] = [];
    if (directive === undefined) {
      const controlStart = raw.indexOf(CONTROL_START);
      const controlEnd = raw.indexOf(CONTROL_END, controlStart + CONTROL_START.length);
      if (controlStart < 0 || controlEnd < 0) return events;
      const controlSource = raw.slice(controlStart + CONTROL_START.length, controlEnd).trim();
      const parsedDirective = TeachingDirectiveSchema.parse(
        JSON.parse(controlSource) as unknown,
      ) as unknown as TeachingDirective;
      directive = parsedDirective;
      events.push({ type: 'directive.ready', directive: parsedDirective });
      replyStart = raw.indexOf(REPLY_START, controlEnd + CONTROL_END.length);
    }
    if (replyStart < 0) {
      replyStart = raw.indexOf(REPLY_START);
      if (replyStart < 0) return events;
    }
    const contentStart = replyStart + REPLY_START.length;
    const replyEnd = raw.indexOf(REPLY_END, contentStart);
    const reply = raw.slice(contentStart, replyEnd < 0 ? undefined : replyEnd);
    const safeLength = safeMarkdownBoundary(reply, final || replyEnd >= 0);
    if (safeLength > emittedReplyLength) {
      events.push({
        type: 'reply.delta',
        markdown: reply.slice(emittedReplyLength, safeLength),
      });
      emittedReplyLength = safeLength;
    }
    return events;
  }

  return {
    push(delta) {
      raw += delta;
      return synchronize(false);
    },
    finish() {
      const result = parseTeachingAgentResult(raw, true);
      const events = synchronize(true);
      return { events, result };
    },
  };
}
