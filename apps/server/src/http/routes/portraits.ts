import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { HttpContractError } from '../command-context.js';
import { mapApplicationError } from '../error-mapper.js';

export type PortraitRouteOptions = Readonly<{
  requestRefresh(input: { idempotencyKey: string; tokenBudget: number }): Promise<unknown>;
  getCurrent(): Promise<unknown | undefined>;
  getVersion(versionId: string): Promise<unknown | undefined>;
  nextCorrelationId(): string;
}>;

const RefreshBodySchema = z.strictObject({
  tokenBudget: z.number().int().min(256).max(100_000).default(8_000),
});

function correlationId(request: FastifyRequest, options: PortraitRouteOptions): string {
  const supplied = request.headers['x-correlation-id'];
  return typeof supplied === 'string' && supplied.trim() !== ''
    ? supplied
    : options.nextCorrelationId();
}

function notFound(): Error & { code: string } {
  return Object.assign(new Error('resource_not_found'), { code: 'resource_not_found' });
}

export async function registerPortraitRoutes(
  app: FastifyInstance,
  options: PortraitRouteOptions,
): Promise<void> {
  app.post('/api/v1/portrait-refreshes', async (request, reply) => {
    const correlation = correlationId(request, options);
    try {
      const idempotencyKey = request.headers['idempotency-key'];
      if (typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '') {
        throw new HttpContractError('request_invalid', 400);
      }
      const body = RefreshBodySchema.parse(request.body ?? {});
      const result = (await options.requestRefresh({
        idempotencyKey,
        tokenBudget: body.tokenBudget,
      })) as { versionId?: string; state?: string; resourceVersion?: number };
      return reply
        .header('location', `/api/v1/portraits/${result.versionId ?? 'pending'}`)
        .header('etag', `"${result.resourceVersion ?? 0}"`)
        .code(result.state === 'completed' ? 201 : 202)
        .send(result);
    } catch (error) {
      const problem = mapApplicationError(error, correlation);
      return reply.code(problem.status).send(problem);
    }
  });

  app.get('/api/v1/portrait', async (request, reply) => {
    const correlation = correlationId(request, options);
    try {
      const current = await options.getCurrent();
      if (current === undefined) throw notFound();
      return reply.code(200).send(current);
    } catch (error) {
      const problem = mapApplicationError(error, correlation);
      return reply.code(problem.status).send(problem);
    }
  });

  app.get('/api/v1/portraits/:versionId', async (request, reply) => {
    const correlation = correlationId(request, options);
    try {
      const versionId = z
        .string()
        .min(1)
        .parse((request.params as { versionId: string }).versionId);
      const version = await options.getVersion(versionId);
      if (version === undefined) throw notFound();
      return reply.code(200).send(version);
    } catch (error) {
      const problem = mapApplicationError(error, correlation);
      return reply.code(problem.status).send(problem);
    }
  });
}
