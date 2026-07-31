import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { planAffectedVerification } from './verify-change.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('affected verification planner', () => {
  it('keeps documentation-only changes local to formatting', () => {
    expect(
      planAffectedVerification(repositoryRoot, ['docs/security-and-privacy.md']),
    ).toMatchObject({
      formatFiles: ['docs/security-and-privacy.md'],
      lintFiles: [],
      relatedTestSources: [],
      typecheckPackages: [],
      gates: [],
      fullReason: undefined,
    });
  });

  it('selects a web package typecheck and related tests for a web source', () => {
    expect(
      planAffectedVerification(repositoryRoot, ['apps/web/src/features/learning/session-page.tsx']),
    ).toMatchObject({
      lintFiles: ['apps/web/src/features/learning/session-page.tsx'],
      relatedTestSources: ['apps/web/src/features/learning/session-page.tsx'],
      typecheckPackages: ['@learning-more/web'],
      fullReason: undefined,
    });
  });

  it('includes downstream consumers and contract gates for a public contract change', () => {
    const plan = planAffectedVerification(repositoryRoot, [
      'packages/contracts/src/learning-session.ts',
    ]);

    expect(plan.typecheckPackages).toEqual(
      expect.arrayContaining([
        '@learning-more/contracts',
        '@learning-more/server',
        '@learning-more/web',
        '@learning-more/architecture',
      ]),
    );
    expect(plan.gates).toEqual(expect.arrayContaining(['schema', 'architecture']));
    expect(plan.fullReason).toBeUndefined();
  });

  it('always runs a directly changed test file', () => {
    expect(
      planAffectedVerification(repositoryRoot, [
        'apps/web/src/features/learning/session-page.test.tsx',
      ]).directTestFiles,
    ).toEqual(['apps/web/src/features/learning/session-page.test.tsx']);
  });

  it('escalates verification framework and root configuration changes', () => {
    expect(
      planAffectedVerification(repositoryRoot, ['engineering/verification/verify-change.mjs'])
        .fullReason,
    ).toBe('verification_framework_changed');
    expect(planAffectedVerification(repositoryRoot, ['package.json']).fullReason).toBe(
      'root_configuration_changed',
    );
  });

  it('rejects paths outside the repository', () => {
    expect(() => planAffectedVerification(repositoryRoot, ['../outside-repository.ts'])).toThrow(
      'verification_path_outside_repository',
    );
  });
});
