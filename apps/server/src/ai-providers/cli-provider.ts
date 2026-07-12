import type { AiProvider, ProviderDelta } from './provider.js';

export interface CliRunOptions {
  readonly shell: false;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}
export type CliProviderRunner = (
  executable: string,
  arguments_: readonly string[],
  options: CliRunOptions,
) => AsyncIterable<ProviderDelta>;

export function createCliProvider(options: {
  readonly id: string;
  readonly executable: string;
  readonly runner: CliProviderRunner;
  readonly workingDirectory?: string;
}): AiProvider {
  return {
    describe: () => ({
      id: options.id,
      kind: 'cli',
      maxConcurrency: 2,
      supportsStreaming: true,
    }),
    validateConfig: async () => ({ valid: true }),
    healthCheck: async () => ({ status: 'healthy' }),
    generate(request, signal) {
      return options.runner(
        options.executable,
        ['--task-id', request.taskId, '--prompt', request.prompt],
        {
          shell: false,
          cwd: options.workingDirectory ?? process.cwd(),
          env: {},
          signal,
        },
      );
    },
  };
}
