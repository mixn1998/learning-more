import type { CourseMode } from '@learning-more/contracts';

const MODE_INTENTS: Readonly<Record<CourseMode, string>> = {
  standard: 'build a coherent course from the learner topic',
  brainstorm: 'open multiple plausible directions before converging',
  argument_clash: 'surface competing claims and the evidence behind them',
  case_study: 'learn through concrete cases and transferable reasoning',
  business_insight: 'connect evidence, mechanisms, and business implications',
  process_decomposition: 'trace a process through constraints, steps, and feedback',
  decision_analysis: 'compare choices, uncertainty, risks, and tradeoffs',
  cross_explore: 'connect the topic with independently useful adjacent domains',
  reading_seminar: 'teach from supplied material with precise source traceability',
};

export function buildCourseModeContext(mode: CourseMode, topic: string) {
  return {
    mode,
    topic: topic.trim(),
    intent: MODE_INTENTS[mode],
    freedoms: ['module-count', 'stage-count', 'lesson-types', 'review-organization'] as const,
  };
}

export function courseModeIntents(): Readonly<Record<CourseMode, string>> {
  return { ...MODE_INTENTS };
}
