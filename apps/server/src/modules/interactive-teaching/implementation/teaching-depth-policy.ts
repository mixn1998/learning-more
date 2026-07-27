import type { TeachingContextPackage } from '../ports/teaching-context-sources.js';

export type TeachingEmphasis = 'normal' | 'key' | 'difficult' | 'key_difficult';

export function emphasisFor(input: {
  fixedImportance?: 'normal' | 'key';
  adaptiveDifficulty?: 'normal' | 'difficult';
  depthPreference?: 'default' | 'condensed';
}): TeachingEmphasis {
  const key = input.fixedImportance === 'key' && input.depthPreference !== 'condensed';
  const difficult = input.adaptiveDifficulty === 'difficult';
  if (key && difficult) return 'key_difficult';
  if (key) return 'key';
  if (difficult) return 'difficult';
  return 'normal';
}

export function renderTeachingDepthPolicy(context: TeachingContextPackage): string | undefined {
  if ((context.teachingState.lessonPhase ?? 'warmup') !== 'knowledge_point') return undefined;
  const active = context.lesson.coreKnowledgePoints.find(
    (point) => point.ref === context.teachingState.activeKnowledgePointRef,
  );
  if (active === undefined) return undefined;
  const state = context.teachingState.knowledgePoints.find((point) => point.ref === active.ref);
  const emphasis = emphasisFor({
    fixedImportance: active.fixedImportance ?? 'normal',
    adaptiveDifficulty: state?.adaptiveDifficulty ?? 'normal',
    depthPreference: state?.depthPreference ?? 'default',
  });
  const heading =
    emphasis === 'key_difficult'
      ? '重难点'
      : emphasis === 'key'
        ? '重点'
        : emphasis === 'difficult'
          ? '难点'
          : '普通知识点';
  const common = [
    `当前知识点“${active.text}”的教学深度：${heading}。`,
    '教学深度不等于完成状态，也不规定固定讲解或互动方式。',
  ];
  return `【教学深模块｜${heading}】\n${common.join('\n')}`;
}
