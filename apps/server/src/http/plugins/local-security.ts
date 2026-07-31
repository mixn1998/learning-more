import type { FastifyInstance } from 'fastify';

import {
  createLocalRequestAccessAdapter,
  LOCAL_APPLICATION_PRINCIPAL,
  type ApplicationPrincipal,
  type RequestAccessAdapter,
} from '../../environment/request-access.js';

declare module 'fastify' {
  interface FastifyRequest {
    applicationPrincipal: ApplicationPrincipal | null;
  }
}

export async function registerRequestAccess(
  app: FastifyInstance,
  adapter: RequestAccessAdapter,
): Promise<void> {
  app.decorateRequest('applicationPrincipal', null);
  app.addHook('onRequest', async (request, reply) => {
    const decision = await adapter.authorize({
      method: request.method,
      ...(request.headers.host === undefined ? {} : { host: request.headers.host }),
      ...(request.headers.origin === undefined ? {} : { origin: request.headers.origin }),
      ...(request.headers['x-csrf-token'] === undefined ||
      Array.isArray(request.headers['x-csrf-token'])
        ? {}
        : { csrfToken: request.headers['x-csrf-token'] }),
      ...(request.headers.authorization === undefined
        ? {}
        : { authorization: request.headers.authorization }),
    });
    if (!decision.authorized) {
      await reply.code(decision.status).send({
        type: decision.problemType,
        status: decision.status,
        code: decision.code,
        messageKey: decision.messageKey,
        retryable: false,
        correlationId: 'unavailable',
      });
      return;
    }
    request.applicationPrincipal = decision.principal;
  });
}

export async function registerLocalSecurity(
  app: FastifyInstance,
  options: { readonly allowedOrigin: string; readonly csrfToken: string },
): Promise<void> {
  const principal: ApplicationPrincipal = LOCAL_APPLICATION_PRINCIPAL;
  await registerRequestAccess(
    app,
    createLocalRequestAccessAdapter({
      allowedOrigin: options.allowedOrigin,
      csrfToken: options.csrfToken,
      principal,
    }),
  );
}
