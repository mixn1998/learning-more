import type { FastifyInstance } from 'fastify';

import { HomeDashboardResponseSchema, type HomeDashboardView } from '@learning-more/contracts';

import { mapApplicationError } from '../error-mapper.js';

export type HomeRouteOptions = Readonly<{
  getHome(): Promise<HomeDashboardView>;
}>;

export async function registerHomeRoutes(
  app: FastifyInstance,
  options: HomeRouteOptions,
): Promise<void> {
  app.get('/api/v1/home', async (_request, reply) => {
    try {
      return reply.code(200).send(HomeDashboardResponseSchema.parse(await options.getHome()));
    } catch (error) {
      const problem = mapApplicationError(error, 'home_query');
      return reply.code(problem.status).send(problem);
    }
  });
}
