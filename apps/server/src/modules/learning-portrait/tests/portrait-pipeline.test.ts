import { describe, expect, it } from 'vitest';

import type { CandidateEvidence } from '../../profile-evidence/interface.js';
import type { GlobalLearningProfile } from '../../profile-evidence/implementation/global-learning-profile.js';
import { preparePortraitIncrement } from '../implementation/portrait-pipeline.js';

const profile = { profileChecksum: 'checksum' } as GlobalLearningProfile;
const evidence = ['e1', 'e2', 'e3'].map(
  (evidenceId, index) =>
    ({
      evidenceId,
      observedAt: `2026-07-1${index}T00:00:00.000Z`,
    }) as CandidateEvidence,
);

describe('portrait incremental pipeline', () => {
  it('[EQ-POR-02] reads the full profile once, then consumes only evidence after the cursor and reports backlog', () => {
    const first = preparePortraitIncrement({ profile, evidence, limit: 2 });
    expect(first).toMatchObject({
      profileSnapshot: profile,
      evidence: [{ evidenceId: 'e1' }, { evidenceId: 'e2' }],
      nextEvidenceCursor: 'e2',
      backlogCount: 1,
    });
    const next = preparePortraitIncrement({
      profile,
      evidence,
      ...(first.nextEvidenceCursor === undefined
        ? {}
        : { afterEvidenceId: first.nextEvidenceCursor }),
      limit: 2,
    });
    expect(next).toEqual({ evidence: [evidence[2]], nextEvidenceCursor: 'e3', backlogCount: 0 });
  });
});
