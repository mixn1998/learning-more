import type { FastifyInstance } from 'fastify';

export async function registerLocalSecurity(
  app: FastifyInstance,
  options: { readonly allowedOrigin: string; readonly csrfToken: string },
): Promise<void> {
  app.addHook('onRequest', async (request, reply) => {
    const host = request.headers.host?.split(':')[0]?.replace(/^\[|\]$/g, '');
    const origin = request.headers.origin;
    const unsafeMethod = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    if (
      !['127.0.0.1', 'localhost', '::1'].includes(host ?? '') ||
      (origin !== undefined && origin !== options.allowedOrigin) ||
      (unsafeMethod && request.headers['x-csrf-token'] !== options.csrfToken)
    ) {
      await reply.code(403).send({
        type: 'https://learning-more.local/problems/local-request-forbidden',
        status: 403,
        code: 'local_request_forbidden',
        messageKey: 'errors.localRequestForbidden',
        retryable: false,
        correlationId: 'unavailable',
      });
    }
  });
}
