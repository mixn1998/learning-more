import { createHash } from 'node:crypto';

import type { FastifyInstance, FastifyRequest } from 'fastify';

import {
  AppendLessonMessageBodySchema,
  AppendSupplementaryMessageBodySchema,
  EmptyLearningSessionCommandBodySchema,
  GenerationStoppedResponseSchema,
  GenerationTaskAcceptedResponseSchema,
  LessonSessionStartedResponseSchema,
  LearningSessionViewResponseSchema,
  LessonRecordResponseSchema,
  LessonEntryStateResponseSchema,
  ReviseLessonMessageBodySchema,
  RenameSupplementarySessionBodySchema,
  StartLessonSessionBodySchema,
  StartSupplementarySessionBodySchema,
  StopLessonGenerationBodySchema,
  SupplementarySessionResponseSchema,
} from '@learning-more/contracts';
import type { LessonRecordView, LessonTeachingProgress } from '@learning-more/contracts';

import type { LearningSessionModule } from '../../modules/learning-session/interface.js';
import { collapseRetryDuplicateUserMessages } from '../../modules/learning-session/implementation/effective-message-projection.js';
import type { InteractiveTeaching } from '../../modules/interactive-teaching/interface.js';
import { buildCommandContext, buildQueryContext } from '../command-context.js';
import { mapApplicationError } from '../error-mapper.js';

type SessionReference = Readonly<{
  courseId: string;
  lessonId: string;
  sessionId: string;
  pageInstanceId?: string;
}>;

export type LearningSessionRouteOptions = Readonly<{
  module: LearningSessionModule;
  teaching: InteractiveTeaching;
  resolveSession(sessionId: string): Promise<SessionReference>;
  reconcileSession?(reference: SessionReference, correlationId: string): Promise<void>;
  saveUserMessage(messageId: string, markdown: string): Promise<string>;
  loadArtifactMarkdown?(artifactRef: string): Promise<string | undefined>;
  listSessionMessages?(sessionId: string): Promise<
    readonly Readonly<{
      id: string;
      role: 'user' | 'assistant';
      createdAt: string;
      contentArtifactRef: string;
      completionStatus?: 'complete' | 'interrupted' | undefined;
      generationTaskId?: string | undefined;
      knowledgePointRef?: string | undefined;
    }>[]
  >;
  getLessonRecord?(lessonId: string): Promise<LessonRecordView>;
  getTeachingProgress?(sessionId: string): Promise<LessonTeachingProgress>;
  getLessonEntryState?(lessonId: string): Promise<{
    lessonId: string;
    progress: 'not_started' | 'in_progress' | 'abandoned' | 'completed';
    sessionId?: string;
    stageReviewMarkdown?: string;
    stageReviewStatus?: 'generating' | 'failed' | 'ready';
    resourceVersion: number;
  }>;
  nextCommandId(): string;
  nextCorrelationId(): string;
  nextMessageId(): string;
  now(): Date;
  supplementary?: {
    start(lessonId: string): Promise<unknown>;
    view(sessionId: string): Promise<unknown>;
    send(input: { sessionId: string; markdown: string; expectedVersion: number }): Promise<unknown>;
    revise(input: {
      sessionId: string;
      replacedUserMessageId: string;
      markdown: string;
      expectedVersion: number;
    }): Promise<unknown>;
    retry(input: { sessionId: string; expectedVersion: number }): Promise<unknown>;
    rename(input: { sessionId: string; title: string; expectedVersion: number }): Promise<unknown>;
    stop(input: { sessionId: string; taskId: string }): Promise<unknown>;
    archive(input: { sessionId: string; expectedVersion: number }): Promise<unknown>;
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
  if (options.getLessonEntryState !== undefined) {
    app.get<{ Params: { lessonId: string } }>(
      '/api/v1/lessons/:lessonId/learning-state',
      async (request, reply) => {
        const correlation = correlationId(request, options);
        try {
          const state = LessonEntryStateResponseSchema.parse(
            await options.getLessonEntryState!(request.params.lessonId),
          );
          return reply
            .header('cache-control', 'no-store')
            .header('etag', `"${state.resourceVersion}"`)
            .code(200)
            .send(state);
        } catch (error) {
          const problem = mapApplicationError(error, correlation);
          return reply.code(problem.status).send(problem);
        }
      },
    );
  }
  if (options.getLessonRecord !== undefined) {
    app.get<{ Params: { lessonId: string } }>(
      '/api/v1/lessons/:lessonId/record',
      async (request, reply) => {
        const correlation = correlationId(request, options);
        try {
          return reply
            .code(200)
            .send(
              LessonRecordResponseSchema.parse(
                await options.getLessonRecord!(request.params.lessonId),
              ),
            );
        } catch (error) {
          const problem = mapApplicationError(error, correlation);
          return reply.code(problem.status).send(problem);
        }
      },
    );
  }
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
            await options.supplementary!.start(request.params.lessonId),
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
          const task = GenerationTaskAcceptedResponseSchema.parse(
            await options.supplementary!.send({
              sessionId: request.params.sessionId,
              markdown: body.markdown,
              expectedVersion: context.expectedVersion!,
            }),
          );
          return reply.header('etag', `"${task.resourceVersion}"`).code(202).send(task);
        } catch (error) {
          const problem = mapApplicationError(error, correlation);
          return reply.code(problem.status).send(problem);
        }
      },
    );

    app.get<{ Params: { sessionId: string } }>(
      '/api/v1/supplementary-sessions/:sessionId',
      async (request, reply) => {
        const correlation = correlationId(request, options);
        try {
          const session = SupplementarySessionResponseSchema.parse(
            await options.supplementary!.view(request.params.sessionId),
          );
          return reply
            .header('cache-control', 'no-store')
            .header('etag', `"${session.resourceVersion}"`)
            .code(200)
            .send(session);
        } catch (error) {
          const problem = mapApplicationError(error, correlation);
          return reply.code(problem.status).send(problem);
        }
      },
    );

    app.patch<{ Params: { sessionId: string } }>(
      '/api/v1/supplementary-sessions/:sessionId/title',
      async (request, reply) => {
        const correlation = correlationId(request, options);
        try {
          const body = RenameSupplementarySessionBodySchema.parse(request.body);
          const context = buildCommandContext(request, {
            commandId: options.nextCommandId(),
            correlationId: correlation,
            now: options.now(),
            requireIfMatch: true,
            requirePageInstanceId: true,
          });
          const session = SupplementarySessionResponseSchema.parse(
            await options.supplementary!.rename({
              sessionId: request.params.sessionId,
              title: body.title,
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

    app.post<{ Params: { sessionId: string; messageId: string } }>(
      '/api/v1/supplementary-sessions/:sessionId/messages/:messageId/revisions',
      async (request, reply) => {
        const correlation = correlationId(request, options);
        try {
          const body = ReviseLessonMessageBodySchema.parse(request.body);
          const context = buildCommandContext(request, {
            commandId: options.nextCommandId(),
            correlationId: correlation,
            now: options.now(),
            requireIfMatch: true,
            requirePageInstanceId: true,
          });
          const task = GenerationTaskAcceptedResponseSchema.parse(
            await options.supplementary!.revise({
              sessionId: request.params.sessionId,
              replacedUserMessageId: request.params.messageId,
              markdown: body.markdown,
              expectedVersion: context.expectedVersion!,
            }),
          );
          return reply.header('etag', `"${task.resourceVersion}"`).code(202).send(task);
        } catch (error) {
          const problem = mapApplicationError(error, correlation);
          return reply.code(problem.status).send(problem);
        }
      },
    );

    for (const [suffix, operation] of [
      ['generation-retries', 'retry'],
      ['archives', 'archive'],
    ] as const) {
      app.post<{ Params: { sessionId: string } }>(
        `/api/v1/supplementary-sessions/:sessionId/${suffix}`,
        async (request, reply) => {
          const correlation = correlationId(request, options);
          try {
            EmptyLearningSessionCommandBodySchema.parse(request.body ?? {});
            const context = buildCommandContext(request, {
              commandId: options.nextCommandId(),
              correlationId: correlation,
              now: options.now(),
              requireIfMatch: true,
              requirePageInstanceId: true,
            });
            if (operation === 'retry') {
              const task = GenerationTaskAcceptedResponseSchema.parse(
                await options.supplementary!.retry({
                  sessionId: request.params.sessionId,
                  expectedVersion: context.expectedVersion!,
                }),
              );
              return reply.header('etag', `"${task.resourceVersion}"`).code(202).send(task);
            }
            const session = SupplementarySessionResponseSchema.parse(
              await options.supplementary!.archive({
                sessionId: request.params.sessionId,
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

    app.post<{ Params: { sessionId: string } }>(
      '/api/v1/supplementary-sessions/:sessionId/generation-stops',
      async (request, reply) => {
        const correlation = correlationId(request, options);
        try {
          const body = StopLessonGenerationBodySchema.parse(request.body);
          buildCommandContext(request, {
            commandId: options.nextCommandId(),
            correlationId: correlation,
            now: options.now(),
            requireIfMatch: true,
            requirePageInstanceId: true,
          });
          const session = SupplementarySessionResponseSchema.parse(
            await options.supplementary!.stop({
              sessionId: request.params.sessionId,
              taskId: body.taskId,
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
    '/api/v1/lesson-sessions/:sessionId/opening',
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
        const task = await options.teaching.openLesson(reference, context);
        const response = GenerationTaskAcceptedResponseSchema.parse(task);
        return reply.header('etag', `"${response.resourceVersion}"`).code(202).send(response);
      } catch (error) {
        const problem = mapApplicationError(error, correlation);
        return reply.code(problem.status).send(problem);
      }
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    '/api/v1/lesson-sessions/:sessionId/continuations',
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
        const task = await options.teaching.continueTurn(reference, context);
        const response = GenerationTaskAcceptedResponseSchema.parse(task);
        return reply.header('etag', `"${response.resourceVersion}"`).code(202).send(response);
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
        const task = await options.teaching.advanceTurn(
          {
            courseId: reference.courseId,
            lessonId: reference.lessonId,
            sessionId: reference.sessionId,
            userMessageId: messageId,
            userContentArtifactRef: contentArtifactRef,
          },
          context,
        );
        const response = GenerationTaskAcceptedResponseSchema.parse({
          ...task,
          userMessageId: messageId,
        });
        return reply.header('etag', `"${response.resourceVersion}"`).code(202).send(response);
      } catch (error) {
        const problem = mapApplicationError(error, correlation);
        return reply.code(problem.status).send(problem);
      }
    },
  );

  app.post<{ Params: { sessionId: string; messageId: string } }>(
    '/api/v1/lesson-sessions/:sessionId/messages/:messageId/revisions',
    async (request, reply) => {
      const correlation = correlationId(request, options);
      try {
        const body = ReviseLessonMessageBodySchema.parse(request.body);
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
        const task = await options.teaching.reviseTurn(
          {
            courseId: reference.courseId,
            lessonId: reference.lessonId,
            sessionId: reference.sessionId,
            replacedUserMessageId: request.params.messageId,
            userMessageId: messageId,
            userContentArtifactRef: contentArtifactRef,
          },
          context,
        );
        const response = GenerationTaskAcceptedResponseSchema.parse({
          ...task,
          userMessageId: messageId,
        });
        return reply.header('etag', `"${response.resourceVersion}"`).code(202).send(response);
      } catch (error) {
        const problem = mapApplicationError(error, correlation);
        return reply.code(problem.status).send(problem);
      }
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    '/api/v1/lesson-sessions/:sessionId/generation-retries',
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
        const task = await options.teaching.retryTurn(reference, context);
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
        await options.resolveSession(request.params.sessionId);
        const context = buildCommandContext(request, {
          commandId: options.nextCommandId(),
          correlationId: correlation,
          now: options.now(),
          requireIfMatch: true,
          requirePageInstanceId: true,
        });
        const result = await options.teaching.stopTurn(
          {
            sessionId: request.params.sessionId,
            taskId: body.taskId,
            ...(body.disposition === undefined ? {} : { disposition: body.disposition }),
          },
          context,
        );
        const response = GenerationStoppedResponseSchema.parse({
          taskId: result.taskId,
          ...(result.draftArtifactRef === undefined
            ? {}
            : { draftArtifactRef: result.draftArtifactRef }),
          resourceVersion: result.resourceVersion,
        });
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
        await options.reconcileSession?.(reference, correlation);
        const view = await options.module.query(
          { type: 'GetLessonLearning', lessonId: reference.lessonId },
          buildQueryContext(correlation, options.now()),
        );
        const markdown =
          view.finalReview === undefined
            ? undefined
            : await options.loadArtifactMarkdown?.(view.finalReview.artifactRef);
        const storedMessages =
          options.listSessionMessages === undefined
            ? undefined
            : await options.listSessionMessages(request.params.sessionId);
        const teachingProgress = await options.getTeachingProgress?.(request.params.sessionId);
        const messages =
          storedMessages === undefined
            ? undefined
            : collapseRetryDuplicateUserMessages(
                await Promise.all(
                  storedMessages.map(async (message) => ({
                    id: message.id,
                    role: message.role,
                    createdAt: message.createdAt,
                    markdown:
                      (await options.loadArtifactMarkdown?.(message.contentArtifactRef)) ?? '',
                    ...(message.completionStatus === undefined
                      ? {}
                      : { completionStatus: message.completionStatus }),
                    ...(message.generationTaskId === undefined
                      ? {}
                      : { generationTaskId: message.generationTaskId }),
                    ...(message.knowledgePointRef === undefined
                      ? {}
                      : { knowledgePointRef: message.knowledgePointRef }),
                  })),
                ),
              );
        const sourceMessageIds =
          messages
            ?.filter((message) => message.completionStatus !== 'interrupted')
            .map((message) => message.id) ?? [];
        const sessionSnapshotHash =
          view.learning.session === undefined
            ? undefined
            : createHash('sha256')
                .update(
                  JSON.stringify({
                    lessonId: view.learning.lessonId,
                    sessionId: view.learning.session.id,
                    resourceVersion: view.resourceVersion,
                    sourceMessageIds,
                  }),
                )
                .digest('hex');
        const closurePreparation =
          view.learning.session === undefined || sourceMessageIds.length === 0
            ? undefined
            : {
                sessionId: view.learning.session.id,
                sourceSessionIds: [view.learning.session.id],
                sourceMessageIds,
                messageRangeChecksum: createHash('sha256')
                  .update(JSON.stringify({ sessionId: view.learning.session.id, sourceMessageIds }))
                  .digest('hex'),
                endIntent: '完成本课并生成最终 Review',
              };
        const response = LearningSessionViewResponseSchema.parse({
          ...view,
          ...(sessionSnapshotHash === undefined ? {} : { sessionSnapshotHash }),
          ...(teachingProgress === undefined ? {} : { teachingProgress }),
          ...(messages === undefined ? {} : { messages }),
          ...(closurePreparation === undefined ? {} : { closurePreparation }),
          ...(view.finalReview === undefined
            ? {}
            : {
                finalReview: {
                  ...view.finalReview,
                  ...(markdown === undefined ? {} : { markdown }),
                },
              }),
        });
        return reply.header('etag', `"${view.resourceVersion}"`).code(200).send(response);
      } catch (error) {
        const problem = mapApplicationError(error, correlation);
        return reply.code(problem.status).send(problem);
      }
    },
  );
}
