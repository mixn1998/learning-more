import type { FastifyInstance, FastifyRequest } from 'fastify';

import {
  AbandonLessonBodySchema,
  BeginLessonClosureBodySchema,
  CloseCourseBodySchema,
  RestoreLessonBodySchema,
  type CommandContext,
} from '@learning-more/contracts';

import { buildCommandContext, buildQueryContext } from '../command-context.js';
import { mapApplicationError } from '../error-mapper.js';

export type ReviewClosureRouteOptions = Readonly<{
  services: {
    abandonLesson(
      lessonId: string,
      sourceSnapshotHash: string,
      context: CommandContext,
    ): Promise<unknown>;
    restoreLesson(lessonId: string, context: CommandContext): Promise<unknown>;
    beginLessonClosure(
      lessonId: string,
      body: {
        sessionId: string;
        sourceSessionIds: string[];
        sourceMessageIds: string[];
        messageRangeChecksum: string;
        endIntent: string;
      },
      context: CommandContext,
    ): Promise<{ transactionId: string; resourceVersion: number } & Record<string, unknown>>;
    closeCourse(
      courseId: string,
      confirmAbandoned: boolean,
      context: CommandContext,
    ): Promise<{ resourceVersion: number } & Record<string, unknown>>;
    getClosure(
      transactionId: string,
      context: ReturnType<typeof buildQueryContext>,
    ): Promise<{ resourceVersion: number } & Record<string, unknown>>;
    retryClosure(
      transactionId: string,
      context: CommandContext,
    ): Promise<{ resourceVersion: number } & Record<string, unknown>>;
    getCourseReview(
      courseId: string,
      context: ReturnType<typeof buildQueryContext>,
    ): Promise<
      Readonly<{ state: string; artifactRef?: string; resourceVersion: number }> | undefined
    >;
  };
  nextCommandId(): string;
  nextCorrelationId(): string;
  now(): Date;
}>;

function correlationId(request: FastifyRequest, options: ReviewClosureRouteOptions): string {
  const supplied = request.headers['x-correlation-id'];
  return typeof supplied === 'string' && supplied.trim() !== ''
    ? supplied
    : options.nextCorrelationId();
}

function commandContext(
  request: FastifyRequest,
  correlation: string,
  options: ReviewClosureRouteOptions,
) {
  return buildCommandContext(request, {
    commandId: options.nextCommandId(),
    correlationId: correlation,
    now: options.now(),
    requireIfMatch: true,
    requirePageInstanceId: true,
  });
}

export async function registerReviewClosureRoutes(
  app: FastifyInstance,
  options: ReviewClosureRouteOptions,
): Promise<void> {
  app.post<{ Params: { lessonId: string } }>(
    '/api/v1/lessons/:lessonId/abandonments',
    async (request, reply) => {
      const correlation = correlationId(request, options);
      try {
        const body = AbandonLessonBodySchema.parse(request.body);
        const result = await options.services.abandonLesson(
          request.params.lessonId,
          body.sourceSnapshotHash,
          commandContext(request, correlation, options),
        );
        return reply.code(202).send(result);
      } catch (error) {
        const problem = mapApplicationError(error, correlation);
        return reply.code(problem.status).send(problem);
      }
    },
  );

  app.post<{ Params: { lessonId: string } }>(
    '/api/v1/lessons/:lessonId/restorations',
    async (request, reply) => {
      const correlation = correlationId(request, options);
      try {
        RestoreLessonBodySchema.parse(request.body ?? {});
        const result = await options.services.restoreLesson(
          request.params.lessonId,
          commandContext(request, correlation, options),
        );
        return reply.code(200).send(result);
      } catch (error) {
        const problem = mapApplicationError(error, correlation);
        return reply.code(problem.status).send(problem);
      }
    },
  );

  app.post<{ Params: { lessonId: string } }>(
    '/api/v1/lessons/:lessonId/closures',
    async (request, reply) => {
      const correlation = correlationId(request, options);
      try {
        const body = BeginLessonClosureBodySchema.parse(request.body);
        const result = await options.services.beginLessonClosure(
          request.params.lessonId,
          body,
          commandContext(request, correlation, options),
        );
        return reply
          .header('etag', `"${result.resourceVersion}"`)
          .header('location', `/api/v1/closure-transactions/${result.transactionId}`)
          .code(202)
          .send(result);
      } catch (error) {
        const problem = mapApplicationError(error, correlation);
        return reply.code(problem.status).send(problem);
      }
    },
  );

  app.post<{ Params: { courseId: string } }>(
    '/api/v1/courses/:courseId/closures',
    async (request, reply) => {
      const correlation = correlationId(request, options);
      try {
        const body = CloseCourseBodySchema.parse(request.body);
        const result = await options.services.closeCourse(
          request.params.courseId,
          body.confirmAbandoned,
          commandContext(request, correlation, options),
        );
        return reply.header('etag', `"${result.resourceVersion}"`).code(202).send(result);
      } catch (error) {
        const problem = mapApplicationError(error, correlation);
        return reply.code(problem.status).send(problem);
      }
    },
  );

  app.get<{ Params: { transactionId: string } }>(
    '/api/v1/closure-transactions/:transactionId',
    async (request, reply) => {
      const correlation = correlationId(request, options);
      try {
        const result = await options.services.getClosure(
          request.params.transactionId,
          buildQueryContext(correlation, options.now()),
        );
        return reply.header('etag', `"${result.resourceVersion}"`).code(200).send(result);
      } catch (error) {
        const problem = mapApplicationError(error, correlation);
        return reply.code(problem.status).send(problem);
      }
    },
  );

  app.post<{ Params: { transactionId: string } }>(
    '/api/v1/closure-transactions/:transactionId/retries',
    async (request, reply) => {
      const correlation = correlationId(request, options);
      try {
        RestoreLessonBodySchema.parse(request.body ?? {});
        const result = await options.services.retryClosure(
          request.params.transactionId,
          commandContext(request, correlation, options),
        );
        return reply.header('etag', `"${result.resourceVersion}"`).code(202).send(result);
      } catch (error) {
        const problem = mapApplicationError(error, correlation);
        return reply.code(problem.status).send(problem);
      }
    },
  );

  app.get<{ Params: { courseId: string } }>(
    '/api/v1/courses/:courseId/review',
    async (request, reply) => {
      const correlation = correlationId(request, options);
      try {
        const result = await options.services.getCourseReview(
          request.params.courseId,
          buildQueryContext(correlation, options.now()),
        );
        if (result === undefined) {
          return reply
            .code(404)
            .send(
              mapApplicationError(
                Object.assign(new Error('not found'), { code: 'resource_not_found' }),
                correlation,
              ),
            );
        }
        return reply.header('etag', `"${result.resourceVersion}"`).code(200).send(result);
      } catch (error) {
        const problem = mapApplicationError(error, correlation);
        return reply.code(problem.status).send(problem);
      }
    },
  );
}
