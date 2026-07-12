import { describe, expect, it } from 'vitest';

import {
  checkEquivalence,
  checkEquivalenceSource,
  extractEquivalenceSource,
  type EquivalenceEntry,
} from './check-equivalence.js';

function entry(overrides: Partial<EquivalenceEntry> = {}): EquivalenceEntry {
  return {
    id: 'EQ-TEST-01',
    sourceHeading: '测试断言',
    assertion: '测试行为必须保持不变',
    ownerModule: 'LearningSession',
    testLevel: 'domain',
    automatedTest: 'apps/server/src/modules/learning-session/tests/example.test.ts',
    status: 'unimplemented',
    ...overrides,
  };
}

describe('equivalence matrix checks', () => {
  it('rejects an entry with a missing id', () => {
    const invalid = { ...entry(), id: undefined } as unknown as EquivalenceEntry;

    expect(checkEquivalence([invalid], 1, () => true)).toContainEqual({
      code: 'MISSING_FIELD',
      field: 'id',
      index: 0,
    });
  });

  it('rejects duplicate ids', () => {
    expect(checkEquivalence([entry(), entry()], 2, () => true)).toContainEqual({
      code: 'DUPLICATE_ID',
      id: 'EQ-TEST-01',
    });
  });

  it('rejects a matrix whose assertion count is not the expected count', () => {
    expect(checkEquivalence([entry()], 74, () => true)).toContainEqual({
      actual: 1,
      code: 'COUNT_MISMATCH',
      expected: 74,
    });
  });

  it('accepts alphanumeric requirement categories used by the source baseline', () => {
    expect(checkEquivalence([entry({ id: 'EQ-I18N-01' })], 1, () => true)).toEqual([]);
  });

  it('rejects passing entries whose automated test does not exist', () => {
    expect(checkEquivalence([entry({ status: 'passing' })], 1, () => false)).toContainEqual({
      code: 'MISSING_AUTOMATED_TEST',
      id: 'EQ-TEST-01',
      path: 'apps/server/src/modules/learning-session/tests/example.test.ts',
    });
  });

  it('rejects assertion text that drifts from the authoritative source table', () => {
    const source = extractEquivalenceSource('| EQ-TEST-01 | 测试断言 | 权威行为必须保持不变 |');

    expect(checkEquivalenceSource([entry()], source)).toContainEqual({
      code: 'SOURCE_ASSERTION_MISMATCH',
      id: 'EQ-TEST-01',
    });
  });
});
