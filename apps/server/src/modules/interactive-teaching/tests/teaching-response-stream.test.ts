import { describe, expect, it } from 'vitest';

import { createTeachingResponseStream } from '../implementation/teaching-response-stream.js';

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
  it('validates the complete control block before publishing sentence deltas', () => {
    const stream = createTeachingResponseStream();

    expect(stream.push(control.slice(0, 80))).toEqual([]);
    const first = stream.push(
      `${control.slice(80)}<learning-more-reply>第一句已经完整。第二句还没有`,
    );

    expect(first[0]).toEqual({ type: 'directive.ready', directive });
    expect(visible(first)).toBe('第一句已经完整。');

    const second = stream.push('完成。</learning-more-reply>');
    expect(visible(second)).toBe('第二句还没有完成。');
    expect(stream.finish().result).toEqual({
      markdown: '第一句已经完整。第二句还没有完成。',
      directive,
    });
  });

  it('does not publish an inline formula until its delimiter and sentence are closed', () => {
    const stream = createTeachingResponseStream();
    stream.push(`${control}<learning-more-reply>`);

    expect(visible(stream.push('定义为 $f(x)=x'))).toBe('');
    expect(visible(stream.push('^2$。'))).toBe('定义为 $f(x)=x^2$。');
  });

  it('publishes a valid math-plot only after the complete fenced block arrives', () => {
    const stream = createTeachingResponseStream();
    stream.push(`${control}<learning-more-reply>`);

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
    imageStream.push(`${control}<learning-more-reply>`);
    expect(visible(imageStream.push('```image-description\n一张函数变化示意图'))).toBe('');
    expect(visible(imageStream.push('\n```'))).toBe(
      '```image-description\n一张函数变化示意图\n```',
    );

    const invalidPlot = createTeachingResponseStream();
    invalidPlot.push(`${control}<learning-more-reply>`);
    expect(() => invalidPlot.push('```math-plot\n{"version":1}\n```')).toThrow(
      'teaching_math_plot_invalid',
    );
  });

  it('does not mistake comparison signs or an unmatched currency marker for render units', () => {
    const stream = createTeachingResponseStream();
    stream.push(`${control}<learning-more-reply>`);

    expect(visible(stream.push('当 x < 3 时，成本是 $5。</learning-more-reply>'))).toBe(
      '当 x < 3 时，成本是 $5。',
    );
    expect(stream.finish().result.markdown).toBe('当 x < 3 时，成本是 $5。');
  });

  it('rejects an unfinished atomic render unit at completion', () => {
    const formula = createTeachingResponseStream();
    expect(() =>
      formula.push(`${control}<learning-more-reply>定义为 \\(f(x)=x^2</learning-more-reply>`),
    ).toThrow('teaching_reply_render_unit_incomplete');

    const fence = createTeachingResponseStream();
    expect(() =>
      fence.push(
        `${control}<learning-more-reply>\`\`\`image-description\n函数图像</learning-more-reply>`,
      ),
    ).toThrow('teaching_reply_render_unit_incomplete');
  });
});
