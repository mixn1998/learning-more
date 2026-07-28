import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { registerProfileRoutes } from './profile.js';

describe('profile routes', () => {
  it('exposes the retained user-profile reasoning analysis chain', async () => {
    const refreshReasoningAnalysis = vi.fn().mockResolvedValue({
      snapshot: { snapshotId: 'reasoning_snapshot_1', status: 'usable' },
      dimensions: [],
      classifications: [],
    });
    const app = Fastify();
    await registerProfileRoutes(app, {
      getGlobalProfile: async () => ({}),
      listReasoningEpisodes: async () => [{ episodeId: 'reasoning_episode_1' }],
      refreshReasoningAnalysis,
      getReasoningAnalysis: async (snapshotId) =>
        snapshotId === 'reasoning_snapshot_1'
          ? { snapshot: { snapshotId, status: 'usable' } }
          : undefined,
    });

    const episodes = await app.inject({
      method: 'GET',
      url: '/api/v1/profile/reasoning-behavior-episodes',
    });
    expect(episodes.json()).toEqual({ entries: [{ episodeId: 'reasoning_episode_1' }] });

    const analysis = await app.inject({
      method: 'POST',
      url: '/api/v1/profile/reasoning-behavior-analyses',
      payload: {
        courseIds: ['course_1'],
        lessonIds: ['lesson_1'],
        courseModes: ['case_study'],
        elicitations: ['spontaneous'],
      },
    });
    expect(analysis.statusCode).toBe(201);
    expect(refreshReasoningAnalysis).toHaveBeenCalledWith({
      courseIds: ['course_1'],
      lessonIds: ['lesson_1'],
      courseModes: ['case_study'],
      elicitations: ['spontaneous'],
    });

    await expect(
      app.inject({
        method: 'GET',
        url: '/api/v1/profile/reasoning-behavior-analyses/reasoning_snapshot_1',
      }),
    ).resolves.toMatchObject({ statusCode: 200 });
    await app.close();
  });
});
