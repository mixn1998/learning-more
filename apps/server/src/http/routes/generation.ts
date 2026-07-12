import type { FastifyInstance } from 'fastify';

import {
  formatLastEventId,
  parseLastEventId,
  type GenerationStreamEvent,
} from '@learning-more/contracts';

import type { GenerationFrameLog } from '../../modules/generation-runtime/interface.js';

function sse(frame: GenerationStreamEvent): string {
  return `id: ${formatLastEventId(frame.taskId, frame.sequence)}\nevent: ${frame.type}\ndata: ${JSON.stringify(frame.data)}\n\n`;
}

export async function registerGenerationRoutes(
  app: FastifyInstance,
  options: { readonly frameLog: GenerationFrameLog; readonly heartbeatIntervalMs?: number },
): Promise<void> {
  app.get<{ Params: { taskId: string } }>(
    '/api/v1/generation-tasks/:taskId/events',
    async (request, reply) => {
      const header = request.headers['last-event-id'];
      const last = typeof header === 'string' ? parseLastEventId(header) : undefined;
      if (last !== undefined && last.taskId !== request.params.taskId)
        return reply.code(400).send();
      let result = await options.frameLog.readAfter(request.params.taskId, last?.sequence ?? 0);
      const frames: GenerationStreamEvent[] = [];
      if (result.reset && result.meta.lastSequence > 0) {
        frames.push({
          taskId: request.params.taskId,
          sequence: result.meta.lastSequence,
          emittedAt: new Date().toISOString(),
          type: 'task.snapshot',
          data: { state: result.meta.state, lastSequence: result.meta.lastSequence },
        });
      } else {
        frames.push(...result.frames);
      }
      if (frames.length === 0 && result.meta.state === 'running') {
        const heartbeatAt = Date.now() + (options.heartbeatIntervalMs ?? 15_000);
        while (frames.length === 0 && result.meta.state === 'running' && Date.now() < heartbeatAt) {
          await new Promise((resolve) => setTimeout(resolve, 25));
          result = await options.frameLog.readAfter(request.params.taskId, last?.sequence ?? 0);
          frames.push(...result.frames);
        }
        if (frames.length === 0 && result.meta.state === 'running') {
          frames.push(await options.frameLog.append(request.params.taskId, 'heartbeat', {}));
        }
      }
      return reply
        .header('content-type', 'text/event-stream; charset=utf-8')
        .header('cache-control', 'no-cache')
        .header('x-accel-buffering', 'no')
        .send(frames.map(sse).join(''));
    },
  );
}
