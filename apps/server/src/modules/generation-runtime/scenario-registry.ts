export const AI_SCENARIOS = [
  'course-authoring-conversation',
  'outline-candidate',
  'outline-candidate-alignment',
  'interactive-teaching',
  'interactive-teaching-observation',
  'stage-review',
  'final-review',
  'course-review',
  'weekly-report',
  'learning-portrait',
  'next-lesson-recommendation',
  'reasoning-behavior-analysis',
  'profile-evidence-extraction',
] as const;

export type AiScenario = (typeof AI_SCENARIOS)[number];

export function assertKnownAiScenario(taskKind: string): asserts taskKind is AiScenario {
  if (!(AI_SCENARIOS as readonly string[]).includes(taskKind)) {
    throw Object.assign(new Error(`unknown_ai_scenario:${taskKind}`), {
      code: 'unknown_ai_scenario',
      taskKind,
    });
  }
}
