import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { registerHomeRoutes } from './home.js';

describe('Home HTTP route', () => {
  it('returns one authoritative dashboard snapshot', async () => {
    const app = Fastify();
    await registerHomeRoutes(app, {
      getHome: async () => ({
        etag: 'home:1',
        value: {
          generatedAt: '2026-07-13T00:00:00.000Z',
          draftSessions: [
            {
              outlineSessionId: 'session_01',
              topic: 'Probability',
              courseMode: 'standard',
              state: 'candidate-ready',
              resourceVersion: 2,
            },
          ],
          courses: [],
          lessons: [],
          schedule: [],
        },
      }),
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/home' });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      draftSessions: [{ outlineSessionId: 'session_01' }],
    });
    const unchanged = await app.inject({
      method: 'GET',
      url: '/api/v1/home',
      headers: { 'if-none-match': response.headers.etag! },
    });
    expect(unchanged.statusCode).toBe(304);
    expect(unchanged.body).toBe('');
  });
});
