import { describe, expect, it } from 'vitest';

import { createTeachingResponseStream } from '../implementation/teaching-response-stream.js';
import { parseTeachingAgentResult } from '../implementation/teaching-control-protocol.js';

const directive = {
  schemaVersion: 1,
  lessonPhase: 'warmup',
  activeKnowledgePointRef: 'knowledge:one',
  knowledgePoints: [
    {
      ref: 'knowledge:one',
      status: 'learning',
      interactionStatus: 'pending',
    },
  ],
  difficultySignals: [],
  comprehensiveCheck: 'pending',
  closureInquiry: 'pending',
  summaryStatus: 'pending',
} as const;

const control = `<learning-more-control>${JSON.stringify(directive)}</learning-more-control>`;

function visible(events: readonly Readonly<{ type: string; markdown?: string }>[]): string {
  return events
    .filter((event) => event.type === 'reply.delta')
    .map((event) => event.markdown ?? '')
    .join('');
}

describe('TeachingResponseStream', () => {
  it('publishes a safe plain-text prefix before a long sentence is complete', () => {
    const stream = createTeachingResponseStream();
    stream.push('<learning-more-reply>');
    const prefix = 'A'.repeat(31);

    expect(visible(stream.push(prefix))).toBe('');
    expect(visible(stream.push('B and the rest is still being generated'))).toBe(`${prefix}B`);
  });

  it('parses a sparse version 2 control directive after the visible reply', () => {
    const stream = createTeachingResponseStream();
    const sparse = {
      schemaVersion: 2,
      lessonPhase: 'knowledge_point',
      activeKnowledgePointRef: 'knowledge:one',
      knowledgePoints: [{ ref: 'knowledge:one', status: 'learning' }],
    } as const;

    const events = stream.push(
      `<learning-more-reply>Visible reply.</learning-more-reply><learning-more-control>${JSON.stringify(sparse)}</learning-more-control>`,
    );

    expect(events).toContainEqual({ type: 'directive.ready', directive: sparse });
    expect(stream.finish().result).toEqual({ markdown: 'Visible reply.', directive: sparse });
  });

  it('requires a version 3 interaction invitation to appear in the visible reply', () => {
    const directiveV3 = {
      schemaVersion: 3,
      lessonPhase: 'knowledge_point',
      turnHandoff: 'invite_response',
      interactionPromptExcerpt: '你会先检查哪个条件？',
    } as const;
    const valid = `<learning-more-reply>先区分事实与判断。你会先检查哪个条件？</learning-more-reply><learning-more-control>${JSON.stringify(directiveV3)}</learning-more-control>`;
    const invalid = `<learning-more-reply>先区分事实与判断。</learning-more-reply><learning-more-control>${JSON.stringify(directiveV3)}</learning-more-control>`;

    expect(parseTeachingAgentResult(valid, true).directive).toEqual(directiveV3);
    expect(() => parseTeachingAgentResult(invalid, true)).toThrowError(
      'teaching_interaction_prompt_not_in_reply',
    );
  });

  it('publishes safe reply sentences before the trailing control block is available', () => {
    const stream = createTeachingResponseStream();

    const first = stream.push('<learning-more-reply>第一句已经完整。第二句还没有');

    expect(visible(first)).toBe('第一句已经完整。');
    expect(first.some((event) => event.type === 'directive.ready')).toBe(false);

    const second = stream.push(`完成。</learning-more-reply>${control}`);
    expect(visible(second)).toBe('第二句还没有完成。');
    expect(second.map((event) => event.type)).toEqual([
      'reply.delta',
      'reply.completed',
      'directive.ready',
    ]);
    expect(second).toContainEqual({ type: 'directive.ready', directive });
    expect(stream.finish().result).toEqual({
      markdown: '第一句已经完整。第二句还没有完成。',
      directive,
    });
  });

  it('completes the visible reply even when the trailing control block is invalid', () => {
    const stream = createTeachingResponseStream();
    const events = stream.push(
      '<learning-more-reply>Visible teaching answer.</learning-more-reply><learning-more-control>{invalid}</learning-more-control>',
    );

    expect(events).toEqual([
      { type: 'reply.delta', markdown: 'Visible teaching answer.' },
      { type: 'reply.completed', markdown: 'Visible teaching answer.' },
    ]);
    expect(() => stream.finish()).toThrow();
  });

  it('recovers a complete directive when the model repeats the control opening tag at EOF', () => {
    const stream = createTeachingResponseStream();
    const malformedTerminalTag = `<learning-more-reply>本课总结。</learning-more-reply><learning-more-control>${JSON.stringify(directive)}<learning-more-control>`;

    const events = stream.push(malformedTerminalTag);

    expect(events).toContainEqual({ type: 'reply.completed', markdown: '本课总结。' });
    expect(events.some((event) => event.type === 'directive.ready')).toBe(false);
    const completed = stream.finish();
    expect(completed.events).toContainEqual({ type: 'directive.ready', directive });
    expect(completed.result).toEqual({ markdown: '本课总结。', directive });
  });

  it('does not publish an inline formula until its delimiter and sentence are closed', () => {
    const stream = createTeachingResponseStream();
    stream.push('<learning-more-reply>');

    expect(visible(stream.push('定义为 $f(x)=x'))).toBe('');
    expect(visible(stream.push('^2$。'))).toBe('定义为 $f(x)=x^2$。');
  });

  it('publishes a valid math-plot only after the complete fenced block arrives', () => {
    const stream = createTeachingResponseStream();
    stream.push('<learning-more-reply>');

    const first = stream.push(
      '先观察变化。\n\n```math-plot\n{"version":1,"view":{"type":"cartesian2d"',
    );
    expect(visible(first)).toBe('先观察变化。\n\n');

    const second = stream.push(
      ',"xRange":[-2,2],"yRange":[-2,4]},"series":[{"kind":"explicit","expression":"x^2"}]}\n```',
    );
    expect(visible(second)).toContain('```math-plot');
    expect(visible(second)).toContain('"expression":"x^2"');
  });

  it('keeps image description fences atomic and rejects an invalid math-plot contract', () => {
    const imageStream = createTeachingResponseStream();
    imageStream.push('<learning-more-reply>');
    expect(visible(imageStream.push('```image-description\n一张函数变化示意图'))).toBe('');
    expect(visible(imageStream.push('\n```'))).toBe(
      '```image-description\n一张函数变化示意图\n```',
    );

    const invalidPlot = createTeachingResponseStream();
    invalidPlot.push('<learning-more-reply>');
    expect(() => invalidPlot.push('```math-plot\n{"version":1}\n```')).toThrow(
      'teaching_math_plot_invalid',
    );
  });

  it('does not mistake comparison signs or an unmatched currency marker for render units', () => {
    const stream = createTeachingResponseStream();
    stream.push('<learning-more-reply>');

    expect(visible(stream.push(`当 x < 3 时，成本是 $5。</learning-more-reply>${control}`))).toBe(
      '当 x < 3 时，成本是 $5。',
    );
    expect(stream.finish().result.markdown).toBe('当 x < 3 时，成本是 $5。');
  });

  it('rejects an unfinished atomic render unit at completion', () => {
    const formula = createTeachingResponseStream();
    expect(() =>
      formula.push(`<learning-more-reply>定义为 \\(f(x)=x^2</learning-more-reply>${control}`),
    ).toThrow('teaching_reply_render_unit_incomplete');

    const fence = createTeachingResponseStream();
    expect(() =>
      fence.push(
        `<learning-more-reply>\`\`\`image-description\n函数图像</learning-more-reply>${control}`,
      ),
    ).toThrow('teaching_reply_render_unit_incomplete');
  });
});
