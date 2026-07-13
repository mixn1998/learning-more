import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { COURSE_MODES } from '@learning-more/contracts';
import { describe, expect, it } from 'vitest';

function runtimeSources(root: string): string[] {
  const output: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...runtimeSources(absolute));
    else if (/\.(ts|tsx)$/u.test(entry.name) && !/\.(test|spec)\./u.test(entry.name))
      output.push(absolute);
  }
  return output;
}

describe('course mode architecture boundaries', () => {
  const repositoryRoot = process.cwd();
  const sources = [
    ...runtimeSources(path.join(repositoryRoot, 'apps')),
    ...runtimeSources(path.join(repositoryRoot, 'packages')),
  ];
  const runtime = sources.map((file) => readFileSync(file, 'utf8')).join('\n');

  it('[EQ-PLAY-02] has no inspiration runtime mode, route, storage field, or contract', () => {
    expect(COURSE_MODES).toEqual([
      'standard',
      'brainstorm',
      'argument_clash',
      'case_study',
      'business_insight',
      'process_decomposition',
      'decision_analysis',
      'cross_explore',
      'reading_seminar',
    ]);
    expect(runtime).not.toMatch(/\binspiration\b|灵感/iu);
  });

  it('[EQ-PLAY-04] keeps observation faces, method menus, and fixed activity structures out of runtime contracts', () => {
    expect(runtime).not.toMatch(
      /observationFaces|recommendedMethod|methodLibrary|activityMenu|fixedReviewSections/u,
    );
  });
});
