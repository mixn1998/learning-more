import { createHash } from 'node:crypto';

import { z } from 'zod';

import { aggregateDocumentSchema, type AggregateDocument } from './schemas/aggregate-document.js';
import { StoreManifestSchema, type StoreManifest } from './schemas/store-manifest.js';

type StorageDocumentErrorCode = 'storage_corrupted' | 'store_version_unsupported';

export class StorageDocumentError extends Error {
  constructor(
    readonly code: StorageDocumentErrorCode,
    cause?: unknown,
  ) {
    super(code, { cause });
    this.name = 'StorageDocumentError';
  }
}

function canonicalValue(value: unknown, ancestors: Set<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('JSON_NUMBER_NOT_FINITE');
    return value;
  }
  if (typeof value !== 'object') throw new TypeError('VALUE_NOT_JSON_SERIALIZABLE');
  if (ancestors.has(value)) throw new TypeError('JSON_CYCLE');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => canonicalValue(item, ancestors));
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('VALUE_NOT_PLAIN_JSON_OBJECT');
    }
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right, 'en-US'))
        .map(([key, item]) => [key, canonicalValue(item, ancestors)]),
    );
  } finally {
    ancestors.delete(value);
  }
}

export function encodeJson(value: unknown): string {
  return `${JSON.stringify(canonicalValue(value, new Set()))}\n`;
}

export function checksumJson(value: unknown): string {
  return `sha256:${createHash('sha256').update(encodeJson(value), 'utf8').digest('hex')}`;
}

function parseStoredJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new StorageDocumentError('storage_corrupted', error);
  }
}

export function decodeAggregateDocument<TSchema extends z.ZodType>(
  text: string,
  dataSchema: TSchema,
): AggregateDocument<z.output<TSchema>> {
  try {
    const document = aggregateDocumentSchema(dataSchema).parse(
      parseStoredJson(text),
    ) as AggregateDocument<z.output<TSchema>>;
    if (checksumJson(document.data) !== document.contentSha256) {
      throw new StorageDocumentError('storage_corrupted');
    }
    return document;
  } catch (error) {
    if (error instanceof StorageDocumentError) throw error;
    throw new StorageDocumentError('storage_corrupted', error);
  }
}

export function decodeStoreManifest(text: string, readerVersion: number): StoreManifest {
  let manifest: StoreManifest;
  try {
    manifest = StoreManifestSchema.parse(parseStoredJson(text));
  } catch (error) {
    if (error instanceof StorageDocumentError) throw error;
    throw new StorageDocumentError('storage_corrupted', error);
  }
  if (manifest.minimumReaderVersion > readerVersion) {
    throw new StorageDocumentError('store_version_unsupported');
  }
  return manifest;
}
