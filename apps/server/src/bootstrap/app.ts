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
import { registerHomeRoutes, type HomeRouteOptions } from '../http/routes/home.js';
import {
  registerLearningSessionRoutes,
  type LearningSessionRouteOptions,
} from '../http/routes/learning-sessions.js';
import {
  registerLearningNoteRoutes,
  type LearningNoteRouteOptions,
} from '../http/routes/learning-notes.js';
import {
  registerReviewClosureRoutes,
  type ReviewClosureRouteOptions,
} from '../http/routes/review-closure.js';
import { registerPlanningRoutes, type PlanningRouteOptions } from '../http/routes/planning.js';
import {
  registerLearningFactsRoutes,
  type LearningFactsRouteOptions,
} from '../http/routes/learning-facts.js';
import { registerProfileRoutes, type ProfileRouteOptions } from '../http/routes/profile.js';
import { registerRuntimeRoutes, type RuntimeRouteOptions } from '../http/routes/runtime.js';

export interface ServerDependencies {
  getRuntimeReadiness(): Promise<RuntimeReady | unknown>;
  readonly courseAuthoring?: CourseAuthoringRouteOptions;
  readonly home?: HomeRouteOptions;
  readonly generationFrameLog?: GenerationFrameLog;
  readonly localSecurity?: Readonly<{ allowedOrigin: string; csrfToken: string }>;
  readonly learningSession?: LearningSessionRouteOptions;
  readonly learningNotes?: LearningNoteRouteOptions;
  readonly reviewClosure?: ReviewClosureRouteOptions;
  readonly planning?: PlanningRouteOptions;
  readonly learningFacts?: LearningFactsRouteOptions;
  readonly profile?: ProfileRouteOptions;
  readonly runtimeControl?: RuntimeRouteOptions;
}

export async function buildApp(
  dependencies: ServerDependencies,
  lifecycle: Readonly<{ onClose?(): Promise<void> }> = {},
): Promise<FastifyInstance> {
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
  if (dependencies.home !== undefined) {
    await registerHomeRoutes(app, dependencies.home);
  }
  if (dependencies.courseAuthoring !== undefined) {
    await registerCourseAuthoringRoutes(app, dependencies.courseAuthoring);
  }
  if (dependencies.generationFrameLog !== undefined) {
    await registerGenerationRoutes(app, { frameLog: dependencies.generationFrameLog });
  }
  if (dependencies.learningSession !== undefined) {
    await registerLearningSessionRoutes(app, dependencies.learningSession);
  }
  if (dependencies.learningNotes !== undefined) {
    await registerLearningNoteRoutes(app, dependencies.learningNotes);
  }
  if (dependencies.reviewClosure !== undefined) {
    await registerReviewClosureRoutes(app, dependencies.reviewClosure);
  }
  if (dependencies.planning !== undefined) {
    await registerPlanningRoutes(app, dependencies.planning);
  }
  if (dependencies.learningFacts !== undefined) {
    await registerLearningFactsRoutes(app, dependencies.learningFacts);
  }
  if (dependencies.profile !== undefined) {
    await registerProfileRoutes(app, dependencies.profile);
  }
  if (dependencies.runtimeControl !== undefined) {
    await registerRuntimeRoutes(app, dependencies.runtimeControl);
  }
  if (lifecycle.onClose !== undefined) {
    app.addHook('onClose', lifecycle.onClose);
  }
  await app.ready();
  return app;
}
