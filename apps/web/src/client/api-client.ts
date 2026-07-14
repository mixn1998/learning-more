import { ApplicationProblemSchema } from '@learning-more/contracts';

import { getPageInstanceId } from '../state/page-instance.js';

export type CommandAttempt = Readonly<{
  pageInstanceId: string;
  idempotencyKey: string;
}>;

export function createCommandAttempt(): CommandAttempt {
  return { pageInstanceId: getPageInstanceId(), idempotencyKey: crypto.randomUUID() };
}

function csrfToken(): string {
  return (
    document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ??
    'development-csrf'
  );
}

export async function apiRequest<T>(
  url: string,
  options: Readonly<{
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
    schema: Readonly<{ parse(value: unknown): T }>;
    command?: CommandAttempt;
    resourceVersion?: number;
    signal?: AbortSignal;
    cache?: RequestCache;
  }>,
): Promise<Readonly<{ data: T; response: Response }>> {
  const unsafeMethod = options.method !== undefined && options.method !== 'GET';
  const response = await fetch(url, {
    ...(options.method === undefined || options.method === 'GET' ? {} : { method: options.method }),
    headers: {
      accept: 'application/json',
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(unsafeMethod ? { 'x-csrf-token': csrfToken() } : {}),
      ...(options.command === undefined
        ? {}
        : {
            'idempotency-key': options.command.idempotencyKey,
            'x-page-instance-id': options.command.pageInstanceId,
          }),
      ...(options.resourceVersion === undefined
        ? {}
        : { 'if-match': `"${options.resourceVersion}"` }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.cache === undefined ? {} : { cache: options.cache }),
  });
  const value: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const problem = ApplicationProblemSchema.safeParse(value);
    throw problem.success ? problem.data : new Error(`Unexpected HTTP ${response.status}`);
  }
  return { data: options.schema.parse(value), response };
}

export async function apiRequestOptional<T>(
  url: string,
  options: Readonly<{
    schema: Readonly<{ parse(value: unknown): T }>;
    signal?: AbortSignal;
  }>,
): Promise<Readonly<{ data: T | undefined; response: Response }>> {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  const value: unknown = await response.json().catch(() => undefined);
  if (response.status === 404) return { data: undefined, response };
  if (!response.ok) {
    const problem = ApplicationProblemSchema.safeParse(value);
    throw problem.success ? problem.data : new Error(`Unexpected HTTP ${response.status}`);
  }
  return { data: options.schema.parse(value), response };
}
