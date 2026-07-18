import { describe, expect, it, vi } from 'vitest';

import { createCodexCliAdapter } from './codex-cli-adapter.js';
import { createCliProvider } from './cli-provider.js';

describe('real CLI provider', () => {
  it('uses the live adapter catalog for health, selection, and generation', async () => {
    const longPrompt = 'Explain the topic. '.repeat(2_500);
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
    const generate = vi.fn(async function* (
      _executable: string,
      arguments_: readonly string[],
      options: Readonly<{ stdin?: string }>,
    ) {
      expect(arguments_.at(-1)).toBe('-');
      expect(arguments_).not.toContain(longPrompt);
      expect(options.stdin).toBeDefined();
      expect(arguments_).not.toContain(options.stdin);
      yield { type: 'text' as const, text: arguments_.join(' ') };
    });
    const adapter = createCodexCliAdapter({ executable: 'codex.exe', run, generate });
    const provider = createCliProvider({
      id: 'codex-cli',
      executable: 'codex.exe',
      adapter,
    });

    await expect(provider.healthCheck()).resolves.toEqual({ status: 'healthy' });
    await expect(provider.listModels?.({ refresh: true })).resolves.toEqual([
      {
        id: 'gpt-5.6-sol',
        displayName: 'GPT-5.6-Sol',
        defaultReasoningEffort: 'low',
        supportedReasoningEfforts: ['low', 'ultra'],
      },
    ]);
    await expect(
      provider.validateConfig(
        { model: 'gpt-5.6-sol', reasoningEffort: 'ultra' },
        async () => undefined,
      ),
    ).resolves.toEqual({ valid: true });
    await expect(
      provider.validateConfig(
        { model: 'gpt-5.6-luna', reasoningEffort: 'medium' },
        async () => undefined,
      ),
    ).resolves.toEqual({ valid: false, message: 'model' });

    await provider.configure?.(
      { model: 'gpt-5.6-sol', reasoningEffort: 'ultra' },
      async () => undefined,
    );
    const output: string[] = [];
    for await (const delta of provider.generate(
      { taskId: 'task-cli', prompt: longPrompt },
      new AbortController().signal,
    )) {
      output.push(delta.text);
    }
    expect(output.join(' ')).toContain('--model gpt-5.6-sol');
    expect(output.join(' ')).toContain('model_reasoning_effort="ultra"');

    const routedOutput: string[] = [];
    for await (const delta of provider.generate(
      {
        taskId: 'task-cli-routed',
        prompt: 'Respond quickly.',
        reasoningEffort: 'low',
      },
      new AbortController().signal,
    )) {
      routedOutput.push(delta.text);
    }
    expect(routedOutput.join(' ')).toContain('model_reasoning_effort="low"');
  });
});
