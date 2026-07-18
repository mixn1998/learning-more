import type { FastifyInstance } from 'fastify';

import {
  CatalogIndexResponseSchema,
  HomeDashboardResponseSchema,
  type HomeDashboardView,
} from '@learning-more/contracts';

import { mapApplicationError } from '../error-mapper.js';
import { sendConditionalJson } from '../conditional-get.js';

export type HomeRouteOptions = Readonly<{
  getHome(): Promise<Readonly<{ etag: string; value: HomeDashboardView }>>;
}>;

export async function registerHomeRoutes(
  app: FastifyInstance,
  options: HomeRouteOptions,
): Promise<void> {
  app.get('/api/v1/home', async (request, reply) => {
    try {
      const snapshot = await options.getHome();
      return sendConditionalJson(request, reply, {
        etag: snapshot.etag,
        value: HomeDashboardResponseSchema.parse(snapshot.value),
        projectionStatus: 'current',
      });
    } catch (error) {
      const problem = mapApplicationError(error, 'home_query');
      return reply.code(problem.status).send(problem);
    }
  });
  const sendCatalog = async (
    request: Parameters<typeof sendConditionalJson>[0],
    reply: Parameters<typeof sendConditionalJson>[1],
  ) => {
    try {
      const snapshot = await options.getHome();
      const value = CatalogIndexResponseSchema.parse({
        generatedAt: snapshot.value.generatedAt,
        courses: snapshot.value.courses,
        lessons: snapshot.value.lessons,
      });
      return sendConditionalJson(request, reply, {
        etag: snapshot.etag,
        value,
        projectionStatus: 'current',
      });
    } catch (error) {
      const problem = mapApplicationError(error, 'catalog_query');
      return reply.code(problem.status).send(problem);
    }
  };
  app.get('/api/v1/catalog-index', sendCatalog);
  app.get('/api/v1/planning-context', sendCatalog);
}
