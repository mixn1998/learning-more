import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

import { z } from 'zod';

import { checksumJson } from '../persistence/json-codec.js';

export const RuntimeConfigSchema = z.strictObject({
  dataRoot: z.string().min(1),
  timezone: z.string().min(1),
  launcherPort: z.number().int().min(1).max(65_535),
  serverPort: z.number().int().min(1).max(65_535),
  providerId: z.string().min(1),
  interactiveConcurrency: z.number().int().min(1).max(100),
  backgroundConcurrency: z.number().int().min(1).max(100),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']),
});

export type RuntimeConfig = Readonly<z.infer<typeof RuntimeConfigSchema>>;

const PartialRuntimeConfigSchema = RuntimeConfigSchema.partial();
type RuntimeConfigPatch = z.infer<typeof PartialRuntimeConfigSchema>;

const defaults: RuntimeConfig = {
  dataRoot: path.resolve('.learning-more-data'),
  timezone: 'Asia/Shanghai',
  launcherPort: 43_119,
  serverPort: 43_120,
  providerId: 'mock',
  interactiveConcurrency: 2,
  backgroundConcurrency: 1,
  logLevel: 'info',
};

function environmentConfig(environment: NodeJS.ProcessEnv | undefined): RuntimeConfigPatch {
  if (environment === undefined) return {};
  const number = (key: string) => {
    const value = environment[key];
    return value === undefined ? undefined : Number(value);
  };
  return PartialRuntimeConfigSchema.parse({
    ...(environment.LEARNING_MORE_DATA_ROOT === undefined
      ? {}
      : { dataRoot: environment.LEARNING_MORE_DATA_ROOT }),
    ...(environment.LEARNING_MORE_TIMEZONE === undefined
      ? {}
      : { timezone: environment.LEARNING_MORE_TIMEZONE }),
    ...(number('LEARNING_MORE_LAUNCHER_PORT') === undefined
      ? {}
      : { launcherPort: number('LEARNING_MORE_LAUNCHER_PORT') }),
    ...(number('LEARNING_MORE_SERVER_PORT') === undefined
      ? {}
      : { serverPort: number('LEARNING_MORE_SERVER_PORT') }),
    ...(environment.LEARNING_MORE_PROVIDER_ID === undefined
      ? {}
      : { providerId: environment.LEARNING_MORE_PROVIDER_ID }),
    ...(number('LEARNING_MORE_INTERACTIVE_CONCURRENCY') === undefined
      ? {}
      : { interactiveConcurrency: number('LEARNING_MORE_INTERACTIVE_CONCURRENCY') }),
    ...(number('LEARNING_MORE_BACKGROUND_CONCURRENCY') === undefined
      ? {}
      : { backgroundConcurrency: number('LEARNING_MORE_BACKGROUND_CONCURRENCY') }),
    ...(environment.LEARNING_MORE_LOG_LEVEL === undefined
      ? {}
      : { logLevel: environment.LEARNING_MORE_LOG_LEVEL }),
  });
}

export function resolveRuntimeConfig(input: {
  cli?: unknown;
  environment?: NodeJS.ProcessEnv;
  file?: unknown;
}): RuntimeConfig {
  const file = input.file === undefined ? {} : PartialRuntimeConfigSchema.parse(input.file);
  const environment = environmentConfig(input.environment);
  const cli = input.cli === undefined ? {} : PartialRuntimeConfigSchema.parse(input.cli);
  return RuntimeConfigSchema.parse({ ...defaults, ...file, ...environment, ...cli });
}

const cliKeys: Readonly<Record<string, keyof RuntimeConfig>> = {
  '--data-root': 'dataRoot',
  '--timezone': 'timezone',
  '--launcher-port': 'launcherPort',
  '--server-port': 'serverPort',
  '--provider-id': 'providerId',
  '--interactive-concurrency': 'interactiveConcurrency',
  '--background-concurrency': 'backgroundConcurrency',
  '--log-level': 'logLevel',
};

export function parseRuntimeCliArguments(arguments_: readonly string[]): RuntimeConfigPatch {
  const result: Record<string, unknown> = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    const key = flag === undefined ? undefined : cliKeys[flag];
    if (key === undefined || value === undefined) throw new Error('runtime_cli_invalid');
    result[key] =
      key === 'launcherPort' ||
      key === 'serverPort' ||
      key === 'interactiveConcurrency' ||
      key === 'backgroundConcurrency'
        ? Number(value)
        : value;
  }
  return PartialRuntimeConfigSchema.parse(result);
}

export async function loadRuntimeConfig(
  input: {
    arguments?: readonly string[];
    environment?: NodeJS.ProcessEnv;
    runtimeFile?: string;
  } = {},
): Promise<RuntimeConfig> {
  const environment = input.environment ?? process.env;
  const runtimeFile =
    input.runtimeFile ?? environment.LEARNING_MORE_RUNTIME_CONFIG ?? path.resolve('runtime.json');
  let file: unknown = {};
  try {
    file = JSON.parse(await readFile(runtimeFile, 'utf8')) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return resolveRuntimeConfig({
    cli: parseRuntimeCliArguments(input.arguments ?? process.argv.slice(2)),
    environment,
    file,
  });
}

export function runtimeConfigFingerprint(config: RuntimeConfig): string {
  return createHash('sha256').update(checksumJson(config), 'utf8').digest('hex');
}
