import { z } from 'zod';

export const HistoryQuerySchema = z.strictObject({
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(2_000).optional(),
});

export const CalendarQuerySchema = z.strictObject({
  from: z.iso.date(),
  to: z.iso.date(),
});

export const IsoWeekSchema = z.string().regex(/^\d{4}-W\d{2}$/);
