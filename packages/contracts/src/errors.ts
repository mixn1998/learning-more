import { z } from 'zod';

export const ERROR_CODES = [
  'request_invalid',
  'precondition_required',
  'resource_not_found',
  'local_request_forbidden',
  'topic_required',
  'message_required',
  'session_not_found',
  'session_closed',
  'assessment_required',
  'candidate_invalid',
  'candidate_stale',
  'confirmation_in_progress',
  'confirmation_failed',
  'outline_session_transition_invalid',
  'immutable_resource',
  'version_conflict',
  'idempotency_conflict',
  'lesson_not_startable',
  'lesson_not_restorable',
  'lesson_not_completable',
  'session_not_writable',
  'session_conflict',
  'lesson_not_closable',
  'write_lease_lost',
  'final_review_immutable',
  'course_not_closable',
  'course_closed',
  'generation_in_progress',
  'generation_capacity_exceeded',
  'generation_cancelled',
  'generation_timeout',
  'ai_unavailable',
  'provider_validation_failed',
  'projection_incomplete',
  'storage_corrupted',
  'internal_error',
] as const;

export const RECOVERY_ACTIONS = [
  'retry',
  'refresh',
  'reconnect_ai',
  'take_over_lease',
  'resume_learning',
  'return_home',
] as const;

export const RecoveryInstructionSchema = z.strictObject({
  action: z.enum(RECOVERY_ACTIONS),
  resourceRef: z.string().trim().min(1).max(300).optional(),
});

export const ApplicationProblemSchema = z.strictObject({
  type: z.string().url(),
  status: z.number().int().min(400).max(599),
  code: z.enum(ERROR_CODES),
  messageKey: z.string().regex(/^errors\.[A-Za-z][A-Za-z0-9]*$/),
  retryable: z.boolean(),
  correlationId: z.string().trim().min(1).max(200),
  fieldErrors: z.record(z.string(), z.string()).optional(),
  currentVersion: z.number().int().nonnegative().optional(),
  recovery: RecoveryInstructionSchema.optional(),
});

export type ErrorCode = (typeof ERROR_CODES)[number];
export type RecoveryAction = (typeof RECOVERY_ACTIONS)[number];
export type RecoveryInstruction = Readonly<z.infer<typeof RecoveryInstructionSchema>>;
export type ApplicationProblem = Readonly<z.infer<typeof ApplicationProblemSchema>>;
