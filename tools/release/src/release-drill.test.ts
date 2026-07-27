import { describe, expect, it } from 'vitest';

import { releaseReady } from './release-drill.js';

const portable = {
  expandedRoot: 'expanded',
  zipPath: 'release.zip',
  zipSha256: 'a'.repeat(64),
  buildId: 'build_01',
};

describe('release drill gate', () => {
  it('requires every executed step and two byte-identical portable builds', () => {
    expect(
      releaseReady({
        steps: [
          {
            name: 'verify',
            command: 'pnpm verify:full',
            status: 'passed',
            durationMs: 1,
            outputTail: '',
          },
        ],
        firstPortable: portable,
        secondPortable: portable,
      }),
    ).toBe(true);
    expect(
      releaseReady({
        steps: [
          { name: 'smoke', command: 'smoke', status: 'failed', durationMs: 1, outputTail: '' },
        ],
        firstPortable: portable,
        secondPortable: { ...portable, zipSha256: 'b'.repeat(64) },
      }),
    ).toBe(false);
  });
});
