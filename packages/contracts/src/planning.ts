import { z } from 'zod';

const identifier = z.string().trim().min(1).max(200);
const utcInstant = z.iso.datetime({ offset: true });

export const ScheduleItemSchema = z.strictObject({
  id: identifier,
  courseId: identifier,
  lessonId: identifier,
  startAt: utcInstant,
  endAt: utcInstant,
  timezoneAtCreation: identifier,
  source: z.enum(['manual', 'plan-flow']),
  status: z.enum(['scheduled', 'removed']),
  locked: z.boolean().optional(),
  cancelReason: z
    .enum([
      'lesson_abandoned',
      'user_removed',
      'user_cleared_all',
      'outline_revised',
      'plan_flow_reflowed',
      'plan_flow_undone',
    ])
    .optional(),
  createdAt: utcInstant,
  updatedAt: utcInstant,
  processedCommandIds: z.array(identifier),
  resourceVersion: z.number().int().nonnegative(),
});

export const ScheduleAssignmentResponseSchema = z.strictObject({
  scheduleItem: ScheduleItemSchema,
});

export const ScheduleViewResponseSchema = z.strictObject({
  items: z.array(ScheduleItemSchema),
  resourceVersion: z.number().int().nonnegative(),
});

export const CreateScheduleAssignmentBodySchema = z
  .strictObject({
    courseId: identifier,
    lessonId: identifier,
    startAt: utcInstant,
    endAt: utcInstant,
    timezoneAtCreation: identifier,
  })
  .refine((value) => Date.parse(value.endAt) > Date.parse(value.startAt), {
    message: 'endAt must be later than startAt',
    path: ['endAt'],
  });

export const RequestPlanFlowPreviewBodySchema = z.strictObject({
  constraintsArtifactRef: identifier,
  courseRefs: z.array(identifier).min(1),
  lessonRefs: z.array(identifier).min(1),
  timeWindowRefs: z.array(identifier).min(1),
  existingScheduleSnapshotRef: identifier,
});

export const ConfirmPlanFlowBodySchema = z.strictObject({ planFlowId: identifier });

export const UpdateScheduleAssignmentBodySchema = z.union([
  z
    .strictObject({ action: z.literal('move'), startAt: utcInstant, endAt: utcInstant })
    .refine((value) => Date.parse(value.endAt) > Date.parse(value.startAt), {
      message: 'endAt must be later than startAt',
      path: ['endAt'],
    }),
  z.strictObject({ action: z.literal('resize'), endAt: utcInstant }),
  z.strictObject({ action: z.literal('set-lock'), locked: z.boolean() }),
]);

export const PlanFlowActionBodySchema = z.strictObject({
  action: z.enum(['pause', 'resume', 'reflow', 'undo', 'end']),
});

export const PlanSuggestionSchema = z.strictObject({
  courseId: identifier,
  lessonId: identifier,
  startAt: utcInstant,
  endAt: utcInstant,
  timezoneAtCreation: identifier,
  explanation: z.string(),
});

export const PlanFlowViewSchema = z.strictObject({
  id: identifier,
  state: z.enum([
    'draft',
    'previewing',
    'preview-ready',
    'confirming',
    'confirmed',
    'failed',
    'cancelled',
  ]),
  lifecycleState: z.enum(['active', 'paused', 'deleted']).optional(),
  constraintsArtifactRef: identifier,
  courseRefs: z.array(identifier),
  lessonRefs: z.array(identifier),
  timeWindowRefs: z.array(identifier),
  existingScheduleSnapshotRef: identifier,
  baseScheduleVersion: z.number().int().nonnegative(),
  inputSnapshotHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  warnings: z.array(z.string()).optional(),
  generationTaskId: identifier,
  suggestions: z.array(PlanSuggestionSchema),
  conflicts: z.array(identifier),
  confirmationReceipts: z.record(identifier, z.array(identifier)),
  confirmedScheduleItemIds: z.array(identifier),
  undoAvailable: z.boolean().optional(),
  processedCommandIds: z.array(identifier).optional(),
  source: z.enum(['manual', 'plan-flow']),
  errorCode: z.string().optional(),
  draftArtifactRef: z.string().optional(),
  createdAt: utcInstant,
  updatedAt: utcInstant,
  resourceVersion: z.number().int().nonnegative(),
});

export type ScheduleItemView = z.infer<typeof ScheduleItemSchema>;
export type PlanFlowView = z.infer<typeof PlanFlowViewSchema>;
