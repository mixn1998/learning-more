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
  reasoningEffort: z.string().trim().min(1).max(100).optional(),
  configurationState: z.enum(['applied', 'connecting', 'failed']),
  capabilities: ProviderSwitchResponseSchema.shape.capabilities,
  health: z.strictObject({ status: z.enum(['healthy', 'unhealthy']) }),
});

export const ProviderModelOptionSchema = z.strictObject({
  id: z.string().trim().min(1).max(500),
  displayName: z.string().trim().min(1).max(500),
  defaultReasoningEffort: z.string().trim().min(1).max(100),
  supportedReasoningEfforts: z.array(z.string().trim().min(1).max(100)).min(1),
});

export const ProviderCatalogEntrySchema = z.strictObject({
  providerId: ProviderIdSchema,
  capabilities: ProviderSwitchResponseSchema.shape.capabilities,
  health: z.strictObject({
    status: z.enum(['healthy', 'unhealthy']),
    message: z.string().trim().min(1).max(500).optional(),
  }),
  models: z.array(ProviderModelOptionSchema),
});

export const ProviderCatalogSchema = z.strictObject({
  providers: z.array(ProviderCatalogEntrySchema),
});

export const CodexLoginStartResponseSchema = z.strictObject({
  state: z.enum(['started', 'already_authenticated']),
});

export type ProviderSwitchRequest = Readonly<z.infer<typeof ProviderSwitchRequestSchema>>;
export type ProviderSwitchResponse = Readonly<z.infer<typeof ProviderSwitchResponseSchema>>;
export type ProviderRuntimeStatus = Readonly<z.infer<typeof ProviderRuntimeStatusSchema>>;
export type ProviderModelOption = Readonly<z.infer<typeof ProviderModelOptionSchema>>;
export type ProviderCatalogEntry = Readonly<z.infer<typeof ProviderCatalogEntrySchema>>;
export type ProviderCatalog = Readonly<z.infer<typeof ProviderCatalogSchema>>;
export type CodexLoginStartResponse = Readonly<z.infer<typeof CodexLoginStartResponseSchema>>;
