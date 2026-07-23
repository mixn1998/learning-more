import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { sendConditionalJson } from './conditional-get.js';

describe('conditional GET', () => {
  it('returns an empty 304 response when the current ETag is supplied', async () => {
    const app = Fastify();
    app.get('/snapshot', (request, reply) =>
      sendConditionalJson(request, reply, {
        etag: 'revision:7',
        value: { expensive: true },
        projectionStatus: 'current',
      }),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/snapshot',
      headers: { 'if-none-match': 'W/"other", "revision:7"' },
    });

    expect(response.statusCode).toBe(304);
    expect(response.body).toBe('');
    expect(response.headers.etag).toBe('"revision:7"');
    expect(response.headers['cache-control']).toBe('private, no-cache');
    expect(response.headers['x-projection-status']).toBe('current');
  });
});
