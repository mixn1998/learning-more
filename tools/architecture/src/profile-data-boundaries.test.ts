import { readFileSync } from 'node:fs';
import path from 'node:path';

import { EVENT_TYPES } from '@learning-more/contracts';
import { describe, expect, it } from 'vitest';

describe('profile data architecture boundaries', () => {
  const root = process.cwd();

  it('[EQ-HIS-09] keeps provider, latency, error, page, network, and write-lease telemetry outside facts and profile inputs', () => {
    const mapping = readFileSync(
      path.join(root, 'apps/server/src/modules/learning-facts/implementation/event-to-fact.ts'),
      'utf8',
    );
    const profile = readFileSync(
      path.join(
        root,
        'apps/server/src/modules/profile-evidence/implementation/profile-projection.ts',
      ),
      'utf8',
    );
    expect(mapping).not.toMatch(/telemetry\./u);
    expect(profile).not.toMatch(
      /providerStatus|generationLatency|pageView|networkState|writeLease/u,
    );
  });

  it('[EQ-POR-09] exposes no portrait candidate feedback/rejection event or profile-page control', () => {
    expect(EVENT_TYPES).not.toContain('PortraitCandidateRejected');
    const profilePage = readFileSync(
      path.join(root, 'apps/web/src/features/profile/profile-page.tsx'),
      'utf8',
    );
    const portraitWorkspace = readFileSync(
      path.join(root, 'apps/web/src/features/profile/portrait-workspace.tsx'),
      'utf8',
    );
    expect(`${profilePage}\n${portraitWorkspace}`).not.toMatch(
      /candidate.?reject|portrait.?feedback|拒绝候选|画像反馈/iu,
    );
  });
});
