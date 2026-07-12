import { DATA_KEY_PATTERN } from './rules.js';

export type DataKeyIssue =
  | Readonly<{ code: 'INVALID_DATA_KEY'; value: string }>
  | Readonly<{ code: 'DUPLICATE_DATA_KEY'; value: string }>
  | Readonly<{ code: 'DATA_KEY_COUNT_MISMATCH'; expected: number; actual: number }>
  | Readonly<{ code: 'DATA_KEYS_NOT_SORTED'; value: string }>;

export function checkDataKeys(values: readonly string[], expectedCount: number): DataKeyIssue[] {
  const issues: DataKeyIssue[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (!DATA_KEY_PATTERN.test(value)) {
      issues.push({ code: 'INVALID_DATA_KEY', value });
    }
    if (seen.has(value)) {
      issues.push({ code: 'DUPLICATE_DATA_KEY', value });
    }
    seen.add(value);
  }

  if (values.length !== expectedCount) {
    issues.push({
      code: 'DATA_KEY_COUNT_MISMATCH',
      expected: expectedCount,
      actual: values.length,
    });
  }

  const sorted = [...values].sort((left, right) => {
    if (left === right) return 0;
    return left < right ? -1 : 1;
  });
  const firstOutOfOrder = values.find((value, index) => value !== sorted[index]);
  if (firstOutOfOrder !== undefined) {
    issues.push({ code: 'DATA_KEYS_NOT_SORTED', value: firstOutOfOrder });
  }

  return issues;
}
