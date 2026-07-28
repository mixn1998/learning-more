export const AI_SCENARIOS = [
  'course-authoring-conversation',
  'outline-candidate',
  'outline-candidate-alignment',
  'teaching-weight-analysis',
  'interactive-teaching',
  'interactive-teaching-observation',
  'supplementary-learning',
  'stage-review',
  'final-review',
  'course-review',
  'weekly-report',
  'next-lesson-recommendation',
  'reasoning-behavior-analysis',
  'semantic-profile-core',
  'profile-evidence-extraction',
] as const;

export type AiScenario = (typeof AI_SCENARIOS)[number];

export type AiReasoningEffort = 'low' | 'medium' | 'high';

const SCENARIO_REASONING_EFFORT: Readonly<Partial<Record<AiScenario, AiReasoningEffort>>> = {
  'course-authoring-conversation': 'medium',
  'outline-candidate': 'high',
  'outline-candidate-alignment': 'medium',
  'teaching-weight-analysis': 'medium',
  'interactive-teaching': 'medium',
  'interactive-teaching-observation': 'medium',
  'supplementary-learning': 'medium',
  'stage-review': 'medium',
  'final-review': 'medium',
  'course-review': 'medium',
  'weekly-report': 'low',
  'next-lesson-recommendation': 'low',
  'reasoning-behavior-analysis': 'medium',
  'semantic-profile-core': 'medium',
  'profile-evidence-extraction': 'medium',
};

export function reasoningEffortForScenario(taskKind: string): AiReasoningEffort | undefined {
  return SCENARIO_REASONING_EFFORT[taskKind as AiScenario];
}

export function assertKnownAiScenario(taskKind: string): asserts taskKind is AiScenario {
  if (!(AI_SCENARIOS as readonly string[]).includes(taskKind)) {
    throw Object.assign(new Error(`unknown_ai_scenario:${taskKind}`), {
      code: 'unknown_ai_scenario',
      taskKind,
    });
  }
}
