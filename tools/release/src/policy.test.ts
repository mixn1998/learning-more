import { describe, expect, it } from 'vitest';

import { evaluateLicenses } from './license-policy.js';
import {
  evaluateLockfileImporter,
  evaluateVulnerabilities,
  type VulnerabilityFinding,
} from './vulnerability-policy.js';

describe('release supply-chain policy', () => {
  it('rejects dependencies whose license is unknown', () => {
    const result = evaluateLicenses([{ name: 'mystery', version: '1.0.0' }]);

    expect(result.status).toBe('failed');
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'unknown_license', package: 'mystery', version: '1.0.0' }),
    );
  });

  it('rejects prohibited licenses and accepts an allowed SPDX alternative', () => {
    const denied = evaluateLicenses([
      { name: 'copyleft', version: '1.0.0', license: 'AGPL-3.0-only' },
    ]);
    const alternative = evaluateLicenses([
      { name: 'dual', version: '1.0.0', license: 'MIT OR GPL-3.0-only' },
    ]);

    expect(denied.status).toBe('failed');
    expect(denied.issues[0]?.code).toBe('prohibited_license');
    expect(alternative).toEqual({ status: 'passed', issues: [] });
  });

  const high: VulnerabilityFinding = {
    advisoryId: 'GHSA-test-high',
    package: 'unsafe-package',
    version: '2.0.0',
    severity: 'high',
    title: 'test advisory',
  };

  it('rejects high or critical vulnerabilities without an exact, complete exception', () => {
    expect(evaluateVulnerabilities([high], [], new Date('2026-07-13T00:00:00Z')).status).toBe(
      'failed',
    );
    expect(
      evaluateVulnerabilities(
        [high],
        [
          {
            advisoryId: high.advisoryId,
            package: high.package,
            version: high.version,
            reason: '',
            owner: 'security@example.test',
            expiresAt: '2026-08-01T00:00:00Z',
          },
        ],
        new Date('2026-07-13T00:00:00Z'),
      ).issues,
    ).toContainEqual(expect.objectContaining({ code: 'invalid_exception' }));
  });

  it('accepts only an exact, unexpired vulnerability exception', () => {
    const exception = {
      advisoryId: high.advisoryId,
      package: high.package,
      version: high.version,
      reason: 'No patched release; server input cannot reach the affected code path.',
      owner: 'security@example.test',
      expiresAt: '2026-08-01T00:00:00Z',
    };

    expect(evaluateVulnerabilities([high], [exception], new Date('2026-07-13T00:00:00Z'))).toEqual({
      status: 'passed',
      issues: [],
    });
    expect(
      evaluateVulnerabilities([high], [exception], new Date('2026-08-01T00:00:00Z')).issues,
    ).toContainEqual(expect.objectContaining({ code: 'expired_exception' }));
    expect(
      evaluateVulnerabilities(
        [high],
        [{ ...exception, version: '1.9.0' }],
        new Date('2026-07-13T00:00:00Z'),
      ).issues,
    ).toContainEqual(expect.objectContaining({ code: 'unexcepted_vulnerability' }));
  });

  it('rejects manifest and lockfile importer drift', () => {
    const result = evaluateLockfileImporter(
      { dependencies: { alpha: '^1.0.0', beta: '^2.0.0' } },
      { dependencies: { alpha: { specifier: '^1.0.0', version: '1.0.1' } } },
    );

    expect(result.status).toBe('failed');
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'lockfile_specifier_missing', package: 'beta' }),
    );
  });
});
