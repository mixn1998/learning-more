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

export const RuntimeDiagnosticsResponseSchema = z.strictObject({
  artifactRef: z.string().trim().min(1).max(500),
});

export type RuntimeDiagnosticsResponse = Readonly<z.infer<typeof RuntimeDiagnosticsResponseSchema>>;

export const LauncherRuntimeStatusSchema = z.strictObject({
  state: z.enum([
    'stopped',
    'starting',
    'healthy',
    'degraded',
    'restarting',
    'rebuilding',
    'backoff',
    'blocked_external_port',
    'blocked_identity_mismatch',
    'blocked_restart_storm',
    'blocked_invalid_config',
    'blocked_store_corrupted',
    'blocked_migration_failed',
  ]),
  crashCount: z.number().int().nonnegative(),
  targetBuildId: z.string().trim().min(1).max(200).optional(),
});

export type LauncherRuntimeStatus = Readonly<z.infer<typeof LauncherRuntimeStatusSchema>>;

export const LauncherControlStatusSchema = LauncherRuntimeStatusSchema.extend({
  capability: z.string().trim().min(1).max(500),
  capabilityExpiresAt: z.number().int().positive(),
});

export type LauncherControlStatus = Readonly<z.infer<typeof LauncherControlStatusSchema>>;
