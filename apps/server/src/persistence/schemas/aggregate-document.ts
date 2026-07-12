import { z } from 'zod';

export interface AggregateDocument<T> {
  readonly schema: string;
  readonly schemaVersion: number;
  readonly entityType: string;
  readonly entityId: string;
  readonly resourceVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly contentSha256: string;
  readonly data: T;
}

export function aggregateDocumentSchema<TSchema extends z.ZodType>(dataSchema: TSchema) {
  return z.strictObject({
    schema: z.string().min(1),
    schemaVersion: z.number().int().positive(),
    entityType: z.string().min(1),
    entityId: z.string().min(1),
    resourceVersion: z.number().int().nonnegative(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    contentSha256: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    data: dataSchema,
  });
}
