import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { CourseModeSchema, ReasoningElicitationSchema } from '@learning-more/contracts';

export type ProfileRouteOptions = Readonly<{
  listReasoningEpisodes?(): Promise<readonly unknown[]>;
  refreshReasoningAnalysis?(filter: {
    windowStart?: string;
    windowEnd?: string;
    courseIds: string[];
    lessonIds: string[];
    courseModes: z.infer<typeof CourseModeSchema>[];
    elicitations: z.infer<typeof ReasoningElicitationSchema>[];
  }): Promise<unknown | undefined>;
  getReasoningAnalysis?(snapshotId: string): Promise<unknown | undefined>;
}>;

const ReasoningAnalysisBodySchema = z.strictObject({
  windowStart: z.iso.datetime({ offset: true }).optional(),
  windowEnd: z.iso.datetime({ offset: true }).optional(),
  courseIds: z.array(z.string().min(1)).default([]),
  lessonIds: z.array(z.string().min(1)).default([]),
  courseModes: z.array(CourseModeSchema).default([]),
  elicitations: z.array(ReasoningElicitationSchema).default([]),
});

export async function registerProfileRoutes(
  app: FastifyInstance,
  options: ProfileRouteOptions,
): Promise<void> {
  if (options.listReasoningEpisodes !== undefined) {
    app.get('/api/v1/profile/reasoning-behavior-episodes', async (_request, reply) => {
      return reply.code(200).send({ entries: await options.listReasoningEpisodes!() });
    });
  }

  if (options.refreshReasoningAnalysis !== undefined) {
    app.post('/api/v1/profile/reasoning-behavior-analyses', async (request, reply) => {
      const filter = ReasoningAnalysisBodySchema.parse(request.body ?? {});
      const analysis = await options.refreshReasoningAnalysis!({
        ...(filter.windowStart === undefined ? {} : { windowStart: filter.windowStart }),
        ...(filter.windowEnd === undefined ? {} : { windowEnd: filter.windowEnd }),
        courseIds: filter.courseIds,
        lessonIds: filter.lessonIds,
        courseModes: filter.courseModes,
        elicitations: filter.elicitations,
      });
      return analysis === undefined
        ? reply.code(200).send({ state: 'insufficient_evidence' })
        : reply.code(201).send(analysis);
    });
  }

  if (options.getReasoningAnalysis !== undefined) {
    app.get('/api/v1/profile/reasoning-behavior-analyses/:snapshotId', async (request, reply) => {
      const snapshotId = z
        .string()
        .min(1)
        .parse((request.params as { snapshotId: string }).snapshotId);
      const analysis = await options.getReasoningAnalysis!(snapshotId);
      return analysis === undefined
        ? reply.code(404).send({ code: 'resource_not_found' })
        : reply.code(200).send(analysis);
    });
  }
}
