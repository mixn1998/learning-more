import { z } from 'zod';

const ProviderIdSchema = z.string().trim().min(1).max(200);
const SecretHandleSchema = z.string().trim().min(1).max(500);

export const ProviderSwitchRequestSchema = z.strictObject({
  providerId: ProviderIdSchema,
  publicConfig: z.record(z.string().trim().min(1).max(200), z.json()),
  secretHandles: z.record(z.string().trim().min(1).max(200), SecretHandleSchema),
});

export const ProviderSwitchResponseSchema = z.strictObject({
  providerId: ProviderIdSchema,
  capabilities: z.strictObject({
    id: ProviderIdSchema,
    kind: z.enum(['mock', 'api', 'cli']),
    maxConcurrency: z.number().int().positive().max(100),
    supportsStreaming: z.literal(true),
  }),
  health: z.strictObject({ status: z.literal('healthy') }),
});

export const ProviderRuntimeStatusSchema = z.strictObject({
  providerId: ProviderIdSchema,
  model: z.string().trim().min(1).max(500).optional(),
  capabilities: ProviderSwitchResponseSchema.shape.capabilities,
  health: z.strictObject({ status: z.enum(['healthy', 'unhealthy']) }),
});

export type ProviderSwitchRequest = Readonly<z.infer<typeof ProviderSwitchRequestSchema>>;
export type ProviderSwitchResponse = Readonly<z.infer<typeof ProviderSwitchResponseSchema>>;
export type ProviderRuntimeStatus = Readonly<z.infer<typeof ProviderRuntimeStatusSchema>>;
