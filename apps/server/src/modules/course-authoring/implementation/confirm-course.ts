import { createHash } from 'node:crypto';

import type { CommandMetadata, LearningEventEnvelope } from '@learning-more/contracts';

import type { CourseAuthoringRepositories } from '../../../persistence/course-authoring-repositories.js';
import type { Outbox } from '../../../persistence/outbox.js';
import type { UnitOfWork } from '../../../persistence/unit-of-work.js';
import type { CourseCreationRepositories } from '../ports/course-repositories.js';
import { CourseAuthoringError } from '../model/errors.js';
import { decide, evolveAll } from '../model/outline-session.js';
import {
  resolveNextLessonRecommendation,
  type NextLessonRecommender,
} from '../../next-lesson/interface.js';

export interface ConfirmCourseCommand {
  readonly type: 'courseAuthoring.confirmCourse';
  readonly outlineSessionId: string;
  readonly outlineVersionId: string;
  readonly courseId: string;
  readonly metadata: CommandMetadata;
}

function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 32)}`;
}

export async function confirmCourse(
  command: ConfirmCourseCommand,
  dependencies: {
    readonly authoring: CourseAuthoringRepositories;
    readonly courses: CourseCreationRepositories;
    readonly unitOfWork: UnitOfWork;
    readonly outbox?: Outbox;
    readonly nextLessonRecommender?: NextLessonRecommender;
    readonly nextEventId: () => string;
    readonly now: () => Date;
  },
): Promise<{ courseId: string; repeated: boolean }> {
  const record = await dependencies.authoring.outlineSessions.get(command.outlineSessionId);
  if (record === undefined) throw new Error('OUTLINE_SESSION_NOT_FOUND');
  if (record.session.state === 'confirmed' && record.session.confirmedCourseId !== undefined) {
    return { courseId: record.session.confirmedCourseId, repeated: true };
  }
  if (
    record.session.state !== 'candidate-ready' ||
    record.session.latestCandidateVersionId !== command.outlineVersionId
  ) {
    throw new CourseAuthoringError('candidate_stale');
  }
  const candidate = await dependencies.authoring.candidateVersions.get(command.outlineVersionId);
  if (candidate === undefined || candidate.outlineSessionId !== command.outlineSessionId) {
    throw new CourseAuthoringError('candidate_stale');
  }
  const createdAt = dependencies.now().toISOString();
  const outlineVersionId = stableId('outline', candidate.id);
  const lessonIds = candidate.candidate.lessons.map((lesson) =>
    stableId('lesson', command.courseId, lesson.id),
  );
  const lessonIdBySemanticKey = new Map(
    candidate.candidate.lessons.map((lesson, index) => [lesson.id, lessonIds[index]!]),
  );
  const recommendation = await resolveNextLessonRecommendation({
    ...(dependencies.nextLessonRecommender === undefined
      ? {}
      : { recommender: dependencies.nextLessonRecommender }),
    now: dependencies.now,
    input: {
      courseId: command.courseId,
      trigger: 'course-confirmed',
      candidates: candidate.candidate.lessons.map((lesson) => ({
        semanticKey: lesson.id,
        title: lesson.title,
        objective: lesson.objective,
        prerequisiteSemanticKeys: lesson.prerequisiteLessonIds,
        estimatedMinutes: lesson.estimatedMinutes,
        progress: 'not_started',
        courseStatus: 'active',
        available: true,
        activeSession: false,
        evidenceRefs: lesson.sourceRefs,
      })),
      completedSemanticKeys: [],
    },
  });
  const recommendedLessonId =
    recommendation === undefined
      ? undefined
      : lessonIdBySemanticKey.get(recommendation.semanticKey);
  if (recommendation !== undefined && recommendedLessonId === undefined) {
    throw new Error('next_lesson_recommendation_invalid');
  }
  const course = {
    id: command.courseId,
    title: record.session.topic,
    courseMode: record.session.courseMode,
    outlineVersionId,
    lessonIds,
    ...(recommendedLessonId === undefined ? {} : { recommendedLessonId }),
    ...(recommendation === undefined
      ? {}
      : {
          nextLessonRecommendation: {
            versionId: recommendation.versionId,
            recommendedLessonId: recommendedLessonId!,
            rankedLessonIds: recommendation.rankedSemanticKeys
              .map((key) => lessonIdBySemanticKey.get(key))
              .filter((id): id is string => id !== undefined),
            rationale: recommendation.rationale,
            evidenceRefs: recommendation.evidenceRefs,
            confidence: recommendation.confidence,
            expiresAt: recommendation.expiresAt,
            sourceSnapshotHash: recommendation.sourceSnapshotHash,
            status: recommendation.status,
            warnings: recommendation.warnings,
          },
        }),
    status: 'active' as const,
    createdAt,
    resourceVersion: 0,
  };
  let session = evolveAll(
    record.session,
    decide(record.session, { type: 'confirmCandidate', candidateVersionId: candidate.id }),
  );
  session = evolveAll(
    session,
    decide(session, { type: 'completeConfirmation', courseId: command.courseId }),
  );
  const events: LearningEventEnvelope[] = [
    {
      id: dependencies.nextEventId(),
      schema_version: 1,
      type: 'CourseCreated',
      occurred_at: createdAt,
      recorded_at: createdAt,
      source: 'CourseAuthoring',
      target_refs: { courseId: command.courseId },
      payload: { outlineVersionId },
      idempotency_key: command.metadata.idempotencyKey,
      correlation_id: command.metadata.idempotencyKey,
    },
    {
      id: dependencies.nextEventId(),
      schema_version: 1,
      type: 'OutlineVersionConfirmed',
      occurred_at: createdAt,
      recorded_at: createdAt,
      source: 'CourseAuthoring',
      target_refs: { courseId: command.courseId, outlineVersionId },
      payload: { sourceCandidateVersionId: candidate.id },
      idempotency_key: command.metadata.idempotencyKey,
      correlation_id: command.metadata.idempotencyKey,
    },
    {
      id: dependencies.nextEventId(),
      schema_version: 1,
      type: 'LessonsDefined',
      occurred_at: createdAt,
      recorded_at: createdAt,
      source: 'CourseAuthoring',
      target_refs: { courseId: command.courseId, outlineVersionId },
      payload: { lessonIds },
      idempotency_key: command.metadata.idempotencyKey,
      correlation_id: command.metadata.idempotencyKey,
    },
  ];
  await dependencies.unitOfWork.execute(
    { transactionId: `tx_confirm_${command.courseId}` },
    async (tx) => {
      await dependencies.courses.outlineVersions.save(
        tx,
        {
          id: outlineVersionId,
          courseId: command.courseId,
          sourceCandidateVersionId: candidate.id,
          outlineMarkdown: candidate.candidate.outlineMarkdown,
          disciplineTag: candidate.candidate.disciplineTag,
          topicTags: candidate.candidate.topicTags,
          createdAt,
          resourceVersion: 0,
        },
        0,
      );
      for (const [index, lesson] of candidate.candidate.lessons.entries()) {
        await dependencies.courses.lessons.save(
          tx,
          {
            id: lessonIds[index]!,
            courseId: command.courseId,
            outlineVersionId,
            semanticKey: lesson.id,
            title: lesson.title,
            objective: lesson.objective,
            coreKnowledgePoints: lesson.coreKnowledgePoints,
            prerequisiteLessonIds: lesson.prerequisiteLessonIds.map((id) =>
              lessonIdBySemanticKey.get(id)!,
            ),
            estimatedMinutes: lesson.estimatedMinutes,
            sourceRefs: lesson.sourceRefs,
            resourceVersion: 0,
          },
          0,
        );
      }
      await dependencies.courses.courses.save(tx, course, 0);
      await dependencies.authoring.outlineSessions.save(
        tx,
        { ...record, session },
        record.resourceVersion,
      );
      await dependencies.outbox?.enqueue(tx, events);
    },
  );
  return { courseId: command.courseId, repeated: false };
}
