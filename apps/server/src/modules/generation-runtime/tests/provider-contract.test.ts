import { describe, expect, it } from 'vitest';

import { createApiProvider } from '../../../ai-providers/api-provider.js';
import { createCliProvider } from '../../../ai-providers/cli-provider.js';
import { createMockProvider } from '../../../ai-providers/mock-provider.js';
import type { AiProvider, ProviderDelta } from '../../../ai-providers/provider.js';

async function collect(provider: AiProvider): Promise<ProviderDelta[]> {
  const deltas: ProviderDelta[] = [];
  for await (const delta of provider.generate(
    { prompt: 'hello', taskId: 'task_01' },
    new AbortController().signal,
  )) {
    deltas.push(delta);
  }
  return deltas;
}

describe.each([
  ['Mock', () => createMockProvider({ id: 'mock', script: [{ type: 'text', text: 'hello' }] })],
  [
    'API',
    () =>
      createApiProvider({
        id: 'api',
        async *transport() {
          yield { type: 'text' as const, text: 'hello' };
        },
      }),
  ],
  [
    'CLI',
    () =>
      createCliProvider({
        id: 'cli',
        executable: 'provider.exe',
        async *runner(_executable, _arguments, options) {
          expect(options.shell).toBe(false);
          yield { type: 'text' as const, text: 'hello' };
        },
      }),
  ],
] as const)('%s Provider contract', (_name, factory) => {
  it('describes, validates, checks health, and streams normalized deltas', async () => {
    const provider = factory();

    expect(provider.describe().id).toBeTruthy();
    await expect(provider.validateConfig({}, async () => undefined)).resolves.toMatchObject({
      valid: true,
    });
    await expect(provider.healthCheck()).resolves.toMatchObject({ status: 'healthy' });
    await expect(collect(provider)).resolves.toEqual([{ type: 'text', text: 'hello' }]);
  });
});
