import { z } from 'zod';

const identifierSchema = z.string().trim().min(1).max(200);
const timestampSchema = z.iso.datetime({ offset: true });

export const CommandMetadataSchema = z.strictObject({
  idempotencyKey: identifierSchema,
  expectedVersion: z.number().int().nonnegative().optional(),
  pageInstanceId: identifierSchema.optional(),
  requestedAt: timestampSchema,
});

export const CommandContextSchema = CommandMetadataSchema.extend({
  commandId: identifierSchema,
  correlationId: identifierSchema,
  actor: z.literal('local-user'),
  receivedAt: timestampSchema,
});

export const QueryContextSchema = z.strictObject({
  correlationId: identifierSchema,
  actor: z.literal('local-user'),
  requestedAt: timestampSchema,
  receivedAt: timestampSchema,
});

export type CommandMetadata = Readonly<z.infer<typeof CommandMetadataSchema>>;
export type CommandContext = Readonly<z.infer<typeof CommandContextSchema>>;
export type QueryContext = Readonly<z.infer<typeof QueryContextSchema>>;
