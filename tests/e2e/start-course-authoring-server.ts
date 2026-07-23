import { createLocalApplication } from '../../apps/server/src/bootstrap/local-application.js';
import { startServer } from '../../apps/server/src/bootstrap/main.js';
import { resolveE2eEnvironment } from '../support/e2e-environment.js';

const dataRoot = process.env.LEARNING_MORE_DATA_ROOT;
if (dataRoot === undefined) throw new Error('LEARNING_MORE_DATA_ROOT is required');
const fixedNow = process.env.LEARNING_MORE_NOW;
const environment = resolveE2eEnvironment();
process.once('SIGINT', () => process.exit(0));
process.once('SIGTERM', () => process.exit(0));
const local = await createLocalApplication({
  dataRoot,
  csrfToken: 'development-csrf',
  allowedOrigin: environment.webBaseUrl,
  mockFailOnce: true,
  runtimeIdentity: {
    instanceId: 'instance_e2e',
    generation: 1,
    startedAt: new Date().toISOString(),
    identityFingerprint: 'e'.repeat(64),
    buildId: environment.buildId,
    protocolVersion: '1',
  },
  ...(fixedNow === undefined ? {} : { now: () => new Date(fixedNow) }),
});
await startServer(local.serverDependencies, environment.serverPort);
