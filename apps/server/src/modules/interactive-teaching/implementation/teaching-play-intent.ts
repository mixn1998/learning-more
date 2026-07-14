import type { CourseMode } from '@learning-more/contracts';

const TEACHING_PLAY_INTENTS: Readonly<Record<Exclude<CourseMode, 'standard'>, string>> = {
  brainstorm: '在自然机会中帮助学习者扩大真正不同的可能性空间，发现默认假设与新的问题入口。',
  argument_clash:
    '在自然机会中通过有力异议、反例和立场交换，帮助学习者看清主张、前提、证据与价值选择。',
  case_study:
    '在自然机会中让学习者进入具体情境、真实约束和有限信息，并从判断与结果中提炼机制和迁移边界。',
  business_insight:
    '在自然机会中帮助学习者理解价值如何创造、传递和获取，以及机会与判断可以如何被证据验证。',
  process_decomposition:
    '在自然机会中帮助学习者把复杂任务或系统变得可执行、可检查、可调整，同时理解依赖与失败位置。',
  decision_analysis:
    '在自然机会中帮助学习者面对目标冲突和信息不完整，形成透明、可解释、可调整的行动判断。',
  cross_explore:
    '在自然机会中帮助学习者用不同领域视角重构问题，检查概念迁移与类比边界并形成新的理解。',
  reading_seminar:
    '在自然机会中围绕真实材料形成证据扎根的理解、讨论、批判和输出，区分作者观点与学习者判断。',
};

export function teachingPlayIntent(mode: CourseMode): string | undefined {
  return mode === 'standard' ? undefined : TEACHING_PLAY_INTENTS[mode];
}
