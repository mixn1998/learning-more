import {
  ProviderSwitchRequestSchema,
  ProviderSwitchResponseSchema,
  ProviderRuntimeStatusSchema,
  type ProviderSwitchRequest,
} from '@learning-more/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { HttpContractError } from '../command-context.js';
import { mapApplicationError } from '../error-mapper.js';

export type RuntimeRouteOptions = Readonly<{
  switchProvider(input: ProviderSwitchRequest): Promise<unknown>;
  getProviderStatus?(): Promise<unknown>;
  createDiagnostics?(): Promise<Readonly<{ artifactRef: string }>>;
  nextCorrelationId?: () => string;
}>;

function correlationId(request: FastifyRequest, options: RuntimeRouteOptions): string {
  const supplied = request.headers['x-correlation-id'];
  if (typeof supplied === 'string' && supplied.trim() !== '') return supplied;
  return options.nextCorrelationId?.() ?? 'runtime-unavailable';
}

export async function registerRuntimeRoutes(
  app: FastifyInstance,
  options: RuntimeRouteOptions,
): Promise<void> {
  if (options.getProviderStatus !== undefined) {
    app.get('/api/v1/ai-runtime/status', async (request, reply) => {
      const correlation = correlationId(request, options);
      try {
        return reply
          .code(200)
          .send(ProviderRuntimeStatusSchema.parse(await options.getProviderStatus!()));
      } catch (error) {
        const problem = mapApplicationError(error, correlation);
        return reply.code(problem.status).send(problem);
      }
    });
  }
  app.post('/api/v1/ai-runtime/provider-switches', async (request, reply) => {
    const correlation = correlationId(request, options);
    try {
      const body = ProviderSwitchRequestSchema.parse(request.body);
      const switched = (await options.switchProvider(body)) as {
        providerId: string;
        capabilities: unknown;
        health: { status: unknown };
      };
      const response = ProviderSwitchResponseSchema.parse({
        providerId: switched.providerId,
        capabilities: switched.capabilities,
        health: { status: switched.health.status },
      });
      return reply.code(200).send(response);
    } catch (error) {
      const problem = mapApplicationError(error, correlation);
      return reply.code(problem.status).send(problem);
    }
  });
  if (options.createDiagnostics !== undefined) {
    app.post('/api/v1/runtime/diagnostics', async (request, reply) => {
      const correlation = correlationId(request, options);
      try {
        if (
          request.body !== undefined &&
          (typeof request.body !== 'object' ||
            request.body === null ||
            Array.isArray(request.body) ||
            Object.keys(request.body).length !== 0)
        ) {
          throw new HttpContractError('request_invalid', 400);
        }
        return reply.code(201).send(await options.createDiagnostics!());
      } catch (error) {
        const problem = mapApplicationError(error, correlation);
        return reply.code(problem.status).send(problem);
      }
    });
  }
}
