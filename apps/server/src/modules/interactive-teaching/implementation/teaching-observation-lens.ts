import type { CourseMode } from '@learning-more/contracts';
import type { TeachingObservationLens } from '../ports/teaching-observer.js';

const NON_REQUIREMENTS = [
  '不要求每一轮都体现该观察重心。',
  '不能因为不符合该重心而忽略其他有证据支持的学习行为。',
  '不能把玩法偏好或局部表现写成稳定能力、人格或固定思维类型。',
] as const;

const PRIORITIES: Readonly<Record<CourseMode, string>> = {
  standard: '优先观察学习者如何理解、质疑、关联和修正当前知识点。',
  brainstorm: '优先观察学习者如何提出假设、扩展可能性、建立联想或发现新的问题入口。',
  argument_clash: '优先观察学习者如何提出主张、辨析前提与证据、处理反例或调整立场。',
  case_study: '优先观察学习者如何读取具体情境、约束与角色选择，并推理其后果。',
  business_insight: '优先观察学习者如何理解价值创造、价值传递、机会与可验证的商业判断。',
  process_decomposition: '优先观察学习者如何拆解步骤、依赖、瓶颈与可检验的调整。',
  decision_analysis: '优先观察学习者如何澄清目标、比较选项、说明依据与处理权衡。',
  cross_explore: '优先观察学习者如何进行概念迁移、跨域关联、类比及其边界检验。',
  reading_seminar: '优先观察学习者如何区分材料证据、作者主张与自己的解释和判断。',
};

export function teachingObservationLens(mode: CourseMode): TeachingObservationLens {
  return {
    priority: PRIORITIES[mode],
    nonRequirements: NON_REQUIREMENTS,
  };
}
