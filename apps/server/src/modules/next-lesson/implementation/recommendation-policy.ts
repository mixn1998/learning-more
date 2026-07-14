import { createHash } from 'node:crypto';

import type { NextLessonRecommender } from '../interface.js';
import type { NextLessonRecommendationVersion } from '../model/next-lesson-recommendation.js';
import { eligibleNextLessons } from './eligible-lessons.js';

type RecommendationInput = Parameters<NextLessonRecommender['recommend']>[0];

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export async function resolveNextLessonRecommendation(options: {
  recommender?: NextLessonRecommender;
  input: RecommendationInput;
  now?: () => Date;
}): Promise<NextLessonRecommendationVersion | undefined> {
  const eligible = eligibleNextLessons(
    options.input.candidates,
    options.input.completedSemanticKeys,
  );
  if (eligible.length === 0) return undefined;
  if (options.recommender !== undefined) {
    try {
      return await options.recommender.recommend(options.input);
    } catch {
      const previous = options.input.previousRecommendation;
      const now = options.now?.() ?? new Date();
      if (
        previous !== undefined &&
        eligible.some((candidate) => candidate.semanticKey === previous.semanticKey) &&
        Date.parse(previous.expiresAt) > now.getTime()
      ) {
        return {
          ...previous,
          warnings: [...previous.warnings, 'ai_unavailable_preserved'],
        };
      }
    }
  }

  const serialized = JSON.stringify({
    courseId: options.input.courseId,
    trigger: options.input.trigger,
    completedSemanticKeys: options.input.completedSemanticKeys,
    eligible,
  });
  const sourceSnapshotHash = sha256(serialized);
  const now = options.now?.() ?? new Date();
  const first = eligible[0]!;
  return {
    versionId: `next_lesson_fallback_${sourceSnapshotHash.slice(0, 15)}`,
    semanticKey: first.semanticKey,
    rankedSemanticKeys: eligible.map((candidate) => candidate.semanticKey),
    rationale: 'AI 暂时不可用；当前建议按已满足依赖的课程顺序生成，你仍可自行选择其他可学课节。',
    evidenceRefs: [],
    confidence: 0,
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1_000).toISOString(),
    sourceSnapshotHash,
    status: 'fallback',
    warnings: ['ai_unavailable_fallback'],
  };
}
