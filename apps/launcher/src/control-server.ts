import { readFile, realpath, stat } from 'node:fs/promises';
import {
  createServer,
  request as createRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

export type ControlServerOptions = Readonly<{
  allowedOrigin: string;
  capability: Readonly<{ value: string; expiresAt: number }>;
  getStatus(): Promise<unknown>;
  reconnect(): Promise<unknown>;
  syncFrontend(): Promise<unknown>;
  diagnose(): Promise<unknown>;
  webRoot?: string;
  apiTarget?: string;
}>;

export type InjectRequest = Readonly<{
  method: string;
  url: string;
  headers?: Readonly<Record<string, string>>;
  payload?: unknown;
  remoteAddress?: string;
}>;

export type InjectResponse = Readonly<{
  statusCode: number;
  body: string;
  headers: Readonly<Record<string, string>>;
  json(): unknown;
}>;

export type ControlServer = Readonly<{
  inject(request: InjectRequest): Promise<InjectResponse>;
  listen(options?: Readonly<{ host?: string; port?: number }>): Promise<string>;
  close(): Promise<void>;
}>;

function header(headers: IncomingHttpHeaders | Readonly<Record<string, string>>, name: string) {
  const value = headers[name];
  return typeof value === 'string' ? value : undefined;
}

function isLoopback(address: string): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function response(
  statusCode: number,
  payload: unknown,
  headers: Readonly<Record<string, string>> = {},
): InjectResponse {
  const body = JSON.stringify(payload) ?? '';
  return {
    statusCode,
    body,
    headers,
    json: () => (body === '' ? undefined : (JSON.parse(body) as unknown)),
  };
}

function isEmptyBody(payload: unknown): boolean {
  return (
    payload === undefined ||
    payload === null ||
    (typeof payload === 'object' && !Array.isArray(payload) && Object.keys(payload).length === 0)
  );
}

const contentTypes: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

async function serveStatic(
  webRoot: string,
  request: IncomingMessage,
  reply: ServerResponse,
): Promise<void> {
  const rawPath = (request.url ?? '/').split('?', 1)[0] ?? '/';
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    reply.writeHead(400);
    reply.end();
    return;
  }
  const normalized = decoded.replaceAll('\\', '/');
  if (normalized.includes('\0') || normalized.split('/').some((segment) => segment === '..')) {
    reply.writeHead(403);
    reply.end();
    return;
  }
  const root = await realpath(webRoot);
  const requested = normalized === '/' ? '/index.html' : normalized;
  const initial = path.resolve(root, `.${requested}`);
  let candidate = initial;
  try {
    const metadata = await stat(candidate);
    if (!metadata.isFile()) throw new Error('static_not_file');
  } catch {
    if (path.extname(requested) !== '') {
      reply.writeHead(404);
      reply.end();
      return;
    }
    candidate = path.join(root, 'index.html');
  }
  const resolved = await realpath(candidate).catch(() => undefined);
  if (resolved === undefined || !resolved.startsWith(`${root}${path.sep}`)) {
    reply.writeHead(404);
    reply.end();
    return;
  }
  const content = await readFile(resolved);
  reply.writeHead(200, {
    'content-type':
      contentTypes[path.extname(resolved).toLowerCase()] ?? 'application/octet-stream',
    'content-length': content.byteLength,
    'x-content-type-options': 'nosniff',
  });
  reply.end(request.method === 'HEAD' ? undefined : content);
}

function proxyApi(
  apiTarget: string,
  allowedOrigin: string,
  incoming: IncomingMessage,
  outgoing: ServerResponse,
): void {
  const target = new URL(incoming.url ?? '/api', apiTarget);
  if (target.hostname !== '127.0.0.1' || target.protocol !== 'http:') {
    outgoing.writeHead(502);
    outgoing.end();
    return;
  }
  const forwarded = createRequest(
    target,
    {
      method: incoming.method,
      headers: {
        ...incoming.headers,
        host: target.host,
        origin: allowedOrigin,
      },
    },
    (response) => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(outgoing);
    },
  );
  forwarded.on('error', () => {
    if (!outgoing.headersSent) outgoing.writeHead(502);
    outgoing.end();
  });
  incoming.pipe(forwarded);
}

export async function buildControlServer(options: ControlServerOptions): Promise<ControlServer> {
  async function handle(request: InjectRequest): Promise<InjectResponse> {
    const method = request.method.toUpperCase();
    const headers = Object.fromEntries(
      Object.entries(request.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]),
    );
    const remoteAddress = request.remoteAddress ?? '127.0.0.1';
    if (
      !isLoopback(remoteAddress) ||
      header(headers, 'host') !== '127.0.0.1:43119' ||
      header(headers, 'origin') !== options.allowedOrigin
    ) {
      return response(403, { code: 'control_forbidden' });
    }
    const corsHeaders = {
      'access-control-allow-origin': options.allowedOrigin,
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type, x-learning-more-capability',
      vary: 'origin',
    } as const;
    if (method === 'OPTIONS') return response(204, undefined, corsHeaders);
    if (method !== 'GET') {
      if (
        Date.now() >= options.capability.expiresAt ||
        header(headers, 'x-learning-more-capability') !== options.capability.value
      ) {
        return response(403, { code: 'control_capability_invalid' }, corsHeaders);
      }
    }

    if (method === 'GET' && request.url === '/control/v1/status') {
      return response(200, await options.getStatus(), corsHeaders);
    }
    if (method !== 'POST') return response(404, { code: 'control_route_not_found' }, corsHeaders);
    if (!isEmptyBody(request.payload))
      return response(400, { code: 'control_body_invalid' }, corsHeaders);
    if (request.url === '/control/v1/reconnect')
      return response(200, await options.reconnect(), corsHeaders);
    if (request.url === '/control/v1/sync-frontend') {
      return response(200, await options.syncFrontend(), corsHeaders);
    }
    if (request.url === '/control/v1/diagnose')
      return response(200, await options.diagnose(), corsHeaders);
    return response(404, { code: 'control_route_not_found' }, corsHeaders);
  }

  let server: Server | undefined;
  return {
    inject: handle,
    async listen({ host = '127.0.0.1', port = 43_119 } = {}) {
      if (host !== '127.0.0.1') throw new Error('control_server_loopback_only');
      if (server) throw new Error('control_server_already_listening');
      server = createServer((request, reply) => {
        const requestPath = (request.url ?? '/').split('?', 1)[0] ?? '/';
        if (requestPath.startsWith('/api/') && options.apiTarget !== undefined) {
          proxyApi(options.apiTarget, options.allowedOrigin, request, reply);
          return;
        }
        if (
          !requestPath.startsWith('/control/') &&
          options.webRoot !== undefined &&
          (request.method === 'GET' || request.method === 'HEAD')
        ) {
          void serveStatic(options.webRoot, request, reply).catch(() => {
            if (!reply.headersSent) reply.writeHead(500);
            reply.end();
          });
          return;
        }
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
          const rawBody = Buffer.concat(chunks).toString('utf8');
          let payload: unknown;
          try {
            payload = rawBody === '' ? undefined : (JSON.parse(rawBody) as unknown);
          } catch {
            reply.writeHead(400, { 'content-type': 'application/json' });
            reply.end(JSON.stringify({ code: 'control_body_invalid' }));
            return;
          }
          void handle({
            method: request.method ?? 'GET',
            url: request.url ?? '/',
            headers: Object.fromEntries(
              Object.entries(request.headers).flatMap(([name, value]) =>
                typeof value === 'string' ? [[name, value]] : [],
              ),
            ),
            payload,
            ...(request.socket.remoteAddress === undefined
              ? {}
              : { remoteAddress: request.socket.remoteAddress }),
          }).then((result) => {
            reply.writeHead(result.statusCode, {
              ...(result.body === '' ? {} : { 'content-type': 'application/json' }),
              ...result.headers,
            });
            reply.end(result.body);
          });
        });
      });
      await new Promise<void>((resolve, reject) => {
        server?.once('error', reject);
        server?.listen(port, host, resolve);
      });
      const address = server.address() as AddressInfo;
      return `http://${host}:${address.port}`;
    },
    async close() {
      if (!server) return;
      const active = server;
      server = undefined;
      await new Promise<void>((resolve, reject) =>
        active.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
