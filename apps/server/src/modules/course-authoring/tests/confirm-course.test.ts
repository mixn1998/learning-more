import { describe, expect, it } from 'vitest';

import { createInMemoryCourseAuthoringRepositories } from '../../../persistence/course-authoring-repositories.js';
import { createInMemoryCourseCreationRepositories } from '../ports/course-repositories.js';
import { confirmCourse } from '../implementation/confirm-course.js';
import { createOutlineSession, decide, evolveAll } from '../model/outline-session.js';

const tx = {
  stageJson: async () => undefined,
  stageText: async () => undefined,
  deleteOnCommit: async () => undefined,
};
const unitOfWork = {
  async execute<T>(_request: unknown, work: (context: typeof tx) => Promise<T>) {
    return work(tx);
  },
};

async function fixture() {
  const authoring = createInMemoryCourseAuthoringRepositories();
  const courses = createInMemoryCourseCreationRepositories();
  let session = createOutlineSession({
    outlineSessionId: 'session_01',
    courseMode: 'standard',
    topic: '概率论',
  });
  session = evolveAll(
    session,
    decide(session, { type: 'skipAssessment', assessmentArtifactId: 'a1' }),
  );
  session = evolveAll(
    session,
    decide(session, { type: 'requestCandidate', generationTaskId: 'task_1' }),
  );
  session = evolveAll(
    session,
    decide(session, {
      type: 'candidateGenerated',
      generationTaskId: 'task_1',
      candidateVersionId: 'candidate_v1',
    }),
  );
  await authoring.outlineSessions.save(
    tx,
    { session, resourceVersion: 0, candidateCommandReceipts: {} },
    0,
  );
  await authoring.candidateVersions.save(
    tx,
    {
      id: 'candidate_v1',
      outlineSessionId: 'session_01',
      generationTaskId: 'task_1',
      draftArtifactRef: 'draft_v1',
      createdAt: '2026-07-13T00:00:00.000Z',
      resourceVersion: 0,
      candidate: {
        outlineMarkdown: '# 概率论',
        courseGoals: ['理解概率'],
        disciplineTag: '数学',
        topicTags: ['概率'],
        lessons: [
          {
            id: 'probability-space',
            title: '概率空间',
            objective: '理解概率空间',
            coreKnowledgePoints: ['样本空间'],
            prerequisiteLessonIds: [],
            estimatedMinutes: 30,
            sourceRefs: ['source_topic'],
          },
          {
            id: 'random-variable',
            title: '随机变量',
            objective: '理解随机变量',
            coreKnowledgePoints: ['随机变量'],
            prerequisiteLessonIds: ['probability-space'],
            estimatedMinutes: 45,
            sourceRefs: ['source_topic'],
          },
        ],
      },
    },
    0,
  );
  return { authoring, courses };
}

describe('confirmCourse', () => {
  it('atomically creates the fixed outline, Course, stable lessons, and confirms the session', async () => {
    const { authoring, courses } = await fixture();
    const enqueued: string[] = [];

    const result = await confirmCourse(
      {
        type: 'courseAuthoring.confirmCourse',
        outlineSessionId: 'session_01',
        outlineVersionId: 'candidate_v1',
        courseId: 'course_01',
        metadata: { idempotencyKey: 'confirm_01', requestedAt: '2026-07-13T00:01:00.000Z' },
      },
      {
        authoring,
        courses,
        unitOfWork,
        outbox: {
          enqueue: async (_tx, events) => {
            enqueued.push(...events.map((event) => event.type));
          },
          dispatchPending: async () => 0,
        },
        nextEventId: (() => {
          let n = 0;
          return () => `event_${++n}`;
        })(),
        now: () => new Date('2026-07-13T00:01:00.000Z'),
      },
    );

    expect(result).toEqual({ courseId: 'course_01', repeated: false });
    await expect(courses.courses.get('course_01')).resolves.toMatchObject({
      outlineVersionId: expect.stringContaining('outline_'),
      lessonIds: [expect.stringContaining('lesson_'), expect.stringContaining('lesson_')],
    });
    const lessons = [];
    for await (const lesson of courses.lessons.listByCourse('course_01')) lessons.push(lesson);
    expect(lessons.map((lesson) => lesson.semanticKey)).toEqual([
      'probability-space',
      'random-variable',
    ]);
    expect(enqueued).toEqual(['CourseCreated', 'OutlineVersionConfirmed', 'LessonsDefined']);
    await expect(authoring.outlineSessions.get('session_01')).resolves.toMatchObject({
      session: { state: 'confirmed', confirmedCourseId: 'course_01' },
    });

    await expect(
      confirmCourse(
        {
          type: 'courseAuthoring.confirmCourse',
          outlineSessionId: 'session_01',
          outlineVersionId: 'candidate_v1',
          courseId: 'different_course',
          metadata: { idempotencyKey: 'confirm_01', requestedAt: '2026-07-13T00:01:00.000Z' },
        },
        { authoring, courses, unitOfWork, nextEventId: () => 'unused', now: () => new Date() },
      ),
    ).resolves.toEqual({ courseId: 'course_01', repeated: true });
  });

  it('rejects a candidate superseded by the session latest version', async () => {
    const { authoring, courses } = await fixture();
    const current = (await authoring.outlineSessions.get('session_01'))!;
    await authoring.outlineSessions.save(
      tx,
      {
        ...current,
        session: {
          ...current.session,
          latestCandidateVersionId: 'candidate_v2',
          candidateVersionIds: [...current.session.candidateVersionIds, 'candidate_v2'],
        },
      },
      current.resourceVersion,
    );

    await expect(
      confirmCourse(
        {
          type: 'courseAuthoring.confirmCourse',
          outlineSessionId: 'session_01',
          outlineVersionId: 'candidate_v1',
          courseId: 'course_01',
          metadata: { idempotencyKey: 'confirm_stale', requestedAt: '2026-07-13T00:01:00.000Z' },
        },
        { authoring, courses, unitOfWork, nextEventId: () => 'unused', now: () => new Date() },
      ),
    ).rejects.toMatchObject({ code: 'candidate_stale' });
  });
});
