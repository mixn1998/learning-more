import {
  ProviderSwitchRequestSchema,
  ProviderSwitchResponseSchema,
  type ProviderSwitchRequest,
} from '@learning-more/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { mapApplicationError } from '../error-mapper.js';

export type RuntimeRouteOptions = Readonly<{
  switchProvider(input: ProviderSwitchRequest): Promise<unknown>;
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
}
