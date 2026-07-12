import { describe, expect, it } from 'vitest';

import { ApplicationProblemSchema, ERROR_CODES } from './errors.js';

describe('ApplicationProblem contract', () => {
  const validProblem = {
    type: 'https://learning-more.local/problems/version-conflict',
    status: 412,
    code: 'version_conflict',
    messageKey: 'errors.versionConflict',
    retryable: true,
    correlationId: 'corr-0001',
    currentVersion: 4,
    recovery: {
      action: 'refresh',
      resourceRef: 'course-0001',
    },
  } as const;

  it('accepts a declared problem without changing its wire shape', () => {
    expect(ApplicationProblemSchema.parse(validProblem)).toEqual(validProblem);
  });

  it('rejects undeclared error codes', () => {
    expect(
      ApplicationProblemSchema.safeParse({ ...validProblem, code: 'unknown_problem' }).success,
    ).toBe(false);
  });

  it('rejects stack traces and other undeclared fields', () => {
    expect(ApplicationProblemSchema.safeParse({ ...validProblem, stack: 'secret' }).success).toBe(
      false,
    );
  });

  it('keeps the stable error-code registry unique', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    expect(ERROR_CODES).toContain('final_review_immutable');
    expect(ERROR_CODES).toContain('storage_corrupted');
  });
});
