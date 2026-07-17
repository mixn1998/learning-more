import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { LocalApplicationOptions } from './contracts.js';
import { createLocalEventFactsRuntime } from './event-facts-runtime.js';
import { createLocalFoundation } from './foundation.js';
import { createLocalGenerationRuntime } from './generation-runtime.js';
import { createLocalProfileRuntime } from './profile-runtime.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('local profile runtime', () => {
  it('builds a portrait from Review-produced dimensions in two independent learning sessions', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-profile-review-flow-'));
    roots.push(directory);
    const applicationOptions: LocalApplicationOptions = {
      dataRoot: directory,
      csrfToken: 'test-csrf',
    };
    const foundation = await createLocalFoundation(applicationOptions);
    const generation = await createLocalGenerationRuntime({
      dataRoot: foundation.dataRoot,
      unitOfWork: foundation.unitOfWork,
      now: foundation.now,
      applicationOptions,
    });
    const events = await createLocalEventFactsRuntime({
      dataRoot: foundation.dataRoot,
      unitOfWork: foundation.unitOfWork,
    });
    const profile = createLocalProfileRuntime({
      dataRoot: foundation.dataRoot,
      unitOfWork: foundation.unitOfWork,
      now: foundation.now,
      generation,
      events,
    });

    for (const index of [1, 2]) {
      await profile.checkpointSink.capture({
        checkpointId: `profile:review_${index}:lesson_review_finalized`,
        checkpointKind: 'lesson_review_finalized',
        sourceType: 'review',
        sourceGroupId: `review:review:${index}`,
        courseId: `course_${index}`,
        courseMode: 'standard',
        dependentSourceGroupIds: [`lesson:lesson_${index}:session:session_${index}`],
        courseContext: `课程 ${index}`,
        lessonContext: `课时 ${index}｜理解条件变化`,
        completeness: 'complete',
        sources: [
          {
            sourceRef: `review:review_${index}`,
            sourceGroupId: `review:review:${index}`,
            sourceType: 'review',
            role: 'review',
            excerpt: '# 课时 Review\n\n学习者会比较条件变化并据此修正判断。',
            observedAt: `2026-07-${10 + index}T08:00:00.000Z`,
          },
        ],
      });
    }

    const portrait = (await profile.requestPortraitRefresh({
      idempotencyKey: 'portrait_from_review_sessions',
      tokenBudget: 2_000,
    })) as { state?: string; claims: unknown[] };

    expect(profile.getProjectionStatus()).toBe('ready');
    expect(portrait).toMatchObject({ state: 'completed' });
    expect(portrait.claims).toHaveLength(1);
  });

  it('allows an explicit portrait refresh after an earlier profile checkpoint failed', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-profile-runtime-'));
    roots.push(directory);
    const applicationOptions: LocalApplicationOptions = {
      dataRoot: directory,
      csrfToken: 'test-csrf',
    };
    const foundation = await createLocalFoundation(applicationOptions);
    const generation = await createLocalGenerationRuntime({
      dataRoot: foundation.dataRoot,
      unitOfWork: foundation.unitOfWork,
      now: foundation.now,
      applicationOptions,
    });
    const events = await createLocalEventFactsRuntime({
      dataRoot: foundation.dataRoot,
      unitOfWork: foundation.unitOfWork,
    });
    const profile = createLocalProfileRuntime({
      dataRoot: foundation.dataRoot,
      unitOfWork: foundation.unitOfWork,
      now: foundation.now,
      generation,
      events,
    });
    void profile.checkpointSink.capture(null);

    await expect(
      profile.requestPortraitRefresh({
        idempotencyKey: 'portrait_after_failure',
        tokenBudget: 2_000,
      }),
    ).resolves.toMatchObject({ state: 'completed', claims: [] });
  });
});
