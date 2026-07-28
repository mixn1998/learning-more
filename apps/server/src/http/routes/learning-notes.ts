import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  CreateLearningNoteBodySchema,
  LearningNoteListQuerySchema,
  LearningNoteListResponseSchema,
  LearningNoteParamsSchema,
  LearningNoteSchema,
  UpdateLearningNoteBodySchema,
} from '@learning-more/contracts';

import type { LearningNotesService } from '../../modules/learning-notes/learning-notes-service.js';
import { RepositoryVersionConflictError } from '../../persistence/repository-errors.js';

export type LearningNoteRouteOptions = Readonly<{ service: LearningNotesService }>;

function expectedVersion(request: FastifyRequest): number {
  const raw = request.headers['if-match'];
  const normalized = typeof raw === 'string' ? raw.replaceAll('"', '') : '';
  const value = Number(normalized);
  if (!Number.isInteger(value) || value < 1) {
    throw Object.assign(new Error('precondition_required'), { code: 'precondition_required' });
  }
  return value;
}

function problem(error: unknown): Readonly<{ status: number; code: string }> {
  if (error instanceof z.ZodError) return { status: 400, code: 'invalid_request' };
  if (error instanceof RepositoryVersionConflictError) {
    return { status: 409, code: 'version_conflict' };
  }
  const code = (error as { code?: string }).code;
  if (code === 'precondition_required') return { status: 428, code };
  if (code === 'resource_not_found') return { status: 404, code };
  return { status: 500, code: 'internal_error' };
}

export async function registerLearningNoteRoutes(
  app: FastifyInstance,
  options: LearningNoteRouteOptions,
): Promise<void> {
  app.get('/api/v1/learning-notes', async (request, reply) => {
    try {
      const filter = LearningNoteListQuerySchema.parse(request.query);
      const entries = await options.service.list({
        ...(filter.courseId === undefined ? {} : { courseId: filter.courseId }),
        ...(filter.lessonId === undefined ? {} : { lessonId: filter.lessonId }),
      });
      return reply.code(200).send(LearningNoteListResponseSchema.parse({ entries }));
    } catch (error) {
      const mapped = problem(error);
      return reply.code(mapped.status).send(mapped);
    }
  });

  app.post('/api/v1/learning-notes', async (request, reply) => {
    try {
      const body = CreateLearningNoteBodySchema.parse(request.body);
      const note = LearningNoteSchema.parse(await options.service.create(body));
      return reply
        .header('etag', `"${note.resourceVersion}"`)
        .header('location', `/api/v1/learning-notes/${note.id}`)
        .code(201)
        .send(note);
    } catch (error) {
      const mapped = problem(error);
      return reply.code(mapped.status).send(mapped);
    }
  });

  app.patch('/api/v1/learning-notes/:noteId', async (request, reply) => {
    try {
      const { noteId } = LearningNoteParamsSchema.parse(request.params);
      const body = UpdateLearningNoteBodySchema.parse(request.body);
      const note = LearningNoteSchema.parse(
        await options.service.update(noteId, body.markdown, expectedVersion(request)),
      );
      return reply.header('etag', `"${note.resourceVersion}"`).code(200).send(note);
    } catch (error) {
      const mapped = problem(error);
      return reply.code(mapped.status).send(mapped);
    }
  });

  app.delete('/api/v1/learning-notes/:noteId', async (request, reply) => {
    try {
      const { noteId } = LearningNoteParamsSchema.parse(request.params);
      await options.service.remove(noteId, expectedVersion(request));
      return reply.code(204).send();
    } catch (error) {
      const mapped = problem(error);
      return reply.code(mapped.status).send(mapped);
    }
  });
}
