import path from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = process.cwd();
const localStateRoot = path.join(projectRoot, '.learning-more-local');

process.env.LEARNING_MORE_PROJECT_ROOT ??= projectRoot;
process.env.LEARNING_MORE_DATA_ROOT ??= path.join(projectRoot, '.learning-more-data');
process.env.LEARNING_MORE_RUNTIME_DIR ??= path.join(projectRoot, '.learning-more-runtime');
process.env.LEARNING_MORE_LOG_DIR ??= path.join(localStateRoot, 'logs');
process.env.LEARNING_MORE_SECRET_DIR ??= path.join(localStateRoot, 'secrets');
process.env.LEARNING_MORE_DIAGNOSTICS_DIR ??= path.join(localStateRoot, 'diagnostics');
process.env.LEARNING_MORE_SERVER_ENTRY ??= path.join(
  projectRoot,
  'apps',
  'server',
  'dist',
  'bootstrap',
  'main.js',
);
process.env.LEARNING_MORE_WEB_ROOT ??= path.join(projectRoot, 'apps', 'web', 'dist');
process.env.LEARNING_MORE_WEB_URL ??= 'http://127.0.0.1:43119';
process.env.LEARNING_MORE_ALLOWED_ORIGIN ??= 'http://127.0.0.1:43119';

const launcherModule = await import(
  pathToFileURL(path.join(projectRoot, 'apps', 'launcher', 'dist', 'main.js')).href
);
const launcher = await launcherModule.runLauncher();

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await launcher.close();
  process.exit(0);
}

process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
