import { execFile, spawn } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import type { ProviderModelOption } from '@learning-more/contracts';

import { ProviderExecutionError, type ProviderDelta, type ProviderValidation } from './provider.js';

export type CodexCliCommandResult = Readonly<{
  exitCode: number;
  stdout: string;
  stderr: string;
}>;

export type CodexCliCommandRunner = (
  executable: string,
  arguments_: readonly string[],
) => Promise<CodexCliCommandResult>;

export type CodexCliGenerationRequest = Readonly<{
  prompt: string;
  model: string;
  reasoningEffort: string;
  workingDirectory?: string;
}>;

export type CodexCliGenerationRunner = (
  executable: string,
  arguments_: readonly string[],
  options: Readonly<{ shell: false; cwd: string; signal: AbortSignal }>,
) => AsyncIterable<ProviderDelta>;

export type CodexCliProbe = Readonly<{
  version?: string;
  health: Readonly<{ status: 'healthy' | 'unhealthy'; message?: string }>;
  models: readonly ProviderModelOption[];
}>;

export interface CodexCliAdapter {
  probe(options?: Readonly<{ refresh?: boolean }>): Promise<CodexCliProbe>;
  validateSelection(model: string, reasoningEffort: string): Promise<ProviderValidation>;
  startLogin(): Promise<'started' | 'already_authenticated'>;
  generate(request: CodexCliGenerationRequest, signal: AbortSignal): AsyncIterable<ProviderDelta>;
}

function runCommand(
  executable: string,
  arguments_: readonly string[],
): Promise<CodexCliCommandResult> {
  return new Promise((resolve) => {
    execFile(
      executable,
      [...arguments_],
      {
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
        shell: false,
        timeout: 15_000,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const numericCode = typeof error?.code === 'number' ? error.code : undefined;
        resolve({
          exitCode: error === null ? 0 : (numericCode ?? 1),
          stdout,
          stderr,
        });
      },
    );
  });
}

function startInteractiveLogin(executable: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['login'], {
      shell: false,
      windowsHide: true,
      detached: false,
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0 ? resolve() : reject(new Error('codex_cli_login_failed')),
    );
    child.unref();
  });
}

function isAuthenticatedStatus(output: string): boolean {
  return !/\bnot logged in\b/i.test(output) && /\blogged in(?:\s+using\b|\s*$)/im.test(output);
}

async function* runGeneration(
  executable: string,
  arguments_: readonly string[],
  options: Readonly<{ shell: false; cwd: string; signal: AbortSignal }>,
): AsyncIterable<ProviderDelta> {
  if (options.signal.aborted) return;
  const child = spawn(executable, [...arguments_], {
    shell: false,
    windowsHide: process.platform === 'win32',
    cwd: options.cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let aborted = false;
  const onAbort = () => {
    aborted = true;
    child.kill();
  };
  options.signal.addEventListener('abort', onAbort, { once: true });
  const completion = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  try {
    for await (const chunk of child.stdout) {
      if (aborted) return;
      const text = Buffer.from(chunk).toString('utf8');
      if (text !== '') yield { type: 'text', text };
    }
    const code = await completion;
    if (aborted) return;
    if (code !== 0) {
      throw new ProviderExecutionError(`cli_exit_${code ?? 'unknown'}`, {
        retryable: true,
        beforeFirstDelta: true,
        code: 'provider_process_failed',
      });
    }
  } catch (error) {
    if (aborted) return;
    if (error instanceof ProviderExecutionError) throw error;
    throw new ProviderExecutionError('cli_process_failed', {
      retryable: true,
      beforeFirstDelta: true,
      code: 'provider_process_failed',
    });
  } finally {
    options.signal.removeEventListener('abort', onAbort);
  }
}

function pathCandidates(environment: NodeJS.ProcessEnv): readonly string[] {
  const executableNames = process.platform === 'win32' ? ['codex.exe', 'codex'] : ['codex'];
  return (environment.PATH ?? '')
    .split(path.delimiter)
    .map((entry) => entry.trim().replace(/^"|"$/g, ''))
    .filter((entry) => entry !== '')
    .flatMap((entry) => executableNames.map((name) => path.join(entry, name)));
}

async function currentUserInstallCandidates(
  environment: NodeJS.ProcessEnv,
): Promise<readonly string[]> {
  if (process.platform !== 'win32' || environment.LOCALAPPDATA === undefined) return [];
  const binRoot = path.join(environment.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
  try {
    const candidates = await Promise.all(
      (await readdir(binRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const executable = path.join(binRoot, entry.name, 'codex.exe');
          try {
            return { executable, modifiedAt: (await stat(executable)).mtimeMs };
          } catch {
            return undefined;
          }
        }),
    );
    return candidates
      .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined)
      .sort((left, right) => right.modifiedAt - left.modifiedAt)
      .map((candidate) => candidate.executable);
  } catch {
    return [];
  }
}

export async function discoverCodexCliExecutable(
  options: Readonly<{
    override?: string;
    environment?: NodeJS.ProcessEnv;
    pathCandidates?: readonly string[];
    localCandidates?: readonly string[];
    run?: CodexCliCommandRunner;
  }> = {},
): Promise<string | undefined> {
  const environment = options.environment ?? process.env;
  const run = options.run ?? runCommand;
  const candidates = [
    ...(options.override === undefined || options.override.trim() === ''
      ? []
      : [options.override.trim()]),
    ...(options.pathCandidates ?? pathCandidates(environment)),
    ...(options.localCandidates ?? (await currentUserInstallCandidates(environment))),
  ].filter((candidate, index, all) => all.indexOf(candidate) === index);

  for (const candidate of candidates) {
    try {
      if ((await run(candidate, ['--version'])).exitCode === 0) return candidate;
    } catch {
      // Inaccessible WindowsApps aliases can fail with EPERM. Discovery must
      // continue to the current user's real Codex installation.
    }
  }
  return undefined;
}

function normalizeModelCatalog(value: unknown): readonly ProviderModelOption[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('codex_cli_catalog_unavailable');
  }
  const models = (value as Record<string, unknown>).models;
  if (!Array.isArray(models)) throw new Error('codex_cli_catalog_unavailable');
  const normalized: ProviderModelOption[] = [];
  for (const candidate of models) {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const record = candidate as Record<string, unknown>;
    if (record.visibility !== 'list') continue;
    const levels = record.supported_reasoning_levels;
    if (
      typeof record.slug !== 'string' ||
      record.slug.trim() === '' ||
      typeof record.display_name !== 'string' ||
      record.display_name.trim() === '' ||
      typeof record.default_reasoning_level !== 'string' ||
      record.default_reasoning_level.trim() === '' ||
      !Array.isArray(levels)
    ) {
      throw new Error('codex_cli_catalog_unavailable');
    }
    const efforts = levels.flatMap((level) => {
      if (level === null || typeof level !== 'object' || Array.isArray(level)) return [];
      const effort = (level as Record<string, unknown>).effort;
      return typeof effort === 'string' && effort.trim() !== '' ? [effort.trim()] : [];
    });
    const supportedReasoningEfforts = efforts.filter(
      (effort, index) => efforts.indexOf(effort) === index,
    );
    const defaultReasoningEffort = record.default_reasoning_level.trim();
    if (
      supportedReasoningEfforts.length === 0 ||
      !supportedReasoningEfforts.includes(defaultReasoningEffort)
    ) {
      throw new Error('codex_cli_catalog_unavailable');
    }
    normalized.push({
      id: record.slug.trim(),
      displayName: record.display_name.trim(),
      defaultReasoningEffort,
      supportedReasoningEfforts,
    });
  }
  if (normalized.length === 0) throw new Error('codex_cli_catalog_unavailable');
  return normalized;
}

export function createCodexCliAdapter(
  options: Readonly<{
    executable: string;
    run?: CodexCliCommandRunner;
    startLogin?: (executable: string) => Promise<void>;
    generate?: CodexCliGenerationRunner;
    now?: () => number;
    catalogTtlMs?: number;
  }>,
): CodexCliAdapter {
  const run = options.run ?? runCommand;
  const startLoginProcess = options.startLogin ?? startInteractiveLogin;
  const generate = options.generate ?? runGeneration;
  const now = options.now ?? Date.now;
  const catalogTtlMs = options.catalogTtlMs ?? 60_000;
  let cached: Readonly<{ expiresAt: number; probe: CodexCliProbe }> | undefined;
  let loginInFlight: Promise<void> | undefined;

  async function probe(refresh = false): Promise<CodexCliProbe> {
    if (!refresh && cached !== undefined && cached.expiresAt > now()) return cached.probe;
    const versionResult = await run(options.executable, ['--version']);
    if (versionResult.exitCode !== 0) {
      return { health: { status: 'unhealthy', message: 'codex_cli_unexecutable' }, models: [] };
    }
    const version = versionResult.stdout.trim().replace(/^codex-cli\s+/i, '');
    const loginResult = await run(options.executable, ['login', 'status']);
    if (
      loginResult.exitCode !== 0 ||
      !isAuthenticatedStatus(`${loginResult.stdout}\n${loginResult.stderr}`)
    ) {
      return {
        ...(version === '' ? {} : { version }),
        health: { status: 'unhealthy', message: 'codex_cli_not_authenticated' },
        models: [],
      };
    }
    const catalogResult = await run(options.executable, ['debug', 'models']);
    if (catalogResult.exitCode !== 0) {
      return {
        ...(version === '' ? {} : { version }),
        health: { status: 'unhealthy', message: 'codex_cli_catalog_unavailable' },
        models: [],
      };
    }
    try {
      const models = normalizeModelCatalog(JSON.parse(catalogResult.stdout) as unknown);
      const result: CodexCliProbe = {
        ...(version === '' ? {} : { version }),
        health: { status: 'healthy' },
        models,
      };
      cached = { expiresAt: now() + catalogTtlMs, probe: result };
      return result;
    } catch {
      return {
        ...(version === '' ? {} : { version }),
        health: { status: 'unhealthy', message: 'codex_cli_catalog_unavailable' },
        models: [],
      };
    }
  }

  return {
    probe: (input) => probe(input?.refresh ?? false),
    async validateSelection(model, reasoningEffort) {
      const current = await probe(false);
      if (current.health.status !== 'healthy') {
        return { valid: false, message: current.health.message ?? 'health' };
      }
      const selected = current.models.find((candidate) => candidate.id === model);
      if (selected === undefined) return { valid: false, message: 'model' };
      if (!selected.supportedReasoningEfforts.includes(reasoningEffort)) {
        return { valid: false, message: 'reasoningEffort' };
      }
      return { valid: true };
    },
    async startLogin() {
      if (loginInFlight !== undefined) return 'started';
      const loginStatus = await run(options.executable, ['login', 'status']);
      if (
        loginStatus.exitCode === 0 &&
        isAuthenticatedStatus(`${loginStatus.stdout}\n${loginStatus.stderr}`)
      ) {
        return 'already_authenticated';
      }
      cached = undefined;
      loginInFlight = startLoginProcess(options.executable)
        .catch(() => undefined)
        .finally(() => {
          loginInFlight = undefined;
          cached = undefined;
        });
      return 'started';
    },
    generate(request, signal) {
      return generate(
        options.executable,
        [
          'exec',
          '--ephemeral',
          '--skip-git-repo-check',
          '--sandbox',
          'read-only',
          '--model',
          request.model,
          '-c',
          `model_reasoning_effort=${JSON.stringify(request.reasoningEffort)}`,
          request.prompt,
        ],
        {
          shell: false,
          cwd: request.workingDirectory ?? process.cwd(),
          signal,
        },
      );
    },
  };
}
