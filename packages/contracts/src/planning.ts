import { z } from 'zod';

const identifier = z.string().trim().min(1).max(200);
const utcInstant = z.iso.datetime({ offset: true });

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
