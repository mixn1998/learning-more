import type { FastifyInstance, FastifyRequest } from 'fastify';

import {
  ConfirmPlanFlowBodySchema,
  CreateScheduleAssignmentBodySchema,
  RequestPlanFlowPreviewBodySchema,
} from '@learning-more/contracts';

import type { PlanningModule } from '../../modules/planning/interface.js';
import type { createPlanFlowService } from '../../modules/planning/implementation/plan-flow-service.js';
import { buildCommandContext } from '../command-context.js';
import { mapApplicationError } from '../error-mapper.js';

export type PlanningRouteOptions = Readonly<{
  planning: PlanningModule;
  planFlows: Pick<ReturnType<typeof createPlanFlowService>, 'requestPreview' | 'confirm'>;
  nextCommandId(): string;
  nextCorrelationId(): string;
  now(): Date;
}>;

function correlationId(request: FastifyRequest, options: PlanningRouteOptions): string {
  const supplied = request.headers['x-correlation-id'];
  return typeof supplied === 'string' && supplied.trim() !== ''
    ? supplied
    : options.nextCorrelationId();
}

export async function registerPlanningRoutes(
  app: FastifyInstance,
  options: PlanningRouteOptions,
): Promise<void> {
  app.post('/api/v1/schedule-assignments', async (request, reply) => {
    const correlation = correlationId(request, options);
    try {
      const body = CreateScheduleAssignmentBodySchema.parse(request.body);
      const context = buildCommandContext(request, {
        commandId: options.nextCommandId(),
        correlationId: correlation,
        now: options.now(),
        requirePageInstanceId: true,
      });
      const result = await options.planning.execute(
        { type: 'CreateScheduleItem', ...body, source: 'manual' },
        context,
      );
      return reply
        .header('location', `/api/v1/schedule-assignments/${result.scheduleItem.id}`)
        .header('etag', `"${result.scheduleItem.resourceVersion}"`)
        .code(201)
        .send(result);
    } catch (error) {
      const problem = mapApplicationError(error, correlation);
      return reply.code(problem.status).send(problem);
    }
  });

  app.post('/api/v1/plan-flow-previews', async (request, reply) => {
    const correlation = correlationId(request, options);
    try {
      const body = RequestPlanFlowPreviewBodySchema.parse(request.body);
      const context = buildCommandContext(request, {
        commandId: options.nextCommandId(),
        correlationId: correlation,
        now: options.now(),
        requirePageInstanceId: true,
      });
      const result = await options.planFlows.requestPreview(body, context.commandId);
      return reply
        .header('location', `/api/v1/plan-flows/${result.id}`)
        .header('etag', `"${result.resourceVersion}"`)
        .code(202)
        .send(result);
    } catch (error) {
      const problem = mapApplicationError(error, correlation);
      return reply.code(problem.status).send(problem);
    }
  });

  app.post('/api/v1/plan-flows', async (request, reply) => {
    const correlation = correlationId(request, options);
    try {
      const body = ConfirmPlanFlowBodySchema.parse(request.body);
      const context = buildCommandContext(request, {
        commandId: options.nextCommandId(),
        correlationId: correlation,
        now: options.now(),
        requireIfMatch: true,
        requirePageInstanceId: true,
      });
      const result = await options.planFlows.confirm(body.planFlowId, context);
      return reply
        .header('location', `/api/v1/plan-flows/${result.id}`)
        .header('etag', `"${result.resourceVersion}"`)
        .code(201)
        .send(result);
    } catch (error) {
      const problem = mapApplicationError(error, correlation);
      return reply.code(problem.status).send(problem);
    }
  });

  app.get('/api/v1/schedule', async (_request, reply) => {
    const items = await options.planning.list();
    const version = items.reduce((maximum, item) => Math.max(maximum, item.resourceVersion), 0);
    return reply.header('etag', `"${version}"`).code(200).send({ items, resourceVersion: version });
  });
}
