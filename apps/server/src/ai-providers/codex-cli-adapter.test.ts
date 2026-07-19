import { describe, expect, it, vi } from 'vitest';

import { createCodexCliAdapter, discoverCodexCliExecutable } from './codex-cli-adapter.js';

describe('CodexCliAdapter', () => {
  it('falls through an inaccessible PATH alias to the current-user installation', async () => {
    const run = vi.fn(async (executable: string) => {
      if (executable.includes('WindowsApps')) {
        throw Object.assign(new Error('spawn EPERM'), { code: 'EPERM' });
      }
      return {
        exitCode:
          executable === 'C:/Users/current/AppData/Local/OpenAI/Codex/bin/current/codex.exe'
            ? 0
            : 1,
        stdout: '',
        stderr: '',
      };
    });

    await expect(
      discoverCodexCliExecutable({
        pathCandidates: ['C:/Program Files/WindowsApps/OpenAI.Codex/codex.exe'],
        localCandidates: ['C:/Users/current/AppData/Local/OpenAI/Codex/bin/current/codex.exe'],
        run,
      }),
    ).resolves.toBe('C:/Users/current/AppData/Local/OpenAI/Codex/bin/current/codex.exe');
  });

  it('reports the live visible model catalog and its real reasoning efforts', async () => {
    const run = vi.fn(async (_executable: string, arguments_: readonly string[]) => {
      if (arguments_[0] === '--version') {
        return { exitCode: 0, stdout: 'codex-cli 0.144.0-alpha.4\n', stderr: '' };
      }
      if (arguments_[0] === 'login') {
        return { exitCode: 0, stdout: '', stderr: 'Logged in using ChatGPT\n' };
      }
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          models: [
            {
              slug: 'gpt-5.6-sol',
              display_name: 'GPT-5.6-Sol',
              default_reasoning_level: 'low',
              supported_reasoning_levels: [
                { effort: 'low', description: 'Fast' },
                { effort: 'medium', description: 'Balanced' },
                { effort: 'ultra', description: 'Maximum' },
              ],
              visibility: 'list',
              ignored_remote_metadata: { changesOften: true },
            },
            {
              slug: 'hidden-model',
              display_name: 'Hidden',
              default_reasoning_level: 'high',
              supported_reasoning_levels: [{ effort: 'high' }],
              visibility: 'hide',
            },
          ],
        }),
        stderr: '',
      };
    });
    const adapter = createCodexCliAdapter({ executable: 'codex.exe', run });

    await expect(adapter.probe({ refresh: true })).resolves.toEqual({
      version: '0.144.0-alpha.4',
      health: { status: 'healthy' },
      models: [
        {
          id: 'gpt-5.6-sol',
          displayName: 'GPT-5.6-Sol',
          defaultReasoningEffort: 'low',
          supportedReasoningEfforts: ['low', 'medium', 'ultra'],
        },
      ],
    });
  });

  it('starts one interactive login flow while authentication is pending', async () => {
    let finishLogin: (() => void) | undefined;
    const startLogin = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishLogin = resolve;
        }),
    );
    const run = vi.fn(async (_executable: string, arguments_: readonly string[]) => ({
      exitCode: arguments_[0] === '--version' ? 0 : 1,
      stdout: arguments_[0] === '--version' ? 'codex-cli 0.144.0-alpha.4\n' : '',
      stderr: '',
    }));
    const adapter = createCodexCliAdapter({ executable: 'codex.exe', run, startLogin });

    await expect(adapter.startLogin()).resolves.toBe('started');
    await expect(adapter.startLogin()).resolves.toBe('started');
    expect(startLogin).toHaveBeenCalledTimes(1);
    finishLogin?.();
  });

  it('does not treat an explicit not-logged-in status as authenticated', async () => {
    const startLogin = vi.fn(async () => undefined);
    const run = vi.fn(async () => ({
      exitCode: 0,
      stdout: 'Not logged in\n',
      stderr: '',
    }));
    const adapter = createCodexCliAdapter({ executable: 'codex.exe', run, startLogin });

    await expect(adapter.startLogin()).resolves.toBe('started');
    expect(startLogin).toHaveBeenCalledTimes(1);
  });

  it('runs generation through the real codex exec argument contract', async () => {
    const calls: Array<{
      executable: string;
      arguments_: readonly string[];
      options: Readonly<{ shell: false; cwd: string; signal: AbortSignal; stdin?: string }>;
    }> = [];
    const generate = async function* (
      executable: string,
      arguments_: readonly string[],
      options: Readonly<{ shell: false; cwd: string; signal: AbortSignal; stdin?: string }>,
    ) {
      calls.push({ executable, arguments_, options });
      yield { type: 'text' as const, text: 'ready' };
    };
    const adapter = createCodexCliAdapter({ executable: 'codex.exe', generate });
    const output: string[] = [];
    const signal = new AbortController().signal;

    for await (const delta of adapter.generate(
      {
        prompt: 'Explain the topic',
        model: 'gpt-5.6-sol',
        reasoningEffort: 'ultra',
        workingDirectory: 'D:/workspace/course',
      },
      signal,
    )) {
      output.push(delta.text);
    }

    expect(output).toEqual(['ready']);
    expect(calls).toEqual([
      {
        executable: 'codex.exe',
        arguments_: [
          'exec',
          '--ephemeral',
          '--skip-git-repo-check',
          '--sandbox',
          'read-only',
          '--model',
          'gpt-5.6-sol',
          '-c',
          'model_reasoning_effort="ultra"',
          '-',
        ],
        options: { shell: false, cwd: 'D:/workspace/course', signal, stdin: 'Explain the topic' },
      },
    ]);
  });

  it('uses the app-server agent-message stream by default', async () => {
    const calls: unknown[] = [];
    const streamGenerate = async function* (
      executable: string,
      request: Readonly<{
        prompt: string;
        model: string;
        reasoningEffort: string;
        workingDirectory?: string;
      }>,
      signal: AbortSignal,
    ) {
      calls.push({ executable, request, signal });
      yield { type: 'text' as const, text: '第一句。' };
      yield { type: 'text' as const, text: '第二句。' };
    };
    const adapter = createCodexCliAdapter({ executable: 'codex.exe', streamGenerate });
    const signal = new AbortController().signal;
    const output: string[] = [];

    for await (const delta of adapter.generate(
      {
        prompt: '课程提示词',
        model: 'gpt-5.6-sol',
        reasoningEffort: 'high',
        workingDirectory: 'D:/workspace/course',
      },
      signal,
    )) {
      output.push(delta.text);
    }

    expect(output).toEqual(['第一句。', '第二句。']);
    expect(calls).toEqual([
      {
        executable: 'codex.exe',
        request: {
          prompt: '课程提示词',
          model: 'gpt-5.6-sol',
          reasoningEffort: 'high',
          workingDirectory: 'D:/workspace/course',
        },
        signal,
      },
    ]);
  });

  it('falls back to codex exec only when app-server fails before its first delta', async () => {
    const streamGenerate = async function* () {
      throw new Error('app-server unavailable');
      yield { type: 'text' as const, text: 'unreachable' };
    };
    const fallbackGenerate = vi.fn(async function* () {
      yield { type: 'text' as const, text: 'fallback reply' };
    });
    const adapter = createCodexCliAdapter({
      executable: 'codex.exe',
      streamGenerate,
      fallbackGenerate,
    });
    const output: string[] = [];

    for await (const delta of adapter.generate(
      { prompt: 'prompt', model: 'model', reasoningEffort: 'high' },
      new AbortController().signal,
    )) {
      output.push(delta.text);
    }

    expect(output).toEqual(['fallback reply']);
    expect(fallbackGenerate).toHaveBeenCalledOnce();
  });

  it('does not start a duplicate fallback reply after app-server emitted content', async () => {
    const streamGenerate = async function* () {
      yield { type: 'text' as const, text: 'partial' };
      throw new Error('stream interrupted');
    };
    const fallbackGenerate = vi.fn(async function* () {
      yield { type: 'text' as const, text: 'duplicate' };
    });
    const adapter = createCodexCliAdapter({
      executable: 'codex.exe',
      streamGenerate,
      fallbackGenerate,
    });
    const consume = async () => {
      for await (const _delta of adapter.generate(
        { prompt: 'prompt', model: 'model', reasoningEffort: 'high' },
        new AbortController().signal,
      )) {
        expect(_delta.text).toBe('partial');
      }
    };

    await expect(consume()).rejects.toThrow('stream interrupted');
    expect(fallbackGenerate).not.toHaveBeenCalled();
  });

  it('rejects a model or reasoning effort that is absent from the current catalog', async () => {
    const run = vi.fn(async (_executable: string, arguments_: readonly string[]) => {
      if (arguments_[0] === '--version') {
        return { exitCode: 0, stdout: 'codex-cli 0.144.0-alpha.4\n', stderr: '' };
      }
      if (arguments_[0] === 'login') {
        return { exitCode: 0, stdout: 'Logged in using ChatGPT\n', stderr: '' };
      }
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          models: [
            {
              slug: 'gpt-5.6-sol',
              display_name: 'GPT-5.6-Sol',
              default_reasoning_level: 'low',
              supported_reasoning_levels: [{ effort: 'low' }, { effort: 'ultra' }],
              visibility: 'list',
            },
          ],
        }),
        stderr: '',
      };
    });
    const adapter = createCodexCliAdapter({ executable: 'codex.exe', run });

    await expect(adapter.validateSelection('gpt-5.6-sol', 'ultra')).resolves.toEqual({
      valid: true,
    });
    await expect(adapter.validateSelection('gpt-5.6-luna', 'medium')).resolves.toEqual({
      valid: false,
      message: 'model',
    });
    await expect(adapter.validateSelection('gpt-5.6-sol', 'unsupported')).resolves.toEqual({
      valid: false,
      message: 'reasoningEffort',
    });
  });
});
