import { z } from 'zod';

import {
  ApplicationProblemSchema,
  ERROR_CODES,
  type ApplicationProblem,
  type ErrorCode,
} from '@learning-more/contracts';

import { HttpContractError } from './command-context.js';

type CodedError = Error & { readonly code?: unknown; readonly currentVersion?: unknown };

const declaredCodes = new Set<string>(ERROR_CODES);

function messageKey(code: ErrorCode): `errors.${string}` {
  const camel = code.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
  return `errors.${camel}`;
}

export function mapApplicationError(error: unknown, correlationId: string): ApplicationProblem {
  let code: ErrorCode = 'internal_error';
  let status = 500;
  let retryable = false;
  let currentVersion: number | undefined;

  if (error instanceof z.ZodError) {
    code = 'request_invalid';
    status = 400;
  } else if (error instanceof HttpContractError) {
    code = error.code;
    status = error.status;
  } else if (error instanceof Error) {
    const candidate = (error as CodedError).code;
    if (typeof candidate === 'string' && declaredCodes.has(candidate))
      code = candidate as ErrorCode;
    if (code === 'resource_not_found' || code === 'session_not_found') status = 404;
    else if (code === 'version_conflict') {
      status = 412;
      retryable = true;
    } else if (code === 'idempotency_conflict') status = 409;
    else if (code !== 'internal_error') status = 409;
    const candidateVersion = (error as CodedError).currentVersion;
    if (typeof candidateVersion === 'number' && Number.isInteger(candidateVersion)) {
      currentVersion = candidateVersion;
    }
  }

  return ApplicationProblemSchema.parse({
    type: `https://learning-more.local/problems/${code.replaceAll('_', '-')}`,
    status,
    code,
    messageKey: messageKey(code),
    retryable,
    correlationId,
    ...(currentVersion === undefined ? {} : { currentVersion }),
  });
}
