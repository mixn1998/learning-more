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

export const ActivationErrorCodeSchema = z.enum([
  'source_identity_unavailable',
  'workspace_identity_changed',
  'candidate_build_failed',
  'candidate_stage_failed',
  'candidate_verification_failed',
  'activation_rolled_back',
  'host_unavailable',
  'host_identity_mismatch',
  'external_port_owner',
  'runtime_ready_timeout',
  'served_web_build_mismatch',
]);

export type ActivationErrorCode = z.infer<typeof ActivationErrorCodeSchema>;

export const WorkspaceActivationProgressSchema = z.strictObject({
  schemaVersion: z.literal(2),
  requestId: z.string().trim().min(1).max(200),
  phase: z.enum([
    'queued',
    'verifying',
    'building',
    'cleaning',
    'retrying',
    'staging',
    'activating',
    'verifying-runtime',
    'activated',
    'failed',
  ]),
  sourceBuildId: z.string().trim().min(1).max(200).optional(),
  activeBuildId: z.string().trim().min(1).max(200).optional(),
  targetBuildId: z.string().trim().min(1).max(200).optional(),
  attempt: z.union([z.literal(1), z.literal(2)]),
  errorCode: ActivationErrorCodeSchema.optional(),
  errorStage: z
    .string()
    .regex(/^[a-z0-9_-]+$/)
    .optional(),
  startedAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  completedAt: z.iso.datetime({ offset: true }).optional(),
});

export type WorkspaceActivationProgress = Readonly<
  z.infer<typeof WorkspaceActivationProgressSchema>
>;

export const WebBuildMetaSchema = z.strictObject({
  schemaVersion: z.literal(1),
  buildId: z.string().trim().min(1).max(200),
  protocolVersion: z.string().trim().min(1).max(50),
});

export type WebBuildMeta = Readonly<z.infer<typeof WebBuildMetaSchema>>;

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
    'activation_failed',
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
  activation: WorkspaceActivationProgressSchema.optional(),
});

export type LauncherRuntimeStatus = Readonly<z.infer<typeof LauncherRuntimeStatusSchema>>;

export const LauncherControlStatusSchema = LauncherRuntimeStatusSchema.extend({
  capability: z.string().trim().min(1).max(500),
  capabilityExpiresAt: z.number().int().positive(),
});

export type LauncherControlStatus = Readonly<z.infer<typeof LauncherControlStatusSchema>>;
