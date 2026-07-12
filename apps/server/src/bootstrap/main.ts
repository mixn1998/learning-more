import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import type { RuntimeReady } from '@learning-more/contracts';

import { buildApp, type ServerDependencies } from './app.js';

const defaultReadiness: RuntimeReady = {
  status: 'ready',
  instanceId: randomUUID(),
  buildId: 'development',
  protocolVersion: '1',
  storeStatus: 'ready',
  projectionStatus: 'ready',
  providerStatus: 'unconfigured',
};

export async function startServer(
  dependencies: ServerDependencies = {
    getRuntimeReadiness: async () => defaultReadiness,
  },
  port = 43_120,
): Promise<void> {
  const app = await buildApp(dependencies);
  await app.listen({ host: '127.0.0.1', port });
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  await startServer();
}
