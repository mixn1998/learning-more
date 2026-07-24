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
    '教学深度不等于完成状态；达到足够理解后仍应自然小结并进入下一节点。',
  ];
  if (emphasis === 'normal') {
    return `【教学深模块｜${heading}】\n${[
      ...common,
      '根据内容难度保持详略得当；简单内容可以简洁讲解，通过自然互动确认理解后推进，不机械拉长。',
    ].join('\n')}`;
  }
  const keyPolicy = [
    '不只给结论，更详细地展开说明概念成立的原因、前提、边界和适用条件。',
    '视需要加入例子、反例、对比或图形进行补充说明。',
    '主动展开典型误区、易漏条件和容易混淆的相邻概念。',
    '用一个有思考密度的综合问题连接核心关系；只追问回答真实暴露的理解缺口，同一缺口最多追问一次，不把深度教学变成细节盘问。',
    '学习者出现误解时换一种解释、例子或思考角度继续，而不是直接判定完成或重复原问题。',
  ];
  const difficultPolicy = [
    '围绕学习者已经出现的错误、误解、不解或深入讲解需求进行针对性讲解。',
    '更换例子、类比、反例、图形或推理路径，不机械重复原有解释。',
    '一次针对性追问后不再停留于相同缺口，改用新的解释或任务表征，推进到更深一层理解。',
  ];
  return `【教学深模块｜${heading}】\n${[
    ...common,
    ...(emphasis === 'key' || emphasis === 'key_difficult' ? keyPolicy : []),
    ...(emphasis === 'difficult' || emphasis === 'key_difficult' ? difficultPolicy : []),
  ].join('\n')}`;
}
