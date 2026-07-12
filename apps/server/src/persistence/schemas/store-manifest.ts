import { z } from 'zod';

export const StoreManifestSchema = z.strictObject({
  storeId: z.string().min(1),
  formatVersion: z.number().int().positive(),
  minimumReaderVersion: z.number().int().positive(),
  createdAt: z.string().min(1),
  lastCommittedTransactionId: z.string(),
  lastCommittedSequence: z.number().int().nonnegative(),
  timezone: z.string().min(1),
  checksumAlgorithm: z.literal('sha256'),
});

export type StoreManifest = z.infer<typeof StoreManifestSchema>;
