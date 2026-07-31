import { readFileSync } from 'node:fs';
import path from 'node:path';

import { EVENT_TYPES } from '@learning-more/contracts';
import { describe, expect, it } from 'vitest';

describe('profile data architecture boundaries', () => {
  const root = process.cwd();

  it('[EQ-HIS-09] keeps telemetry outside facts and profile inputs', () => {
    const mapping = readFileSync(
      path.join(root, 'apps/server/src/modules/learning-facts/implementation/event-to-fact.ts'),
      'utf8',
    );
    const profile = [
      'profile-evidence-aggregator.ts',
      'profile-evidence-context-assembler.ts',
      'reasoning-evidence-projector.ts',
    ]
      .map((file) =>
        readFileSync(
          path.join(root, 'apps/server/src/modules/profile-evidence/implementation', file),
          'utf8',
        ),
      )
      .join('\n');
    expect(mapping).not.toMatch(/telemetry\./u);
    expect(profile).not.toMatch(
      /providerStatus|generationLatency|pageView|networkState|writeLease/u,
    );
  });

  it('removes the portrait product chain while retaining the upstream profile layer', () => {
    expect(EVENT_TYPES).not.toContain('PortraitCandidateRejected');
    const router = readFileSync(path.join(root, 'apps/web/src/router.tsx'), 'utf8');
    const assembly = readFileSync(
      path.join(root, 'apps/server/src/bootstrap/local-application/assemble.ts'),
      'utf8',
    );
    const scenarios = readFileSync(
      path.join(root, 'apps/server/src/modules/generation-runtime/scenario-registry.ts'),
      'utf8',
    );
    expect(router).not.toContain("path: '/profile'");
    expect(assembly).not.toContain('portraitRoutes');
    expect(scenarios).not.toContain("'learning-portrait'");
    expect(assembly).toContain('profile: profile.profileRoutes');
  });

  it('preserves re-abstracted reasoning evidence in the upstream profile layer', () => {
    const projector = readFileSync(
      path.join(
        root,
        'apps/server/src/modules/profile-evidence/implementation/reasoning-evidence-projector.ts',
      ),
      'utf8',
    );
    const profileRuntime = readFileSync(
      path.join(root, 'apps/server/src/bootstrap/local-application/profile-runtime.ts'),
      'utf8',
    );
    expect(projector).toContain('representativeRationale');
    expect(projector).not.toContain('combineReasoningBehaviorSummaries');
    expect(profileRuntime).toContain('createReasoningEvidenceProjector');
    expect(profileRuntime).not.toContain('learning-portrait');
  });
});
