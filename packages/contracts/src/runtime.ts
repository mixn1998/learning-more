import { z } from 'zod';

export const RuntimeReadySchema = z.strictObject({
  status: z.enum(['starting', 'ready', 'degraded', 'rebuilding', 'stopping']),
  instanceId: z.string().trim().min(1).max(200),
  buildId: z.string().trim().min(1).max(200),
  protocolVersion: z.string().trim().min(1).max(50),
  storeStatus: z.enum(['ready', 'recovering', 'degraded']),
  projectionStatus: z.enum(['ready', 'rebuilding', 'degraded']),
  providerStatus: z.enum(['ready', 'degraded', 'unconfigured']),
});

export type RuntimeReady = Readonly<z.infer<typeof RuntimeReadySchema>>;
