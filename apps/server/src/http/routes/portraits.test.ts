import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { registerProfileRoutes } from './profile.js';
import { registerPortraitRoutes } from './portraits.js';

describe('profile and portrait HTTP contracts', () => {
  it('returns deterministic profile evidence pages without private source refs or data keys', async () => {
    const app = Fastify();
    await registerProfileRoutes(app, {
      getGlobalProfile: async () => ({
        profileSchemaVersion: 1,
        sufficiency: { status: 'limited' },
      }),
      listEvidence: async () => [
        {
          evidenceId: 'evidence_b',
          summary: 'Second neutral observation.',
          sourceGroup: 'outcome',
          sourceGroupId: 'lesson:02',
          dependentSourceGroupIds: [],
          sourceRefs: ['fact:private_b'],
          dataKeys: ['completion.actual_seconds'],
          observedAt: '2026-07-11T00:00:00.000Z',
          strength: { score: 2, rationale: 'Committed outcome.' },
          polarity: 'supporting',
          status: 'active',
        },
        {
          evidenceId: 'evidence_a',
          summary: 'First neutral observation.',
          sourceGroup: 'behavior',
          sourceGroupId: 'lesson:01',
          dependentSourceGroupIds: [],
          sourceRefs: ['message:private_a'],
          dataKeys: ['lesson.lifecycle_status'],
          observedAt: '2026-07-10T00:00:00.000Z',
          strength: { score: 1, rationale: 'Bounded behavior.' },
          polarity: 'limiting',
          status: 'active',
        },
      ],
    });
    const profile = await app.inject({ method: 'GET', url: '/api/v1/profile-facts' });
    expect(profile.statusCode).toBe(200);
    expect(profile.json()).toMatchObject({ profileSchemaVersion: 1 });
    const evidence = await app.inject({
      method: 'GET',
      url: '/api/v1/portrait-evidence?pageSize=1',
    });
    expect(evidence.statusCode).toBe(200);
    expect(evidence.json()).toMatchObject({
      entries: [expect.objectContaining({ evidenceId: 'evidence_a' })],
      nextCursor: 'evidence_a',
    });
    expect(evidence.body).not.toContain('private_a');
    expect(evidence.body).not.toContain('dataKeys');
    await app.close();
  });

  it('requires idempotency for refresh and exposes current plus immutable old versions', async () => {
    const requestRefresh = vi.fn().mockResolvedValue({
      versionId: 'portrait_02',
      state: 'generating',
      resourceVersion: 2,
    });
    const app = Fastify();
    await registerPortraitRoutes(app, {
      requestRefresh,
      getCurrent: async () => ({ versionId: 'portrait_02', state: 'completed' }),
      getVersion: async (versionId) => ({ versionId, state: 'completed' }),
      nextCorrelationId: () => 'correlation_01',
    });
    expect(
      (await app.inject({ method: 'POST', url: '/api/v1/portrait-refreshes', payload: {} }))
        .statusCode,
    ).toBe(400);
    const refresh = await app.inject({
      method: 'POST',
      url: '/api/v1/portrait-refreshes',
      headers: { 'idempotency-key': 'refresh_01' },
      payload: { tokenBudget: 2_000 },
    });
    expect(refresh.statusCode).toBe(202);
    expect(requestRefresh).toHaveBeenCalledWith({
      idempotencyKey: 'refresh_01',
      tokenBudget: 2_000,
    });
    expect((await app.inject({ method: 'GET', url: '/api/v1/portrait' })).statusCode).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/portraits/portrait_01' })).json(),
    ).toMatchObject({ versionId: 'portrait_01' });
    await app.close();
  });
});
