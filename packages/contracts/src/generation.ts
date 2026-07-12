import { z } from 'zod';

import { ApplicationProblemSchema } from './errors.js';

export const GENERATION_STREAM_EVENT_TYPES = [
  'task.snapshot',
  'message.started',
  'message.delta',
  'message.completed',
  'artifact.ready',
  'task.progress',
  'task.completed',
  'task.failed',
  'task.cancelled',
  'heartbeat',
] as const;

const taskIdSchema = z.string().trim().min(1).max(200);
const messageIdSchema = z.string().trim().min(1).max(200);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

function streamEvent<TType extends (typeof GENERATION_STREAM_EVENT_TYPES)[number], TData>(
  type: TType,
  data: z.ZodType<TData>,
) {
  return z.strictObject({
    taskId: taskIdSchema,
    sequence: z.number().int().positive(),
    emittedAt: z.iso.datetime({ offset: true }),
    type: z.literal(type),
    data,
  });
}

const TaskSnapshotEventSchema = streamEvent(
  'task.snapshot',
  z.strictObject({
    state: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled', 'timeout']),
    lastSequence: z.number().int().nonnegative(),
  }),
);

const MessageStartedEventSchema = streamEvent(
  'message.started',
  z.strictObject({ messageId: messageIdSchema }),
);

const MessageDeltaEventSchema = streamEvent(
  'message.delta',
  z.strictObject({
    messageId: messageIdSchema,
    markdown: z.string().min(1),
  }),
);

const MessageCompletedEventSchema = streamEvent(
  'message.completed',
  z.strictObject({
    messageId: messageIdSchema,
    contentSha256: sha256Schema,
  }),
);

const ArtifactReadyEventSchema = streamEvent(
  'artifact.ready',
  z.strictObject({
    artifactId: z.string().trim().min(1).max(200),
    kind: z.string().trim().min(1).max(100),
    contentSha256: sha256Schema,
  }),
);

const TaskProgressEventSchema = streamEvent(
  'task.progress',
  z
    .strictObject({
      current: z.number().int().nonnegative(),
      total: z.number().int().positive(),
      label: z.string().trim().min(1).max(200),
    })
    .refine(({ current, total }) => current <= total, {
      message: 'current must not exceed total',
      path: ['current'],
    }),
);

const TaskCompletedEventSchema = streamEvent(
  'task.completed',
  z.strictObject({ resultRef: z.string().trim().min(1).max(300) }),
);

const TaskFailedEventSchema = streamEvent(
  'task.failed',
  z.strictObject({ problem: ApplicationProblemSchema }),
);

const TaskCancelledEventSchema = streamEvent(
  'task.cancelled',
  z.strictObject({ reason: z.string().trim().min(1).max(300) }),
);

const HeartbeatEventSchema = streamEvent('heartbeat', z.strictObject({}));

export const GenerationStreamEventSchema = z.discriminatedUnion('type', [
  TaskSnapshotEventSchema,
  MessageStartedEventSchema,
  MessageDeltaEventSchema,
  MessageCompletedEventSchema,
  ArtifactReadyEventSchema,
  TaskProgressEventSchema,
  TaskCompletedEventSchema,
  TaskFailedEventSchema,
  TaskCancelledEventSchema,
  HeartbeatEventSchema,
]);

export type GenerationStreamEventType = (typeof GENERATION_STREAM_EVENT_TYPES)[number];
export type GenerationStreamEvent = Readonly<z.infer<typeof GenerationStreamEventSchema>>;
