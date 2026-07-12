import { rm } from 'node:fs/promises';

import { createLocalApplication } from '../../apps/server/src/bootstrap/local-application.js';
import { startServer } from '../../apps/server/src/bootstrap/main.js';

const dataRoot = process.env.LEARNING_MORE_DATA_ROOT;
if (dataRoot === undefined) throw new Error('LEARNING_MORE_DATA_ROOT is required');
process.once('SIGINT', () => process.exit(0));
process.once('SIGTERM', () => process.exit(0));
await rm(dataRoot, { recursive: true, force: true });
const local = await createLocalApplication({
  dataRoot,
  csrfToken: 'development-csrf',
  mockFailOnce: true,
});
await startServer(local.serverDependencies);
