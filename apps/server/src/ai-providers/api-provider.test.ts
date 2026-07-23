import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApiProvider } from './api-provider.js';

afterEach(() => vi.unstubAllGlobals());

describe('real API-compatible provider', () => {
  it('passes model and prompt and parses streamed SSE deltas', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hel"}}]}\n\n'),
        );
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n',
          ),
        );
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = createApiProvider({ id: 'api' });
    const output: string[] = [];
    for await (const delta of provider.generate(
      {
        taskId: 'task-1',
        prompt: 'hello',
        baseUrl: 'https://example.test/v1',
        model: 'gpt-test',
        apiKey: 'secret',
      },
      new AbortController().signal,
    ))
      output.push(delta.text);
    expect(output).toEqual(['hel', 'lo']);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer secret' }),
        body: JSON.stringify({
          model: 'gpt-test',
          messages: [{ role: 'user', content: 'hello' }],
          stream: true,
        }),
      }),
    );
  });
});
