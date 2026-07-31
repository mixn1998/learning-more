import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const marker = process.env.LEARNING_MORE_FOREIGN_MARKER;
if (marker === undefined) throw new Error('LEARNING_MORE_FOREIGN_MARKER is required');
const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/plain' });
  response.end('foreign-owner');
});
await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(43_120, '127.0.0.1', resolve);
});
await writeFile(marker, String(process.pid), 'utf8');
const close = () => server.close(() => process.exit(0));
process.once('SIGINT', close);
process.once('SIGTERM', close);
process.stdin.resume();
