import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  AppendOutlineSessionMessageBodySchema,
  ConfirmationResponseSchema,
  ConfirmOutlineCandidateBodySchema,
  CourseParamsSchema,
  CourseArchiveResponseSchema,
  CreateOutlineSessionBodySchema,
  DeleteCourseArchiveResponseSchema,
  GenerationAcceptedResponseSchema,
  LessonParamsSchema,
  LessonPreviewResponseSchema,
  OutlineMessageResponseSchema,
  OutlineRevisionResponseSchema,
  OutlineSessionParamsSchema,
  OutlineSessionResponseSchema,
  OutlineSessionViewResponseSchema,
  RequestCandidateGenerationBodySchema,
  ReviseCourseOutlineBodySchema,
} from '@learning-more/contracts';

import type { CourseAuthoring } from '../../modules/course-authoring/interface.js';
import { buildCommandContext, buildQueryContext } from '../command-context.js';
import { mapApplicationError } from '../error-mapper.js';

export type CourseAuthoringRouteOptions = Readonly<{
  module: CourseAuthoring;
  nextCommandId: () => string;
  nextCorrelationId: () => string;
  now: () => Date;
}>;

function correlationId(request: FastifyRequest, options: CourseAuthoringRouteOptions): string {
  const supplied = request.headers['x-correlation-id'];
  return typeof supplied === 'string' && supplied.trim() !== ''
    ? supplied
    : options.nextCorrelationId();
}

function etag(reply: FastifyReply, resourceVersion: number | undefined): FastifyReply {
  return resourceVersion === undefined ? reply : reply.header('etag', `"${resourceVersion}"`);
}

export async function registerCourseAuthoringRoutes(
  app: FastifyInstance,
  options: CourseAuthoringRouteOptions,
): Promise<void> {
  app.post('/api/v1/outline-sessions', async (request, reply) => {
    const correlation = correlationId(request, options);
    try {
      const body = CreateOutlineSessionBodySchema.parse(request.body);
      const context = buildCommandContext(request, {
        commandId: options.nextCommandId(),
        correlationId: correlation,
        now: options.now(),
      });
      const result = await options.module.execute(
        { type: 'CreateOutlineSession', ...body },
        context,
      );
      if (result.value.kind !== 'outline-session') throw new Error('unexpected_module_result');
      const response = OutlineSessionResponseSchema.parse({
        outlineSessionId: result.value.outlineSessionId,
        resourceVersion: result.resourceVersion,
        ...(result.value.state === undefined ? {} : { state: result.value.state }),
      });
      return etag(reply, result.resourceVersion)
        .header('location', `/api/v1/outline-sessions/${result.value.outlineSessionId}`)
        .code(201)
        .send(response);
    } catch (error) {
      const problem = mapApplicationError(error, correlation);
      return reply.code(problem.status).send(problem);
    }
  });

  app.post<{ Params: { sessionId: string } }>(
    '/api/v1/outline-sessions/:sessionId/messages',
    async (request, reply) => {
      const correlation = correlationId(request, options);
      try {
        const { sessionId } = OutlineSessionParamsSchema.parse(request.params);
        const body = AppendOutlineSessionMessageBodySchema.parse(request.body);
        const context = buildCommandContext(request, {
          commandId: options.nextCommandId(),
          correlationId: correlation,
          now: options.now(),
          requireIfMatch: true,
        });
        const result = await options.module.execute(
          { type: 'AppendOutlineSessionMessage', outlineSessionId: sessionId, ...body },
          context,
        );
        if (result.value.kind !== 'message') throw new Error('unexpected_module_result');
        const response = OutlineMessageResponseSchema.parse({
          outlineSessionId: result.value.outlineSessionId,
          state: result.value.state,
          resourceVersion: result.resourceVersion,
        });
        return etag(reply, result.resourceVersion).code(200).send(response);
      } catch (error) {
        const problem = mapApplicationError(error, correlation);
        return reply.code(problem.status).send(problem);
      }
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    '/api/v1/outline-sessions/:sessionId/candidate-generations',
    async (request, reply) => {
      const correlation = correlationId(request, options);
      try {
        const { sessionId } = OutlineSessionParamsSchema.parse(request.params);
        RequestCandidateGenerationBodySchema.parse(request.body ?? {});
        const context = buildCommandContext(request, {
          commandId: options.nextCommandId(),
          correlationId: correlation,
          now: options.now(),
          requireIfMatch: true,
        });
        const result = await options.module.execute(
          { type: 'RequestCandidateGeneration', outlineSessionId: sessionId },
          context,
        );
        if (result.value.kind !== 'generation') throw new Error('unexpected_module_result');
        const response = GenerationAcceptedResponseSchema.parse({
          taskId: result.value.taskId,
          ...(result.value.draftArtifactRef === undefined
            ? {}
            : { draftArtifactRef: result.value.draftArtifactRef }),
          state: result.value.state,
          resourceVersion: result.resourceVersion,
        });
        return etag(reply, result.resourceVersion).code(202).send(response);
      } catch (error) {
        const problem = mapApplicationError(error, correlation);
        return reply.code(problem.status).send(problem);
      }
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    '/api/v1/outline-sessions/:sessionId/confirmations',
    async (request, reply) => {
      const correlation = correlationId(request, options);
      try {
        const { sessionId } = OutlineSessionParamsSchema.parse(request.params);
        const body = ConfirmOutlineCandidateBodySchema.parse(request.body);
        const context = buildCommandContext(request, {
          commandId: options.nextCommandId(),
          correlationId: correlation,
          now: options.now(),
          requireIfMatch: true,
        });
        const result = await options.module.execute(
          { type: 'ConfirmOutlineCandidate', outlineSessionId: sessionId, ...body },
          context,
        );
        if (result.value.kind !== 'confirmation') throw new Error('unexpected_module_result');
        const response = ConfirmationResponseSchema.parse({
          courseId: result.value.courseId,
          ...(result.value.outlineVersionId === undefined
            ? {}
            : { outlineVersionId: result.value.outlineVersionId }),
          resourceVersion: result.resourceVersion,
        });
        return etag(reply, result.resourceVersion)
          .header('location', `/api/v1/courses/${result.value.courseId}`)
          .code(201)
          .send(response);
      } catch (error) {
        const problem = mapApplicationError(error, correlation);
        return reply.code(problem.status).send(problem);
      }
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    '/api/v1/outline-sessions/:sessionId',
    async (request, reply) => {
      const correlation = correlationId(request, options);
      try {
        const { sessionId } = OutlineSessionParamsSchema.parse(request.params);
        const view = await options.module.query(
          { type: 'GetOutlineSession', outlineSessionId: sessionId },
          buildQueryContext(correlation, options.now()),
        );
        const response = OutlineSessionViewResponseSchema.parse(view);
        return etag(reply, view.resourceVersion).code(200).send(response);
      } catch (error) {
        const problem = mapApplicationError(error, correlation);
        return reply.code(problem.status).send(problem);
      }
    },
  );

  app.post<{ Params: { courseId: string } }>(
    '/api/v1/courses/:courseId/outline-revisions',
    async (request, reply) => {
      const correlation = correlationId(request, options);
      try {
        const { courseId } = CourseParamsSchema.parse(request.params);
        const body = ReviseCourseOutlineBodySchema.parse(request.body);
        const context = buildCommandContext(request, {
          commandId: options.nextCommandId(),
          correlationId: correlation,
          now: options.now(),
          requireIfMatch: true,
        });
        const result = await options.module.execute(
          { type: 'ReviseCourseOutline', courseId, ...body },
          context,
        );
        if (result.value.kind !== 'revision') throw new Error('unexpected_module_result');
        const response = OutlineRevisionResponseSchema.parse({
          courseId: result.value.courseId,
          outlineVersionId: result.value.outlineVersionId,
          resourceVersion: result.resourceVersion,
        });
        return etag(reply, result.resourceVersion)
          .header(
            'location',
            `/api/v1/courses/${courseId}/outline-versions/${result.value.outlineVersionId}`,
          )
          .code(201)
          .send(response);
      } catch (error) {
        const problem = mapApplicationError(error, correlation);
        return reply.code(problem.status).send(problem);
      }
    },
  );

  app.delete<{ Params: { courseId: string } }>(
    '/api/v1/courses/:courseId',
    async (request, reply) => {
      const correlation = correlationId(request, options);
      try {
        const { courseId } = CourseParamsSchema.parse(request.params);
        const context = buildCommandContext(request, {
          commandId: options.nextCommandId(),
          correlationId: correlation,
          now: options.now(),
          requireIfMatch: true,
        });
        const result = await options.module.execute(
          { type: 'DeleteCourseArchive', courseId },
          context,
        );
        if (result.value.kind !== 'course-archive-deleted') {
          throw new Error('unexpected_module_result');
        }
        return reply.code(200).send(
          DeleteCourseArchiveResponseSchema.parse({
            courseId: result.value.courseId,
            deletedAt: result.value.deletedAt,
            portraitRefresh: result.value.portraitRefresh,
          }),
        );
      } catch (error) {
        const problem = mapApplicationError(error, correlation);
        return reply.code(problem.status).send(problem);
      }
    },
  );

  app.get<{ Params: { courseId: string } }>('/api/v1/courses/:courseId', async (request, reply) => {
    const correlation = correlationId(request, options);
    try {
      const { courseId } = CourseParamsSchema.parse(request.params);
      if (options.module.getCourse === undefined) throw new Error('course_query_not_configured');
      const view = await options.module.getCourse(
        courseId,
        buildQueryContext(correlation, options.now()),
      );
      return etag(reply, view.resourceVersion)
        .code(200)
        .send(CourseArchiveResponseSchema.parse(view));
    } catch (error) {
      const problem = mapApplicationError(error, correlation);
      return reply.code(problem.status).send(problem);
    }
  });

  app.get<{ Params: { lessonId: string } }>('/api/v1/lessons/:lessonId', async (request, reply) => {
    const correlation = correlationId(request, options);
    try {
      const { lessonId } = LessonParamsSchema.parse(request.params);
      if (options.module.getLesson === undefined) throw new Error('lesson_query_not_configured');
      const view = await options.module.getLesson(
        lessonId,
        buildQueryContext(correlation, options.now()),
      );
      return reply.code(200).send(LessonPreviewResponseSchema.parse(view));
    } catch (error) {
      const problem = mapApplicationError(error, correlation);
      return reply.code(problem.status).send(problem);
    }
  });
}
