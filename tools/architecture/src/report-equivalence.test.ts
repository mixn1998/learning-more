import { describe, expect, it } from 'vitest';

import type { EquivalenceEntry } from './check-equivalence.js';
import {
  checkReleaseEvidence,
  createEquivalenceReport,
  parsePlaywrightReport,
  parseVitestReport,
} from './report-equivalence.js';

function entry(overrides: Partial<EquivalenceEntry> = {}): EquivalenceEntry {
  return {
    id: 'EQ-TEST-01',
    sourceHeading: '发布证据',
    assertion: '必须由实际通过的测试支撑',
    ownerModule: 'LearningSession',
    testLevel: 'domain',
    automatedTest: 'tests/example.test.ts',
    status: 'passing',
    ...overrides,
  };
}

describe('equivalence release evidence', () => {
  it('rejects every unimplemented entry with its exact id', () => {
    expect(
      checkReleaseEvidence([entry({ id: 'EQ-LESSON-12', status: 'unimplemented' })], []),
    ).toContainEqual({ code: 'UNIMPLEMENTED_EQUIVALENCE', id: 'EQ-LESSON-12' });
  });

  it('rejects missing and failed exact-id test results', () => {
    expect(checkReleaseEvidence([entry()], [])).toContainEqual({
      code: 'MISSING_EQUIVALENCE_RESULT',
      id: 'EQ-TEST-01',
      path: 'tests/example.test.ts',
    });
    expect(
      checkReleaseEvidence(
        [entry()],
        [
          {
            filePath: 'tests/example.test.ts',
            title: '[EQ-TEST-01] verifies behavior',
            status: 'failed',
          },
        ],
      ),
    ).toContainEqual({
      code: 'FAILED_EQUIVALENCE_RESULT',
      id: 'EQ-TEST-01',
      path: 'tests/example.test.ts',
    });
  });

  it('accepts an actually passed exact-id result from the mapped file', () => {
    expect(
      checkReleaseEvidence(
        [entry()],
        [
          {
            filePath: 'tests/example.test.ts',
            title: '[EQ-TEST-01] verifies behavior',
            status: 'passed',
          },
        ],
      ),
    ).toEqual([]);
  });

  it('normalizes Vitest and Playwright JSON reports', () => {
    const vitest = parseVitestReport({
      testResults: [
        {
          name: 'D:/repo/tests/example.test.ts',
          assertionResults: [{ fullName: '[EQ-TEST-01] unit', status: 'passed' }],
        },
      ],
    });
    const playwright = parsePlaywrightReport({
      suites: [
        {
          file: 'tests/example.spec.ts',
          specs: [
            {
              title: '[EQ-TEST-02] browser',
              tests: [{ results: [{ status: 'passed' }] }],
            },
          ],
        },
      ],
    });

    expect(vitest).toContainEqual({
      filePath: 'D:/repo/tests/example.test.ts',
      title: '[EQ-TEST-01] unit',
      status: 'passed',
    });
    expect(playwright).toContainEqual({
      filePath: 'tests/example.spec.ts',
      title: '[EQ-TEST-02] browser',
      status: 'passed',
    });
  });

  it('renders module and test-level summaries without claiming failures passed', () => {
    const report = createEquivalenceReport(
      [entry(), entry({ id: 'EQ-TEST-02', status: 'unimplemented', testLevel: 'e2e' })],
      [{ filePath: 'tests/example.test.ts', title: '[EQ-TEST-01] unit', status: 'passed' }],
    );

    expect(report).toContain('LearningSession');
    expect(report).toContain('| domain | 1 | 1 | 0 |');
    expect(report).toContain('| e2e | 1 | 0 | 1 |');
  });
});
