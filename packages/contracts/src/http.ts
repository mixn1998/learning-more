import { z } from 'zod';

const taskIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((value) => !value.includes(':'));
const sequenceSchema = z.number().int().positive();

export type LastEventId = Readonly<{
  taskId: string;
  sequence: number;
}>;

export function formatLastEventId(taskId: string, sequence: number): string {
  const validTaskId = taskIdSchema.parse(taskId);
  const validSequence = sequenceSchema.parse(sequence);
  return `${validTaskId}:${validSequence}`;
}

export function parseLastEventId(value: string): LastEventId {
  const separator = value.lastIndexOf(':');
  if (separator <= 0) {
    throw new Error('Invalid Last-Event-ID');
  }

  const parsed = {
    taskId: value.slice(0, separator),
    sequence: Number(value.slice(separator + 1)),
  };
  const result = z
    .strictObject({ taskId: taskIdSchema, sequence: sequenceSchema })
    .safeParse(parsed);

  if (!result.success) {
    throw new Error('Invalid Last-Event-ID');
  }
  return result.data;
}
