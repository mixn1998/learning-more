import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { TeachingObservation } from '@learning-more/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { createLocalFileEvidenceRepositories } from '../../persistence/profile-evidence-repositories.js';
import { createLocalFileReasoningBehaviorRepository } from '../../persistence/reasoning-behavior-repositories.js';
import type { LocalApplicationOptions } from './contracts.js';
import { createLocalEventFactsRuntime } from './event-facts-runtime.js';
import { createLocalFoundation } from './foundation.js';
import { createLocalGenerationRuntime } from './generation-runtime.js';
import { createLocalProfileRuntime } from './profile-runtime.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createRuntime(directory: string) {
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
  return {
    foundation,
    profile: createLocalProfileRuntime({
      dataRoot: foundation.dataRoot,
      unitOfWork: foundation.unitOfWork,
      now: foundation.now,
      generation,
      events,
    }),
  };
}

function reasoningObservation(index: number): TeachingObservation {
  return {
    observationId: `observation_${index}`,
    schemaVersion: 1,
    lessonId: `lesson_${index}`,
    sessionId: `session_${index}`,
    turnSequence: 1,
    sourceMessageIds: [`message_reasoning_${index}`],
    sourceSnapshotHash: `${index}`.repeat(64),
    scope: {
      alignment: 'direct',
      relationRefs: [`knowledge:kp_${index}`],
      rationale: 'Direct learning behavior.',
    },
    entries: [
      {
        entryId: `entry_${index}`,
        kind: 'learner_reasoning_behavior',
        summary: 'The learner compares changing conditions before revising a judgment.',
        knowledgePointRefs: [`knowledge:kp_${index}`],
        sourceRefs: [`message:message_reasoning_${index}`],
        explicitness: 'ai_observed',
        elicitation: 'elicited',
        resolvesEntryRefs: [],
        qualityFlags: ['direct', 'complete'],
      },
    ],
    observerVersion: 'teaching-observer@1',
    observedAt: `2026-07-${10 + index}T07:59:00.000Z`,
    status: 'active',
  };
}

function reviewCheckpoint(index: number) {
  return {
    checkpointId: `profile:review_${index}:lesson_review_finalized`,
    checkpointKind: 'lesson_review_finalized',
    sourceType: 'review',
    sourceGroupId: `review:review:${index}`,
    courseId: `course_${index}`,
    courseMode: 'standard',
    dependentSourceGroupIds: [`lesson:lesson_${index}:session:session_${index}`],
    courseContext: `Course ${index}`,
    lessonContext: `Lesson ${index}`,
    completeness: 'complete',
    sources: [
      {
        sourceRef: `review:review_${index}`,
        sourceGroupId: `review:review:${index}`,
        sourceType: 'review',
        role: 'review',
        excerpt: '# Review\n\nThe learner compares changing conditions before revising a judgment.',
        observedAt: `2026-07-${10 + index}T08:00:00.000Z`,
      },
    ],
  };
}

describe('local profile runtime', () => {
  it('recovers the complete reasoning path from raw episodes through portrait evidence', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-profile-review-flow-'));
    roots.push(directory);
    const { foundation, profile } = await createRuntime(directory);

    for (const index of [1, 2]) {
      await profile.reasoningBehaviorSink.captureFromObservation({
        courseId: `course_${index}`,
        courseMode: 'standard',
        observation: reasoningObservation(index),
      });
      const checkpoint = reviewCheckpoint(index);
      await profile.checkpointSink.capture(checkpoint);
      await profile.checkpointSink.capture(checkpoint);
    }

    const reasoningRepository = createLocalFileReasoningBehaviorRepository(foundation.dataRoot);
    const episodes = [];
    for await (const episode of reasoningRepository.listEpisodes()) episodes.push(episode);
    const sessionDimensions = episodes.filter(
      (episode) => episode.extractorVersion === 'review-session-dimension@1',
    );
    expect(sessionDimensions).toHaveLength(2);
    expect(sessionDimensions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: 'session_1',
          sourceRefs: expect.arrayContaining(['review:review_1', 'message:message_reasoning_1']),
        }),
        expect.objectContaining({
          sessionId: 'session_2',
          sourceRefs: expect.arrayContaining(['review:review_2', 'message:message_reasoning_2']),
        }),
      ]),
    );

    await profile.recoverReasoningAnalysis();
    let analysis;
    for await (const candidate of reasoningRepository.listAnalyses()) {
      if (
        candidate.snapshot.analyzerVersion === 'reasoning-global-analyzer@2' &&
        (analysis === undefined || candidate.snapshot.createdAt > analysis.snapshot.createdAt)
      ) {
        analysis = candidate;
      }
    }
    expect(analysis).toMatchObject({
      snapshot: {
        analyzerVersion: 'reasoning-global-analyzer@2',
        status: 'usable',
        independentSourceGroupCount: 2,
      },
    });
    const repositories = createLocalFileEvidenceRepositories(foundation.dataRoot);
    const evidence = [];
    for await (const candidate of repositories.evidence.list()) evidence.push(candidate);
    expect(
      evidence.filter((candidate) =>
        candidate.extractorVersion.endsWith(':reasoning-session-dimension@2'),
      ),
    ).not.toHaveLength(0);
    const receipts = [];
    for await (const receipt of repositories.checkpoints.list()) {
      if (receipt.extractorVersion === 'profile-evidence@1') receipts.push(receipt);
    }
    expect(receipts).toHaveLength(2);
    expect(receipts.every((receipt) => receipt.resourceVersion === 1)).toBe(true);

    const portrait = (await profile.requestPortraitRefresh({
      idempotencyKey: 'portrait_from_review_sessions',
      tokenBudget: 2_000,
    })) as { state?: string; claims: unknown[] };
    expect(profile.getProjectionStatus()).toBe('ready');
    expect(portrait).toMatchObject({ state: 'completed' });
    expect(portrait.claims).toHaveLength(1);
    await expect(profile.portraitRoutes.getCurrent()).resolves.toMatchObject({
      reasoningBehaviorAnalysis: {
        snapshot: { analyzerVersion: 'reasoning-global-analyzer@2', status: 'usable' },
      },
    });

    const projected = evidence.find((candidate) =>
      candidate.extractorVersion.endsWith(':reasoning-session-dimension@2'),
    );
    expect(projected).toBeDefined();
    const currentProjected = await repositories.evidence.get(projected!.evidenceId);
    expect(currentProjected).toBeDefined();
    await foundation.unitOfWork.execute({ transactionId: 'tx_seed_legacy_summary' }, async (tx) => {
      await repositories.evidence.save(
        tx,
        {
          ...currentProjected!,
          summary: '全局抽象维度：所有独立会话过去都显示同一句定义。',
        },
        currentProjected!.resourceVersion,
      );
    });
    const visibleEvidence = await profile.profileRoutes.listEvidence();
    expect(
      visibleEvidence.find((candidate) => candidate.evidenceId === projected!.evidenceId),
    ).toMatchObject({
      summary: expect.stringContaining(
        'The learner compares changing conditions before revising a judgment',
      ),
    });
  });

  it('allows an explicit portrait refresh after an earlier profile checkpoint failed', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-profile-runtime-'));
    roots.push(directory);
    const { profile } = await createRuntime(directory);
    void profile.checkpointSink.capture(null);

    await expect(
      profile.requestPortraitRefresh({
        idempotencyKey: 'portrait_after_failure',
        tokenBudget: 2_000,
      }),
    ).resolves.toMatchObject({ state: 'completed', claims: [] });
  });
});
