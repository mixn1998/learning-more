import type { FastifyRequest } from 'fastify';

import type { CommandContext, QueryContext } from '@learning-more/contracts';

export class HttpContractError extends Error {
  constructor(
    readonly code: 'request_invalid' | 'precondition_required',
    readonly status: 400 | 428,
  ) {
    super(code);
    this.name = 'HttpContractError';
  }
}

function scalarHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? undefined : value;
}

function expectedVersion(request: FastifyRequest, required: boolean): number | undefined {
  const value = scalarHeader(request.headers['if-match']);
  if (value === undefined) {
    if (required) throw new HttpContractError('precondition_required', 428);
    return undefined;
  }
  const match = /^"(0|[1-9]\d*)"$/.exec(value);
  if (match === null) throw new HttpContractError('request_invalid', 400);
  return Number(match[1]);
}

export function buildCommandContext(
  request: FastifyRequest,
  options: {
    readonly commandId: string;
    readonly correlationId: string;
    readonly now: Date;
    readonly requireIfMatch?: boolean;
    readonly requirePageInstanceId?: boolean;
  },
): CommandContext {
  const idempotencyKey = scalarHeader(request.headers['idempotency-key']);
  if (idempotencyKey === undefined || idempotencyKey.trim() === '') {
    throw new HttpContractError('request_invalid', 400);
  }
  const pageInstanceId = scalarHeader(request.headers['x-page-instance-id']);
  if (options.requirePageInstanceId === true && pageInstanceId === undefined) {
    throw new HttpContractError('request_invalid', 400);
  }
  const timestamp = options.now.toISOString();
  const version = expectedVersion(request, options.requireIfMatch ?? false);
  return {
    commandId: options.commandId,
    correlationId: options.correlationId,
    idempotencyKey,
    actor: 'local-user',
    requestedAt: timestamp,
    receivedAt: timestamp,
    ...(version === undefined ? {} : { expectedVersion: version }),
    ...(pageInstanceId === undefined ? {} : { pageInstanceId }),
  };
}

export function buildQueryContext(correlationId: string, now: Date): QueryContext {
  const timestamp = now.toISOString();
  return {
    correlationId,
    actor: 'local-user',
    requestedAt: timestamp,
    receivedAt: timestamp,
  };
}
