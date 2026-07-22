import type { PersonalizationView } from '@learning-more/contracts';

function normalize(value: string): string {
  return value
    .replace(/\s+/gu, ' ')
    .replace(/[；;。,.，]+$/u, '')
    .trim();
}

/** Read-only prompt projection. It never changes profile evidence or promotes candidates. */
export function renderTeachingPersonalizationPrompt(view: PersonalizationView): string[] {
  const unique = view.signals
    .map((signal) => ({ ...signal, summary: normalize(signal.summary) }))
    .filter((signal) => signal.summary.length > 0)
    .filter(
      (signal, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.explicitness === signal.explicitness &&
            candidate.summary.toLocaleLowerCase('zh-CN') ===
              signal.summary.toLocaleLowerCase('zh-CN'),
        ) === index,
    );
  const declared = unique
    .filter((signal) => signal.explicitness === 'user_declared')
    .map((signal) => signal.summary);
  const observed = unique
    .filter((signal) => signal.explicitness === 'ai_observed')
    .map((signal) => signal.summary);
  if (declared.length === 0 && observed.length === 0) return [];

  return [
    [
      '以下是既有全局画像的只读压缩投影，仅用于调整教学表达、支架和探查方式，不得据此断言能力、人格或当前掌握状态。',
      declared.length === 0 ? undefined : `学习者明确表达：${declared.join('；')}`,
      observed.length === 0
        ? undefined
        : `跨历史证据的观察线索（保留原证据限制，需在当前互动中验证）：${observed.join('；')}`,
    ]
      .filter((value): value is string => value !== undefined)
      .join('\n'),
  ];
}
