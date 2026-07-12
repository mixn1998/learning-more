import type { RuntimeReady } from '@learning-more/contracts';
import Fastify, { type FastifyInstance } from 'fastify';

import { registerHealthRoutes } from '../http/routes/health.js';

export interface ServerDependencies {
  getRuntimeReadiness(): Promise<RuntimeReady | unknown>;
}

export async function buildApp(dependencies: ServerDependencies): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    void reply.code(500).send({
      type: 'https://learning-more.local/problems/internal-error',
      status: 500,
      code: 'internal_error',
      messageKey: 'errors.internalError',
      retryable: false,
      correlationId: 'unavailable',
    });
  });

  await registerHealthRoutes(app, dependencies);
  await app.ready();
  return app;
}
