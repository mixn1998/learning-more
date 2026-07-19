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

  it('[EQ-POR-10] exposes re-abstracted global dimensions without template copy', () => {
    const workspaceModel = readFileSync(
      path.join(root, 'apps/web/src/features/profile/portrait-workspace-model.ts'),
      'utf8',
    );
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
    expect(workspaceModel).toContain('evidence.summary.trim()');
    expect(workspaceModel).not.toContain('在这次学习中，你也出现了与上面描述相符的做法。');
    expect(projector).toContain('representativeRationale');
    expect(projector).not.toContain('combineReasoningBehaviorSummaries');
    expect(profileRuntime).toContain('reasoningEvidenceSummaryForRead');
  });
});
