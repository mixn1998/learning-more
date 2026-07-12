import { RuntimeReadySchema } from '@learning-more/contracts';
import type { FastifyInstance } from 'fastify';

import type { ServerDependencies } from '../../bootstrap/app.js';

export async function registerHealthRoutes(
  app: FastifyInstance,
  dependencies: ServerDependencies,
): Promise<void> {
  app.get('/api/v1/runtime/ready', async (_request, reply) => {
    const readiness = RuntimeReadySchema.parse(await dependencies.getRuntimeReadiness());
    return reply.code(200).send(readiness);
  });
}
