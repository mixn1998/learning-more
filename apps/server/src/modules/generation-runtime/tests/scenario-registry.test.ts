import { describe, expect, it } from 'vitest';

import {
  AI_SCENARIOS,
  assertKnownAiScenario,
  reasoningEffortForScenario,
} from '../scenario-registry.js';

describe('AI scenario registry', () => {
  it('has unique production scenario names and rejects unknown kinds', () => {
    expect(new Set(AI_SCENARIOS).size).toBe(AI_SCENARIOS.length);
    expect(() => assertKnownAiScenario('weekly-report')).not.toThrow();
    expect(() => assertKnownAiScenario('hardcoded-success')).toThrow(
      expect.objectContaining({ code: 'unknown_ai_scenario' }),
    );
  });

  it.each(['outline-candidate-intent', 'plan-flow-preview'])(
    'rejects retired scenario %s',
    (scenario) => {
      expect(AI_SCENARIOS).not.toContain(scenario);
      expect(() => assertKnownAiScenario(scenario)).toThrow(
        expect.objectContaining({ code: 'unknown_ai_scenario', taskKind: scenario }),
      );
    },
  );
});

describe('generation scenario reasoning policy', () => {
  it('keeps outline synthesis deep while routing latency-sensitive tasks lower', () => {
    expect(reasoningEffortForScenario('outline-candidate')).toBe('high');
    expect(reasoningEffortForScenario('interactive-teaching')).toBe('medium');
    expect(reasoningEffortForScenario('interactive-teaching-observation')).toBe('medium');
    expect(reasoningEffortForScenario('semantic-profile-core')).toBe('medium');
    expect(reasoningEffortForScenario('next-lesson-recommendation')).toBe('low');
  });

  it('leaves unknown extension scenarios to provider defaults', () => {
    expect(reasoningEffortForScenario('custom-extension')).toBeUndefined();
  });
});
