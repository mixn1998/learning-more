import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { CourseModeSchema, ReasoningElicitationSchema } from '@learning-more/contracts';

export type ProfileEvidenceRecord = Readonly<{
  evidenceId: string;
  summary: string;
  sourceGroup: string;
  sourceGroupId: string;
  dependentSourceGroupIds: readonly string[];
  sourceRefs: readonly string[];
  dataKeys: readonly string[];
  observedAt: string;
  strength: Readonly<{ score: number; rationale: string }>;
  polarity: string;
  status: string;
}>;

export type ProfileRouteOptions = Readonly<{
  getGlobalProfile(): Promise<unknown>;
  listEvidence(): Promise<readonly ProfileEvidenceRecord[]>;
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

const EvidenceQuerySchema = z.strictObject({
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});

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
  app.get('/api/v1/profile-facts', async (_request, reply) => {
    return reply.code(200).send(await options.getGlobalProfile());
  });

  app.get('/api/v1/portrait-evidence', async (request, reply) => {
    reply.header('deprecation', 'true');
    const query = EvidenceQuerySchema.parse(request.query);
    const sorted = [...(await options.listEvidence())].sort((left, right) =>
      left.evidenceId.localeCompare(right.evidenceId),
    );
    const remaining =
      query.cursor === undefined
        ? sorted
        : sorted.filter((candidate) => candidate.evidenceId > query.cursor!);
    const selected = remaining.slice(0, query.pageSize);
    const last = selected.at(-1);
    const nextCursor = remaining.length > selected.length ? last?.evidenceId : undefined;
    return reply.code(200).send({
      entries: selected.map((candidate) => ({
        evidenceId: candidate.evidenceId,
        summary: candidate.summary,
        sourceGroup: candidate.sourceGroup,
        sourceGroupId: candidate.sourceGroupId,
        dependentSourceGroupIds: candidate.dependentSourceGroupIds,
        observedAt: candidate.observedAt,
        strength: candidate.strength,
        polarity: candidate.polarity,
        status: candidate.status,
      })),
      ...(nextCursor === undefined ? {} : { nextCursor }),
    });
  });

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
