import { z } from 'zod';

const identifier = z.string().trim().min(1).max(200);
const checksum = z.string().regex(/^[a-f0-9]{64}$/);

export const AbandonLessonBodySchema = z.strictObject({ sourceSnapshotHash: checksum });
export const RestoreLessonBodySchema = z.strictObject({});
export const BeginLessonClosureBodySchema = z.strictObject({
  sessionId: identifier,
  sourceSessionIds: z.array(identifier).min(1),
  sourceMessageIds: z.array(identifier).min(1),
  messageRangeChecksum: checksum,
  endIntent: z.string().trim().min(1).max(2_000),
});
export const CloseCourseBodySchema = z.strictObject({ confirmAbandoned: z.boolean() });
