import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FastifyInstance } from 'fastify';

import { buildApp, type ServerDependencies } from './app.js';
import { createLocalApplication } from './local-application.js';
import { loadRuntimeConfig, runtimeConfigFingerprint } from '../runtime/runtime-config.js';
import { createRuntimeManifest, runtimeIdentityFingerprint } from '../runtime/runtime-manifest.js';
import { createRuntimeManifestRepository } from '../runtime/runtime-manifest-repository.js';

export async function startServer(
  dependencies?: ServerDependencies,
  port?: number,
): Promise<FastifyInstance> {
  let resolvedDependencies = dependencies;
  let manifestOwner: { instanceId: string; generation: number } | undefined;
  let manifestRepository: ReturnType<typeof createRuntimeManifestRepository> | undefined;
  let resolvedPort = port ?? 43_120;
  if (resolvedDependencies === undefined) {
    const config = await loadRuntimeConfig();
    resolvedPort = port ?? config.serverPort;
    manifestRepository = createRuntimeManifestRepository(
      path.join(
        process.env.LEARNING_MORE_RUNTIME_DIR ?? path.resolve('.learning-more-runtime'),
        'runtime-manifest.json',
      ),
    );
    const previous = await manifestRepository.read();
    const startedAt = new Date().toISOString();
    const manifest = createRuntimeManifest({
      instanceId: `instance_${randomUUID()}`,
      generation: (previous?.generation ?? 0) + 1,
      pid: process.pid,
      executable: process.execPath,
      projectRoot: process.cwd(),
      dataRoot: config.dataRoot,
      configFingerprint: runtimeConfigFingerprint(config),
      buildId: process.env.LEARNING_MORE_BUILD_ID ?? 'development',
      protocolVersion: '1',
      startedAt,
      healthUrl: `http://127.0.0.1:${resolvedPort}/api/v1/runtime/ready`,
    });
    manifestOwner = { instanceId: manifest.instanceId, generation: manifest.generation };
    resolvedDependencies = (
      await createLocalApplication({
        dataRoot: config.dataRoot,
        csrfToken: process.env.LEARNING_MORE_CSRF_TOKEN ?? 'development-csrf',
        allowedOrigin: process.env.LEARNING_MORE_ALLOWED_ORIGIN ?? 'http://127.0.0.1:5173',
        mockFailOnce: process.env.LEARNING_MORE_MOCK_FAIL_ONCE === '1',
        runtimeIdentity: {
          instanceId: manifest.instanceId,
          generation: manifest.generation,
          startedAt: manifest.startedAt,
          identityFingerprint: runtimeIdentityFingerprint(manifest),
          buildId: manifest.buildId,
          protocolVersion: manifest.protocolVersion,
        },
      })
    ).serverDependencies;
    await manifestRepository.write(manifest);
  }
  const repository = manifestRepository;
  const owner = manifestOwner;
  const app = await buildApp(resolvedDependencies, {
    ...(repository === undefined || owner === undefined
      ? {}
      : { onClose: async () => void (await repository.remove(owner)) }),
  });
  try {
    await app.listen({ host: '127.0.0.1', port: resolvedPort });
  } catch (error) {
    if (manifestRepository !== undefined && manifestOwner !== undefined) {
      await manifestRepository.remove(manifestOwner);
    }
    throw error;
  }
  return app;
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  const app = await startServer();
  const stop = async () => {
    await app.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
}
