import { createLocalApplication } from '../../apps/server/src/bootstrap/local-application.js';
import { startServer } from '../../apps/server/src/bootstrap/main.js';

const dataRoot = process.env.LEARNING_MORE_DATA_ROOT;
if (dataRoot === undefined) throw new Error('LEARNING_MORE_DATA_ROOT is required');
const fixedNow = process.env.LEARNING_MORE_NOW;
process.once('SIGINT', () => process.exit(0));
process.once('SIGTERM', () => process.exit(0));
const local = await createLocalApplication({
  dataRoot,
  csrfToken: 'development-csrf',
  mockFailOnce: true,
  ...(fixedNow === undefined ? {} : { now: () => new Date(fixedNow) }),
});
await startServer(local.serverDependencies);
