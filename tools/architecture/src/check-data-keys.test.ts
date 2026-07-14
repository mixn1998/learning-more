import { describe, expect, it } from 'vitest';

import { DATA_KEYS } from '@learning-more/contracts';

import { checkDataKeys } from './check-data-keys.js';

describe('dataKey registry checks', () => {
  it('reports duplicate keys by value', () => {
    expect(checkDataKeys(['lesson.started_at', 'lesson.started_at'], 2)).toEqual([
      { code: 'DUPLICATE_DATA_KEY', value: 'lesson.started_at' },
    ]);
  });

  it('reports invalid dotted names', () => {
    expect(checkDataKeys(['Lesson.started-at'], 1)).toEqual([
      { code: 'INVALID_DATA_KEY', value: 'Lesson.started-at' },
    ]);
  });

  it('reports an unexpected registry size', () => {
    expect(checkDataKeys(['course.id', 'lesson.session_id'], 191)).toEqual([
      { code: 'DATA_KEY_COUNT_MISMATCH', expected: 191, actual: 2 },
    ]);
  });

  it('accepts the complete published registry', () => {
    expect(checkDataKeys(DATA_KEYS, 273)).toEqual([]);
  });
});
