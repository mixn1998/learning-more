import { describe, expect, it } from 'vitest';

import { AI_SCENARIOS, assertKnownAiScenario } from '../scenario-registry.js';

describe('AI scenario registry', () => {
  it('has unique production scenario names and rejects unknown kinds', () => {
    expect(new Set(AI_SCENARIOS).size).toBe(AI_SCENARIOS.length);
    expect(() => assertKnownAiScenario('weekly-report')).not.toThrow();
    expect(() => assertKnownAiScenario('hardcoded-success')).toThrow(
      expect.objectContaining({ code: 'unknown_ai_scenario' }),
    );
  });
});
