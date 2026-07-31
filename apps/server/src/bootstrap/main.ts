import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FastifyInstance } from 'fastify';

import { buildApp, type ServerDependencies } from './app.js';
import { createLocalApplication } from './local-application.js';
import { loadRuntimeConfig, runtimeConfigFingerprint } from '../runtime/runtime-config.js';
import { createRuntimeManifest, runtimeIdentityFingerprint } from '../runtime/runtime-manifest.js';
import { createRuntimeManifestRepository } from '../runtime/runtime-manifest-repository.js';
import { createEnvironmentSecretStore } from '../runtime/environment-secret-store.js';
import { createDiagnosticsArtifact } from '../runtime/diagnostics.js';
import { createStructuredLogger, type StructuredLogger } from '../runtime/logger.js';
import { createLocalFileProviderConfigRepository } from '../runtime/provider-config-service.js';
import { createApiProvider } from '../ai-providers/api-provider.js';
import { createCliProvider } from '../ai-providers/cli-provider.js';
import { discoverCodexCliExecutable } from '../ai-providers/codex-cli-adapter.js';
import type { SecretStore } from '../runtime/secret-store.js';
import { createWindowsDpapiSecretStore } from '../runtime/windows-dpapi-secret-store.js';
import { createApplicationEnvironment } from '../environment/application-environment.js';

export async function startServer(
  dependencies?: ServerDependencies,
  port?: number,
): Promise<FastifyInstance> {
  let resolvedDependencies = dependencies;
  let manifestOwner: { instanceId: string; generation: number } | undefined;
  let manifestRepository: ReturnType<typeof createRuntimeManifestRepository> | undefined;
  let logger: StructuredLogger | undefined;
  let closeLocalApplication: (() => Promise<void>) | undefined;
  let resolvedPort = port ?? 43_120;
  if (resolvedDependencies === undefined) {
    const config = await loadRuntimeConfig();
    resolvedPort = port ?? config.serverPort;
    const runtimeDirectory =
      process.env.LEARNING_MORE_RUNTIME_DIR ?? path.resolve('.learning-more-runtime');
    manifestRepository = createRuntimeManifestRepository(
      path.join(runtimeDirectory, 'runtime-manifest.json'),
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
    const localApplicationDirectory = path.join(
      process.env.LOCALAPPDATA ?? runtimeDirectory,
      'Learning MORE',
    );
    const logDirectory =
      process.env.LEARNING_MORE_LOG_DIR ?? path.join(localApplicationDirectory, 'logs');
    logger = createStructuredLogger({
      directory: logDirectory,
      instanceId: manifest.instanceId,
    });
    await logger.log('runtime', {
      level: 'info',
      component: 'ServerBootstrap',
      correlationId: manifest.instanceId,
      eventCode: 'server_starting',
      fields: { generation: manifest.generation, buildId: manifest.buildId },
    });
    manifestOwner = { instanceId: manifest.instanceId, generation: manifest.generation };
    const secretStore: SecretStore =
      process.platform === 'win32'
        ? createWindowsDpapiSecretStore(
            process.env.LEARNING_MORE_SECRET_DIR ??
              path.join(process.env.LOCALAPPDATA ?? runtimeDirectory, 'Learning MORE', 'secrets'),
          )
        : createEnvironmentSecretStore(process.env, {
            'provider/api-key': 'LEARNING_MORE_PROVIDER_API_KEY',
          });
    const applicationEnvironment = createApplicationEnvironment({
      mode: config.deploymentMode,
      dataRoot: config.dataRoot,
      allowedOrigin: process.env.LEARNING_MORE_ALLOWED_ORIGIN ?? 'http://127.0.0.1:5173',
      csrfToken: process.env.LEARNING_MORE_CSRF_TOKEN ?? 'development-csrf',
      secretStore,
    });
    const codexCliExecutable = await discoverCodexCliExecutable({
      ...(process.env.LEARNING_MORE_CODEX_CLI_EXECUTABLE === undefined
        ? {}
        : { override: process.env.LEARNING_MORE_CODEX_CLI_EXECUTABLE }),
    });
    const localApplication = await createLocalApplication({
      dataRoot: applicationEnvironment.dataScope.dataRoot,
      csrfToken: process.env.LEARNING_MORE_CSRF_TOKEN ?? 'development-csrf',
      requestAccess: applicationEnvironment.requestAccess,
      allowedOrigin: process.env.LEARNING_MORE_ALLOWED_ORIGIN ?? 'http://127.0.0.1:5173',
      mockFailOnce: process.env.LEARNING_MORE_MOCK_FAIL_ONCE === '1',
      initialProviderId: config.providerId,
      defaultFallbackProviderIds: (process.env.LEARNING_MORE_FALLBACK_PROVIDER_IDS ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value !== ''),
      defaultMaxAttempts: (() => {
        const value = Number(process.env.LEARNING_MORE_FALLBACK_MAX_ATTEMPTS ?? '3');
        return Number.isInteger(value) && value > 0 && value <= 10 ? value : 3;
      })(),
      additionalProviders: [
        ...(process.env.LEARNING_MORE_API_BASE_URL === undefined ||
        process.env.LEARNING_MORE_API_MODEL === undefined
          ? []
          : [
              createApiProvider({
                id: process.env.LEARNING_MORE_API_PROVIDER_ID ?? 'api',
                defaultConfig: {
                  baseUrl: process.env.LEARNING_MORE_API_BASE_URL,
                  model: process.env.LEARNING_MORE_API_MODEL,
                  ...(process.env.LEARNING_MORE_PROVIDER_API_KEY === undefined
                    ? {}
                    : { apiKey: process.env.LEARNING_MORE_PROVIDER_API_KEY }),
                },
              }),
            ]),
        ...(codexCliExecutable === undefined
          ? []
          : [
              createCliProvider({
                id: process.env.LEARNING_MORE_CODEX_CLI_PROVIDER_ID ?? 'codex-cli',
                executable: codexCliExecutable,
                ...(process.env.LEARNING_MORE_CODEX_CLI_MODEL === undefined
                  ? {}
                  : { defaultModel: process.env.LEARNING_MORE_CODEX_CLI_MODEL }),
                ...(process.env.LEARNING_MORE_CODEX_CLI_REASONING_EFFORT === undefined
                  ? {}
                  : {
                      defaultReasoningEffort: process.env.LEARNING_MORE_CODEX_CLI_REASONING_EFFORT,
                    }),
              }),
            ]),
      ],
      secretStore: applicationEnvironment.secretStore,
      providerConfigRepository: createLocalFileProviderConfigRepository(
        path.join(runtimeDirectory, 'provider-config.json'),
      ),
      createDiagnostics: async () =>
        createDiagnosticsArtifact({
          outputDirectory:
            process.env.LEARNING_MORE_DIAGNOSTICS_DIR ??
            path.join(localApplicationDirectory, 'diagnostics'),
          logDirectory,
          publicConfig: config,
          manifest: {
            ...manifest,
            identityFingerprint: runtimeIdentityFingerprint(manifest),
          },
          checksumReport: { status: 'available', checkedFiles: 0 },
        }),
      logProjectionEvent: (input) => logger!.log('projection', input),
      runtimeIdentity: {
        instanceId: manifest.instanceId,
        generation: manifest.generation,
        startedAt: manifest.startedAt,
        identityFingerprint: runtimeIdentityFingerprint(manifest),
        buildId: manifest.buildId,
        protocolVersion: manifest.protocolVersion,
      },
    });
    resolvedDependencies = localApplication.serverDependencies;
    closeLocalApplication = localApplication.close;
    await manifestRepository.write(manifest);
  }
  const repository = manifestRepository;
  const owner = manifestOwner;
  const activeLogger = logger;
  const app = await buildApp(resolvedDependencies, {
    ...(repository === undefined && activeLogger === undefined
      ? {}
      : {
          onClose: async () => {
            await closeLocalApplication?.();
            if (activeLogger !== undefined) {
              await activeLogger
                .log('runtime', {
                  level: 'info',
                  component: 'ServerBootstrap',
                  correlationId: owner?.instanceId ?? 'standalone',
                  eventCode: 'server_stopped',
                })
                .catch(() => undefined);
              await activeLogger.close().catch(() => undefined);
            }
            if (repository !== undefined && owner !== undefined) await repository.remove(owner);
          },
        }),
  });
  try {
    await app.listen({ host: '127.0.0.1', port: resolvedPort });
    if (activeLogger !== undefined) {
      await activeLogger
        .log('runtime', {
          level: 'info',
          component: 'ServerBootstrap',
          correlationId: owner?.instanceId ?? 'standalone',
          eventCode: 'server_ready',
          fields: { port: resolvedPort },
        })
        .catch(() => undefined);
    }
  } catch (error) {
    await activeLogger
      ?.log('runtime', {
        level: 'error',
        component: 'ServerBootstrap',
        correlationId: owner?.instanceId ?? 'standalone',
        eventCode: 'server_start_failed',
        fields: { error },
      })
      .catch(() => undefined);
    await activeLogger?.close();
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
