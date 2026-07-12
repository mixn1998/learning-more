import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { buildApp, type ServerDependencies } from './app.js';
import { createLocalApplication } from './local-application.js';

export async function startServer(dependencies?: ServerDependencies, port = 43_120): Promise<void> {
  const resolvedDependencies =
    dependencies ??
    (
      await createLocalApplication({
        dataRoot: process.env.LEARNING_MORE_DATA_ROOT ?? path.resolve('.learning-more-data'),
        csrfToken: process.env.LEARNING_MORE_CSRF_TOKEN ?? 'development-csrf',
        allowedOrigin: process.env.LEARNING_MORE_ALLOWED_ORIGIN ?? 'http://127.0.0.1:5173',
        mockFailOnce: process.env.LEARNING_MORE_MOCK_FAIL_ONCE === '1',
      })
    ).serverDependencies;
  const app = await buildApp(resolvedDependencies);
  await app.listen({ host: '127.0.0.1', port });
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  await startServer();
}
