import { z } from 'zod';

import type { RejectedEvidenceRecord, SourceCheckpoint } from '../interface.js';

export const SourceCheckpointSchema = z.strictObject({
  checkpointId: z.string().min(1).max(200),
  sourceGroup: z.enum(['behavior', 'outcome', 'reflection', 'planning', 'review']),
  lastFactId: z.string().min(1).max(200).optional(),
  extractorVersion: z.string().min(1).max(100),
  outputChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  processedFactCount: z.number().int().nonnegative(),
  rejectedFactCount: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime({ offset: true }),
  resourceVersion: z.number().int().nonnegative(),
});

export function parseSourceCheckpoint(input: unknown): SourceCheckpoint {
  const { lastFactId, ...required } = SourceCheckpointSchema.parse(input);
  return { ...required, ...(lastFactId === undefined ? {} : { lastFactId }) };
}

export const RejectedEvidenceRecordSchema = z.strictObject({
  rejectionId: z.string().min(1).max(200),
  factId: z.string().min(1).max(200),
  sourceGroup: z.enum(['behavior', 'outcome', 'reflection', 'planning', 'review']),
  extractorVersion: z.string().min(1).max(100),
  errorCode: z.string().min(1).max(200),
  rejectedAt: z.iso.datetime({ offset: true }),
  resourceVersion: z.number().int().nonnegative(),
});

export function parseRejectedEvidenceRecord(input: unknown): RejectedEvidenceRecord {
  return RejectedEvidenceRecordSchema.parse(input);
}
