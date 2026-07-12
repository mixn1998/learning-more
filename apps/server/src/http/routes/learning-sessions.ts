import type { FastifyInstance, FastifyRequest } from 'fastify';

import {
  AppendLessonMessageBodySchema,
  AppendSupplementaryMessageBodySchema,
  EmptyLearningSessionCommandBodySchema,
  GenerationStoppedResponseSchema,
  GenerationTaskAcceptedResponseSchema,
  LessonSessionStartedResponseSchema,
  StartLessonSessionBodySchema,
  StartSupplementarySessionBodySchema,
  StopLessonGenerationBodySchema,
  SupplementarySessionResponseSchema,
} from '@learning-more/contracts';

import type {
  LearningSessionModule,
  SessionGenerationCoordinator,
  SessionGenerationInputManifest,
} from '../../modules/learning-session/interface.js';
import { buildCommandContext, buildQueryContext } from '../command-context.js';
import { mapApplicationError } from '../error-mapper.js';

type SessionReference = Omit<SessionGenerationInputManifest, 'userMessageId'>;

export type LearningSessionRouteOptions = Readonly<{
  module: LearningSessionModule;
  generation: SessionGenerationCoordinator;
  resolveSession(sessionId: string): Promise<SessionReference>;
  saveUserMessage(messageId: string, markdown: string): Promise<string>;
  loadArtifactMarkdown?(artifactRef: string): Promise<string | undefined>;
  nextCommandId(): string;
  nextCorrelationId(): string;
  nextMessageId(): string;
  now(): Date;
  supplementary?: {
    execute(
      command:
        | { type: 'StartSupplementarySession'; lessonId: string }
        | {
            type: 'AppendSupplementaryMessage';
            supplementarySessionId: string;
            messageId: string;
            expectedVersion: number;
          }
        | {
            type: 'ArchiveSupplementarySession';
            supplementarySessionId: string;
            expectedVersion: number;
          },
    ): Promise<unknown>;
    get(id: string): Promise<unknown>;
  };
}>;

function correlationId(request: FastifyRequest, options: LearningSessionRouteOptions): string {
  const supplied = request.headers['x-correlation-id'];
  return typeof supplied === 'string' && supplied.trim() !== ''
    ? supplied
    : options.nextCorrelationId();
}

export async function registerLearningSessionRoutes(
  app: FastifyInstance,
  options: LearningSessionRouteOptions,
): Promise<void> {
  if (options.supplementary !== undefined) {
    app.post<{ Params: { lessonId: string } }>(
      '/api/v1/lessons/:lessonId/supplementary-sessions',
      async (request, reply) => {
        const correlation = correlationId(request, options);
        try {
          StartSupplementarySessionBodySchema.parse(request.body ?? {});
          buildCommandContext(request, {
            commandId: options.nextCommandId(),
            correlationId: correlation,
            now: options.now(),
            requirePageInstanceId: true,
          });
          const session = SupplementarySessionResponseSchema.parse(
            await options.supplementary!.execute({
              type: 'StartSupplementarySession',
              lessonId: request.params.lessonId,
            }),
          );
          return reply
            .header('location', `/api/v1/supplementary-sessions/${session.id}`)
            .header('etag', `"${session.resourceVersion}"`)
            .code(201)
            .send(session);
        } catch (error) {
          const problem = mapApplicationError(error, correlation);
          return reply.code(problem.status).send(problem);
        }
      },
    );

    app.post<{ Params: { sessionId: string } }>(
      '/api/v1/supplementary-sessions/:sessionId/messages',
      async (request, reply) => {
        const correlation = correlationId(request, options);
        try {
          const body = AppendSupplementaryMessageBodySchema.parse(request.body);
          const context = buildCommandContext(request, {
            commandId: options.nextCommandId(),
            correlationId: correlation,
            now: options.now(),
            requireIfMatch: true,
            requirePageInstanceId: true,
          });
          const messageId = options.nextMessageId();
          await options.saveUserMessage(messageId, body.markdown);
          const session = SupplementarySessionResponseSchema.parse(
            await options.supplementary!.execute({
              type: 'AppendSupplementaryMessage',
              supplementarySessionId: request.params.sessionId,
              messageId,
              expectedVersion: context.expectedVersion!,
            }),
          );
          return reply.header('etag', `"${session.resourceVersion}"`).code(200).send(session);
        } catch (error) {
          const problem = mapApplicationError(error, correlation);
          return reply.code(problem.status).send(problem);
        }
      },
    );
  }
  app.post<{ Params: { lessonId: string } }>(
    '/api/v1/lessons/:lessonId/sessions',
    async (request, reply) => {
      const correlation = correlationId(request, options);
      try {
        StartLessonSessionBodySchema.parse(request.body ?? {});
        const context = buildCommandContext(request, {
          commandId: options.nextCommandId(),
          correlationId: correlation,
          now: options.now(),
          requirePageInstanceId: true,
        });
        const result = await options.module.execute(
          { type: 'StartLesson', lessonId: request.params.lessonId },
          context,
        );
        if (result.value.sessionId === undefined) throw new Error('unexpected_module_result');
        const response = LessonSessionStartedResponseSchema.parse({
          lessonId: result.value.lessonId,
          sessionId: result.value.sessionId,
          resourceVersion: result.value.resourceVersion,
          writable: result.value.writable,
          ...(result.value.leaseToken === undefined ? {} : { leaseToken: result.value.leaseToken }),
        });
        return reply
          .header('etag', `"${response.resourceVersion}"`)
          .header('location', `/api/v1/lesson-sessions/${response.sessionId}`)
          .code(201)
          .send(response);
      } catch (error) {
        const problem = mapApplicationError(error, correlation);
        return reply.code(problem.status).send(problem);
      }
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    '/api/v1/lesson-sessions/:sessionId/messages',
    async (request, reply) => {
      const correlation = correlationId(request, options);
      try {
        const body = AppendLessonMessageBodySchema.parse(request.body);
        const reference = await options.resolveSession(request.params.sessionId);
        const messageId = options.nextMessageId();
        const contentArtifactRef = await options.saveUserMessage(messageId, body.markdown);
        const context = buildCommandContext(request, {
          commandId: options.nextCommandId(),
          correlationId: correlation,
          now: options.now(),
          requireIfMatch: true,
          requirePageInstanceId: true,
        });
        const appended = await options.module.execute(
          {
            type: 'AppendUserMessage',
            lessonId: reference.lessonId,
            messageId,
            contentArtifactRef,
            establishesEvidence: body.establishesEvidence,
          },
          context,
        );
        const task = await options.generation.request(
          {
            ...reference,
            userMessageId: messageId,
            currentMessageRefs: [...reference.currentMessageRefs, contentArtifactRef],
          },
          { ...context, expectedVersion: appended.value.resourceVersion },
        );
        const response = GenerationTaskAcceptedResponseSchema.parse(task);
        return reply.header('etag', `"${response.resourceVersion}"`).code(202).send(response);
      } catch (error) {
        const problem = mapApplicationError(error, correlation);
        return reply.code(problem.status).send(problem);
      }
    },
  );

  for (const [suffix, type] of [
    ['pauses', 'PauseLesson'],
    ['resumptions', 'ResumeLesson'],
    ['lease-transfers', 'TransferSessionLease'],
  ] as const) {
    app.post<{ Params: { sessionId: string } }>(
      `/api/v1/lesson-sessions/:sessionId/${suffix}`,
      async (request, reply) => {
        const correlation = correlationId(request, options);
        try {
          EmptyLearningSessionCommandBodySchema.parse(request.body ?? {});
          const reference = await options.resolveSession(request.params.sessionId);
          const context = buildCommandContext(request, {
            commandId: options.nextCommandId(),
            correlationId: correlation,
            now: options.now(),
            requireIfMatch: true,
            requirePageInstanceId: true,
          });
          const result = await options.module.execute(
            { type, lessonId: reference.lessonId },
            context,
          );
          return reply
            .header('etag', `"${result.value.resourceVersion}"`)
            .code(200)
            .send(result.value);
        } catch (error) {
          const problem = mapApplicationError(error, correlation);
          return reply.code(problem.status).send(problem);
        }
      },
    );
  }

  app.post<{ Params: { sessionId: string } }>(
    '/api/v1/lesson-sessions/:sessionId/generation-stops',
    async (request, reply) => {
      const correlation = correlationId(request, options);
      try {
        const body = StopLessonGenerationBodySchema.parse(request.body);
        const reference = await options.resolveSession(request.params.sessionId);
        const context = buildCommandContext(request, {
          commandId: options.nextCommandId(),
          correlationId: correlation,
          now: options.now(),
          requireIfMatch: true,
          requirePageInstanceId: true,
        });
        const result = await options.generation.stop(
          {
            lessonId: reference.lessonId,
            sessionId: request.params.sessionId,
            taskId: body.taskId,
          },
          context,
        );
        const response = GenerationStoppedResponseSchema.parse(result);
        return reply.header('etag', `"${response.resourceVersion}"`).code(200).send(response);
      } catch (error) {
        const problem = mapApplicationError(error, correlation);
        return reply.code(problem.status).send(problem);
      }
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    '/api/v1/lesson-sessions/:sessionId',
    async (request, reply) => {
      const correlation = correlationId(request, options);
      try {
        const reference = await options.resolveSession(request.params.sessionId);
        const view = await options.module.query(
          { type: 'GetLessonLearning', lessonId: reference.lessonId },
          buildQueryContext(correlation, options.now()),
        );
        const markdown =
          view.finalReview === undefined
            ? undefined
            : await options.loadArtifactMarkdown?.(view.finalReview.artifactRef);
        return reply
          .header('etag', `"${view.resourceVersion}"`)
          .code(200)
          .send({
            ...view,
            ...(view.finalReview === undefined
              ? {}
              : {
                  finalReview: {
                    ...view.finalReview,
                    ...(markdown === undefined ? {} : { markdown }),
                  },
                }),
          });
      } catch (error) {
        const problem = mapApplicationError(error, correlation);
        return reply.code(problem.status).send(problem);
      }
    },
  );
}
