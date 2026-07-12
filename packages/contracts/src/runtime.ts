import { z } from 'zod';

export const RuntimeReadySchema = z.strictObject({
  status: z.enum(['starting', 'ready', 'degraded', 'rebuilding', 'stopping']),
  instanceId: z.string().trim().min(1).max(200),
  buildId: z.string().trim().min(1).max(200),
  protocolVersion: z.string().trim().min(1).max(50),
  storeStatus: z.enum(['ready', 'recovering', 'degraded']),
  projectionStatus: z.enum(['ready', 'rebuilding', 'degraded']),
  providerStatus: z.enum(['ready', 'degraded', 'unconfigured']),
  generation: z.number().int().positive().optional(),
  startedAt: z.iso.datetime({ offset: true }).optional(),
  identityFingerprint: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  reasonCode: z
    .string()
    .regex(/^[a-z0-9_]+$/)
    .optional(),
});

export type RuntimeReady = Readonly<z.infer<typeof RuntimeReadySchema>>;
