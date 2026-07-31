export type ApplicationPrincipal = Readonly<{
  subjectId: string;
  dataScopeId: string;
  roles: readonly string[];
}>;

export const LOCAL_APPLICATION_PRINCIPAL: ApplicationPrincipal = {
  subjectId: 'local-user',
  dataScopeId: 'local',
  roles: ['owner'],
};

export type RequestAccessInput = Readonly<{
  method: string;
  host?: string;
  origin?: string;
  csrfToken?: string;
  authorization?: string;
}>;

export type RequestAccessDecision =
  | Readonly<{ authorized: true; principal: ApplicationPrincipal }>
  | Readonly<{
      authorized: false;
      status: 401 | 403;
      code: string;
      messageKey: string;
      problemType: string;
    }>;

export interface RequestAccessAdapter {
  authorize(input: RequestAccessInput): Promise<RequestAccessDecision>;
}

function hostnameFromHeader(host: string | undefined): string | undefined {
  if (host === undefined) return undefined;
  if (host.startsWith('[')) {
    const closingBracket = host.indexOf(']');
    return closingBracket < 0 ? undefined : host.slice(1, closingBracket);
  }
  return host.split(':')[0];
}

export function createLocalRequestAccessAdapter(options: {
  readonly allowedOrigin: string;
  readonly csrfToken: string;
  readonly principal: ApplicationPrincipal;
}): RequestAccessAdapter {
  return {
    async authorize(input) {
      const hostname = hostnameFromHeader(input.host);
      const unsafeMethod = !['GET', 'HEAD', 'OPTIONS'].includes(input.method);
      if (
        !['127.0.0.1', 'localhost', '::1'].includes(hostname ?? '') ||
        (input.origin !== undefined && input.origin !== options.allowedOrigin) ||
        (unsafeMethod && input.csrfToken !== options.csrfToken)
      ) {
        return {
          authorized: false,
          status: 403,
          code: 'local_request_forbidden',
          messageKey: 'errors.localRequestForbidden',
          problemType: 'https://learning-more.local/problems/local-request-forbidden',
        };
      }
      return { authorized: true, principal: options.principal };
    },
  };
}
