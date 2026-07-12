import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { z } from 'zod';

import {
  checksumJson,
  decodeAggregateDocument,
  decodeStoreManifest,
  encodeJson,
} from './json-codec.js';

describe('canonical JSON codec', () => {
  it('encodes equal objects to identical UTF-8 text regardless of insertion order', () => {
    expect(encodeJson({ b: 2, a: 1 })).toBe(encodeJson({ a: 1, b: 2 }));
    expect(encodeJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}\n');
  });

  it('is deterministic for 1,000 generated JSON values', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const decoded = JSON.parse(encodeJson(value)) as unknown;
        expect(encodeJson(decoded)).toBe(encodeJson(value));
      }),
      { numRuns: 1_000 },
    );
  });

  it('validates an aggregate envelope before returning its data', () => {
    const data = { title: '中文课程', lessonCount: 2 };
    const document = {
      schema: 'learning-more/course',
      schemaVersion: 1,
      entityType: 'courses',
      entityId: 'course_01',
      resourceVersion: 1,
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
      contentSha256: checksumJson(data),
      data,
    };

    expect(
      decodeAggregateDocument(
        encodeJson(document),
        z.object({ title: z.string(), lessonCount: z.number() }),
      ),
    ).toEqual(document);
  });

  it('reports checksum mismatches as storage corruption', () => {
    const document = {
      schema: 'learning-more/course',
      schemaVersion: 1,
      entityType: 'courses',
      entityId: 'course_01',
      resourceVersion: 1,
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
      contentSha256: `sha256:${'0'.repeat(64)}`,
      data: { title: 'tampered' },
    };

    expect(() =>
      decodeAggregateDocument(encodeJson(document), z.object({ title: z.string() })),
    ).toThrow(expect.objectContaining({ code: 'storage_corrupted' }));
  });

  it('distinguishes an unsupported store version from corruption', () => {
    const manifest = {
      storeId: 'store_01',
      formatVersion: 2,
      minimumReaderVersion: 2,
      createdAt: '2026-07-13T00:00:00.000Z',
      lastCommittedTransactionId: 'tx_01',
      lastCommittedSequence: 0,
      timezone: 'Asia/Shanghai',
      checksumAlgorithm: 'sha256',
    };

    expect(() => decodeStoreManifest(encodeJson(manifest), 1)).toThrow(
      expect.objectContaining({ code: 'store_version_unsupported' }),
    );
  });
});
