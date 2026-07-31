import type { AiProvider, NormalizedGenerationRequest, ProviderDelta } from './provider.js';
import { createCodexCliAdapter, type CodexCliAdapter } from './codex-cli-adapter.js';

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

function configuredString(
  config: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = config[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

export function createCliProvider(options: {
  readonly id: string;
  readonly executable: string;
  readonly adapter?: CodexCliAdapter;
  readonly runner?: CliProviderRunner;
  readonly workingDirectory?: string;
  readonly defaultModel?: string;
  readonly defaultReasoningEffort?: string;
}): AiProvider {
  const adapter =
    options.adapter ??
    (options.runner === undefined
      ? createCodexCliAdapter({ executable: options.executable })
      : undefined);
  let activeModel = options.defaultModel;
  let activeReasoningEffort = options.defaultReasoningEffort;

  async function selection(request: NormalizedGenerationRequest) {
    if (request.model !== undefined && request.model.trim() !== '') {
      const models = await adapter?.probe();
      const selected = models?.models.find((candidate) => candidate.id === request.model);
      return {
        model: request.model,
        reasoningEffort:
          request.reasoningEffort ??
          activeReasoningEffort ??
          selected?.defaultReasoningEffort ??
          'medium',
      };
    }
    if (activeModel !== undefined) {
      const models = await adapter?.probe();
      const selected = models?.models.find((candidate) => candidate.id === activeModel);
      return {
        model: activeModel,
        reasoningEffort:
          request.reasoningEffort ??
          activeReasoningEffort ??
          selected?.defaultReasoningEffort ??
          'medium',
      };
    }
    const probe = await adapter?.probe();
    const first = probe?.models[0];
    return {
      model: first?.id ?? '',
      reasoningEffort:
        request.reasoningEffort ??
        activeReasoningEffort ??
        first?.defaultReasoningEffort ??
        'medium',
    };
  }

  return {
    describe: () => ({
      id: options.id,
      kind: 'cli',
      maxConcurrency: 2,
      supportsStreaming: true,
    }),
    async validateConfig(config) {
      if (options.runner !== undefined) return { valid: true };
      if (adapter === undefined) return { valid: false, message: 'executable' };
      const record = config as Readonly<Record<string, unknown>>;
      const probe = await adapter.probe();
      if (probe.health.status !== 'healthy') {
        return { valid: false, message: probe.health.message ?? 'health' };
      }
      const model = configuredString(record, 'model') ?? probe.models[0]?.id;
      const selected = probe.models.find((candidate) => candidate.id === model);
      const reasoningEffort =
        configuredString(record, 'reasoningEffort') ?? selected?.defaultReasoningEffort;
      if (model === undefined || reasoningEffort === undefined) {
        return { valid: false, message: 'model' };
      }
      return adapter.validateSelection(model, reasoningEffort);
    },
    async healthCheck() {
      if (options.runner !== undefined) return { status: 'healthy' as const };
      if (adapter === undefined) {
        return { status: 'unhealthy' as const, message: 'codex_cli_not_found' };
      }
      return (await adapter.probe()).health;
    },
    async listModels(input) {
      if (options.runner !== undefined || adapter === undefined) return [];
      return (await adapter.probe(input)).models;
    },
    async startAuthentication() {
      if (adapter === undefined) throw new Error('codex_cli_not_found');
      return adapter.startLogin();
    },
    async configure(config) {
      const record = config as Readonly<Record<string, unknown>>;
      const configuredModel = configuredString(record, 'model');
      const configuredReasoningEffort = configuredString(record, 'reasoningEffort');
      if (configuredModel !== undefined && configuredReasoningEffort !== undefined) {
        activeModel = configuredModel;
        activeReasoningEffort = configuredReasoningEffort;
        return;
      }
      const probe = await adapter?.probe();
      const model = configuredModel ?? probe?.models[0]?.id;
      const selected = probe?.models.find((candidate) => candidate.id === model);
      const reasoningEffort = configuredReasoningEffort ?? selected?.defaultReasoningEffort;
      if (model !== undefined) activeModel = model;
      if (reasoningEffort !== undefined) activeReasoningEffort = reasoningEffort;
    },
    async *generate(request, signal) {
      const selected = await selection(request);
      if (options.runner !== undefined) {
        yield* options.runner(
          request.executable ?? options.executable,
          request.arguments ?? [
            'exec',
            '--ephemeral',
            '--skip-git-repo-check',
            '--sandbox',
            'read-only',
            '--model',
            selected.model,
            '-c',
            `model_reasoning_effort="${selected.reasoningEffort}"`,
            request.prompt,
          ],
          {
            shell: false,
            cwd: request.workingDirectory ?? options.workingDirectory ?? process.cwd(),
            env: request.environment ?? {},
            signal,
          },
        );
        return;
      }
      if (adapter === undefined || selected.model === '') {
        throw new Error('codex_cli_catalog_unavailable');
      }
      yield* adapter.generate(
        {
          prompt: request.prompt,
          model: selected.model,
          reasoningEffort: selected.reasoningEffort,
          ...((request.workingDirectory ?? options.workingDirectory) === undefined
            ? {}
            : { workingDirectory: request.workingDirectory ?? options.workingDirectory }),
        },
        signal,
      );
    },
  };
}
