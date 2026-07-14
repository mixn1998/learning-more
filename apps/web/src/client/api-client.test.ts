// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { apiRequest } from './api-client.js';

describe('typed API client', () => {
  it('owns command identity, CSRF, and If-Match headers without changing them', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { etag: '"4"' },
      }),
    );
    vi.stubGlobal('fetch', fetcher);
    await apiRequest('/api/v1/example', {
      method: 'POST',
      body: { value: 1 },
      schema: { parse: (value) => value },
      command: { pageInstanceId: 'page_01', idempotencyKey: 'idem_01' },
      resourceVersion: 3,
    });
    expect(fetcher).toHaveBeenCalledWith(
      '/api/v1/example',
      expect.objectContaining({
        headers: expect.objectContaining({
          'idempotency-key': 'idem_01',
          'x-page-instance-id': 'page_01',
          'x-csrf-token': 'development-csrf',
          'if-match': '"3"',
        }),
      }),
    );
    vi.unstubAllGlobals();
  });

  it('sends CSRF protection for unsafe non-command endpoints', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);

    await apiRequest('/api/v1/ai-runtime/reconnect', {
      method: 'POST',
      body: {},
      schema: { parse: (value) => value },
    });

    expect(fetcher).toHaveBeenCalledWith(
      '/api/v1/ai-runtime/reconnect',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-csrf-token': 'development-csrf' }),
      }),
    );
    vi.unstubAllGlobals();
  });
});
