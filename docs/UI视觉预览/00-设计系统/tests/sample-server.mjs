import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testsDir = path.dirname(fileURLToPath(import.meta.url));
export const uiRoot = path.resolve(testsDir, '..', '..');
export const samplePort = 61586;

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
]);

function resolveRequestPath(requestUrl = '/') {
  const pathname = decodeURIComponent(
    new URL(requestUrl, `http://127.0.0.1:${samplePort}`).pathname,
  );
  const target = path.resolve(uiRoot, `.${pathname}`);
  const relative = path.relative(uiRoot, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
  return target;
}

export function createUiSampleServer() {
  return http.createServer((request, response) => {
    const target = resolveRequestPath(request.url);
    if (target === undefined || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type':
        mimeTypes.get(path.extname(target).toLowerCase()) ?? 'application/octet-stream',
    });
    fs.createReadStream(target).pipe(response);
  });
}

export function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(samplePort, '127.0.0.1', resolve);
  });
}

export function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}
