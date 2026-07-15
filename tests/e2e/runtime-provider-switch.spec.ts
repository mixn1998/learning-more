import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import type { AiProvider } from '../../apps/server/src/ai-providers/provider.js';
import { createLocalApplication } from '../../apps/server/src/bootstrap/local-application.js';
import { startServer } from '../../apps/server/src/bootstrap/main.js';
import { createLocalFileProviderConfigRepository } from '../../apps/server/src/runtime/provider-config-service.js';
import { createWindowsDpapiSecretStore } from '../../apps/server/src/runtime/windows-dpapi-secret-store.js';
import { removeRuntimeRoot } from './runtime-harness.js';

function provider(id: string, requiresSecret = false): AiProvider {
  return {
    describe: () => ({ id, kind: 'api', maxConcurrency: 2, supportsStreaming: true }),
    async validateConfig(_config, secrets) {
      return requiresSecret
        ? { valid: (await secrets('apiKey')) === 'E2E_PROVIDER_SECRET_SENTINEL' }
        : { valid: true };
    },
    healthCheck: async () => ({ status: 'healthy' }),
    async *generate() {
      yield {
        type: 'text',
        text: '## This week\n\nInsufficient evidence to infer a stable change.',
      };
    },
  };
}

test('persists a validated Provider switch and keeps its DPAPI secret after restart', async () => {
  test.skip(process.platform !== 'win32', 'Windows DPAPI release behavior');
  const root = path.join(process.cwd(), 'tests', '.tmp', 'runtime-provider-switch');
  await removeRuntimeRoot(root);
  const dataRoot = path.join(root, 'data');
  const secretDirectory = path.join(root, 'secrets');
  const configPath = path.join(root, 'runtime', 'provider-config.json');
  const secrets = createWindowsDpapiSecretStore(secretDirectory);
  await secrets.put('provider/api-key', new TextEncoder().encode('E2E_PROVIDER_SECRET_SENTINEL'));
  const providers = [provider('old'), provider('new', true)];
  const first = await createLocalApplication({
    dataRoot,
    csrfToken: 'e2e-csrf',
    providers,
    secretStore: secrets,
    providerConfigRepository: createLocalFileProviderConfigRepository(configPath),
  });
  const app = await startServer(first.serverDependencies);
  try {
    const response = await fetch('http://127.0.0.1:43120/api/v1/ai-runtime/provider-switches', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': 'e2e-csrf' },
      body: JSON.stringify({
        providerId: 'new',
        publicConfig: { model: 'model-e2e' },
        secretHandles: { apiKey: 'provider/api-key' },
      }),
    });
    expect(response.status).toBe(200);
    const task = await first.generationRuntime.submit({
      taskKey: 'provider-e2e-first',
      inputSnapshotHash: 'first',
      taskKind: 'learning-chat',
      taskGroup: 'interactive',
      ownerRef: 'owner-first',
      providerId: 'current',
      priority: 100,
      prompt: 'hello',
    });
    await expect(first.generationRuntime.get(task.taskId)).resolves.toMatchObject({
      providerId: 'new',
    });
  } finally {
    try {
      await app.close();
    } finally {
      await first.close();
    }
  }
  const restarted = await createLocalApplication({
    dataRoot,
    csrfToken: 'e2e-csrf',
    providers: [provider('old'), provider('new', true)],
    secretStore: createWindowsDpapiSecretStore(secretDirectory),
    providerConfigRepository: createLocalFileProviderConfigRepository(configPath),
  });
  try {
    const afterRestart = await restarted.generationRuntime.submit({
      taskKey: 'provider-e2e-restarted',
      inputSnapshotHash: 'restarted',
      taskKind: 'learning-chat',
      taskGroup: 'interactive',
      ownerRef: 'owner-restarted',
      providerId: 'current',
      priority: 100,
      prompt: 'hello again',
    });
    await expect(restarted.generationRuntime.get(afterRestart.taskId)).resolves.toMatchObject({
      providerId: 'new',
    });
    const disk = await Promise.all(
      (await readdir(secretDirectory)).map((name) =>
        readFile(path.join(secretDirectory, name), 'utf8'),
      ),
    );
    expect(disk.join('\n')).not.toContain('E2E_PROVIDER_SECRET_SENTINEL');
  } finally {
    await restarted.close();
    await removeRuntimeRoot(root);
  }
});
