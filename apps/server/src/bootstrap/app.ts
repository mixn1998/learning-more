import type { RuntimeReady } from '@learning-more/contracts';
import Fastify, { type FastifyInstance } from 'fastify';

import type { GenerationFrameLog } from '../modules/generation-runtime/interface.js';
import { registerLocalSecurity } from '../http/plugins/local-security.js';
import {
  registerCourseAuthoringRoutes,
  type CourseAuthoringRouteOptions,
} from '../http/routes/course-authoring.js';
import { registerGenerationRoutes } from '../http/routes/generation.js';
import { registerHealthRoutes } from '../http/routes/health.js';

export interface ServerDependencies {
  getRuntimeReadiness(): Promise<RuntimeReady | unknown>;
  readonly courseAuthoring?: CourseAuthoringRouteOptions;
  readonly generationFrameLog?: GenerationFrameLog;
  readonly localSecurity?: Readonly<{ allowedOrigin: string; csrfToken: string }>;
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

  if (dependencies.localSecurity !== undefined) {
    await registerLocalSecurity(app, dependencies.localSecurity);
  }
  await registerHealthRoutes(app, dependencies);
  if (dependencies.courseAuthoring !== undefined) {
    await registerCourseAuthoringRoutes(app, dependencies.courseAuthoring);
  }
  if (dependencies.generationFrameLog !== undefined) {
    await registerGenerationRoutes(app, { frameLog: dependencies.generationFrameLog });
  }
  await app.ready();
  return app;
}
