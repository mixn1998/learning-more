import { describe, expect, it, vi } from 'vitest';

import { createInMemoryCourseCreationRepositories } from '../ports/course-repositories.js';
import { reviseCourseOutline } from '../implementation/revise-course-outline.js';

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

async function seeded(status: 'active' | 'closed' = 'active') {
  const repositories = createInMemoryCourseCreationRepositories();
  await repositories.outlineVersions.save(
    tx,
    {
      id: 'outline_v1',
      courseId: 'course_01',
      sourceCandidateVersionId: 'candidate_v1',
      outlineMarkdown: '# v1',
      disciplineTag: '数学',
      topicTags: ['概率'],
      createdAt: '2026-07-13T00:00:00.000Z',
      resourceVersion: 0,
    },
    0,
  );
  await repositories.lessons.save(
    tx,
    {
      id: 'lesson_stable',
      courseId: 'course_01',
      outlineVersionId: 'outline_v1',
      semanticKey: 'probability-space',
      title: '概率空间',
      objective: '理解概率空间',
      coreKnowledgePoints: ['样本空间'],
      knowledgeStructure: {
        mainChain: [{ id: 'node_1', content: '样本空间' }],
        branches: [],
      },
      prerequisiteLessonIds: [],
      estimatedMinutes: 30,
      sourceRefs: ['source_topic'],
      resourceVersion: 0,
    },
    0,
  );
  await repositories.courses.save(
    tx,
    {
      id: 'course_01',
      title: '概率论',
      courseMode: 'standard',
      outlineVersionId: 'outline_v1',
      lessonIds: ['lesson_stable'],
      recommendedLessonId: 'lesson_stable',
      status,
      createdAt: '2026-07-13T00:00:00.000Z',
      resourceVersion: 0,
    },
    0,
  );
  return repositories;
}

const revision = {
  outlineMarkdown: '# v2',
  courseGoals: ['理解概率'],
  disciplineTag: '数学',
  topicTags: ['概率'],
  modules: [
    {
      id: 'module_probability',
      title: '概率基础',
      lessonIds: ['probability-space'],
    },
  ],
  lessons: [
    {
      id: 'probability-space',
      title: '概率空间',
      objective: '理解概率空间',
      coreKnowledgePoints: ['样本空间'],
      prerequisiteLessonIds: [],
      estimatedMinutes: 35,
      sourceRefs: ['source_topic'],
    },
  ],
};

describe('reviseCourseOutline', () => {
  it('publishes a new immutable outline while preserving an evidenced lesson id', async () => {
    const repositories = await seeded();
    const retireOutlineReferences = vi.fn().mockResolvedValue(undefined);

    await reviseCourseOutline(
      {
        adjustmentSessionId: 'adjustment_01',
        courseId: 'course_01',
        sourceCandidateVersionId: 'candidate_v2',
        newOutlineVersionId: 'outline_v2',
        expectedCourseVersion: 1,
        candidate: revision,
      },
      {
        repositories,
        unitOfWork,
        isLessonCompleted: async (id) => id === 'lesson_stable',
        liveCleanup: { retireOutlineReferences },
        now: () => new Date('2026-07-13T01:00:00.000Z'),
      },
    );

    await expect(repositories.courses.get('course_01')).resolves.toMatchObject({
      title: '概率论',
      outlineVersionId: 'outline_v2',
      lessonIds: ['lesson_stable'],
      resourceVersion: 2,
    });
    await expect(repositories.outlineVersions.get('outline_v1')).resolves.toMatchObject({
      outlineMarkdown: '# v1',
    });
    await expect(repositories.outlineVersions.get('outline_v2')).resolves.toMatchObject({
      outlineMarkdown: '# v2',
    });
    expect(retireOutlineReferences).toHaveBeenCalledWith(
      expect.objectContaining({
        courseId: 'course_01',
        retainedLessonIds: ['lesson_stable'],
        knownCourseLessonIds: ['lesson_stable'],
      }),
      tx,
    );
  });

  it('publishes a new lesson definition for an unchanged lesson that has not started', async () => {
    const repositories = await seeded();

    await reviseCourseOutline(
      {
        adjustmentSessionId: 'adjustment_without_evidence',
        courseId: 'course_01',
        sourceCandidateVersionId: 'candidate_v2',
        newOutlineVersionId: 'outline_v2',
        expectedCourseVersion: 1,
        candidate: revision,
      },
      {
        repositories,
        unitOfWork,
        isLessonCompleted: async () => false,
        now: () => new Date('2026-07-13T01:00:00.000Z'),
      },
    );

    const course = await repositories.courses.get('course_01');
    expect(course?.lessonIds).toHaveLength(1);
    expect(course?.lessonIds[0]).not.toBe('lesson_stable');
    await expect(repositories.lessons.get(course!.lessonIds[0]!)).resolves.toMatchObject({
      outlineVersionId: 'outline_v2',
      semanticKey: 'probability-space',
    });
  });

  it('keeps a regenerated unstarted lesson inside the new outline when its semantic key changes', async () => {
    const repositories = await seeded();

    await reviseCourseOutline(
      {
        adjustmentSessionId: 'adjustment_semantic_key_drift',
        courseId: 'course_01',
        sourceCandidateVersionId: 'candidate_v2',
        newOutlineVersionId: 'outline_v2',
        expectedCourseVersion: 1,
        candidate: {
          ...revision,
          modules: [
            {
              ...revision.modules[0]!,
              lessonIds: ['probability-space-renamed-by-model'],
            },
          ],
          lessons: [
            {
              ...revision.lessons[0]!,
              id: 'probability-space-renamed-by-model',
            },
          ],
        },
      },
      {
        repositories,
        unitOfWork,
        isLessonCompleted: async () => false,
        now: () => new Date('2026-07-13T01:00:00.000Z'),
      },
    );

    const course = await repositories.courses.get('course_01');
    expect(course?.lessonIds).toHaveLength(1);
    expect(course?.lessonIds[0]).not.toBe('lesson_stable');
    await expect(repositories.lessons.get(course!.lessonIds[0]!)).resolves.toMatchObject({
      outlineVersionId: 'outline_v2',
      semanticKey: 'probability-space-renamed-by-model',
    });
  });

  it('rejects revision after course closure', async () => {
    const repositories = await seeded('closed');

    await expect(
      reviseCourseOutline(
        {
          adjustmentSessionId: 'adjustment_closed',
          courseId: 'course_01',
          sourceCandidateVersionId: 'candidate_v2',
          newOutlineVersionId: 'outline_v2',
          expectedCourseVersion: 1,
          candidate: revision,
        },
        { repositories, unitOfWork, isLessonCompleted: async () => false, now: () => new Date() },
      ),
    ).rejects.toMatchObject({ code: 'course_closed' });
  });

  it('retains an omitted completed lesson with its original id and frozen definition', async () => {
    const repositories = await seeded();
    const addedLesson = {
      id: 'conditional-probability',
      title: '条件概率',
      objective: '理解条件概率',
      coreKnowledgePoints: ['条件概率'],
      prerequisiteLessonIds: ['probability-space'],
      estimatedMinutes: 40,
      sourceRefs: ['source_topic'],
    };

    await reviseCourseOutline(
      {
        adjustmentSessionId: 'adjustment_omits_completed',
        courseId: 'course_01',
        sourceCandidateVersionId: 'candidate_v2',
        newOutlineVersionId: 'outline_v2',
        expectedCourseVersion: 1,
        candidate: {
          ...revision,
          modules: [{ id: 'module_next', title: '后续', lessonIds: [addedLesson.id] }],
          lessons: [addedLesson],
        },
      },
      {
        repositories,
        unitOfWork,
        isLessonCompleted: async (id) => id === 'lesson_stable',
        now: () => new Date('2026-07-13T01:00:00.000Z'),
      },
    );

    const course = await repositories.courses.get('course_01');
    expect(course?.lessonIds[0]).toBe('lesson_stable');
    expect(course?.lessonIds).toHaveLength(2);
    await expect(repositories.lessons.get('lesson_stable')).resolves.toMatchObject({
      title: '概率空间',
      objective: '理解概率空间',
      coreKnowledgePoints: ['样本空间'],
    });
  });

  it('keeps an in-progress lesson bound to its old immutable definition', async () => {
    const repositories = await seeded();

    await reviseCourseOutline(
      {
        adjustmentSessionId: 'adjustment_keeps_learning_lesson',
        courseId: 'course_01',
        sourceCandidateVersionId: 'candidate_v2',
        newOutlineVersionId: 'outline_v2',
        expectedCourseVersion: 1,
        candidate: {
          ...revision,
          lessons: [
            {
              ...revision.lessons[0]!,
              title: '模型尝试改写的课节',
              objective: '模型尝试改写的目标',
              coreKnowledgePoints: ['模型改写内容'],
            },
          ],
        },
      },
      {
        repositories,
        unitOfWork,
        getLessonProgress: async (id) => (id === 'lesson_stable' ? 'in_progress' : 'not_started'),
        now: () => new Date('2026-07-13T01:00:00.000Z'),
      },
    );

    await expect(repositories.courses.get('course_01')).resolves.toMatchObject({
      lessonIds: ['lesson_stable'],
    });
    await expect(repositories.lessons.get('lesson_stable')).resolves.toMatchObject({
      outlineVersionId: 'outline_v1',
      title: '概率空间',
      coreKnowledgePoints: ['样本空间'],
    });
  });

  it('ignores model rewrites of a completed semantic key and keeps the frozen lesson definition', async () => {
    const repositories = await seeded();

    await reviseCourseOutline(
      {
        adjustmentSessionId: 'adjustment_rewrites_completed',
        courseId: 'course_01',
        sourceCandidateVersionId: 'candidate_v2',
        newOutlineVersionId: 'outline_v2',
        expectedCourseVersion: 1,
        candidate: {
          ...revision,
          lessons: [
            {
              ...revision.lessons[0]!,
              title: '模型改写的概率课',
              objective: '模型改写的目标',
              coreKnowledgePoints: ['模型改写内容'],
            },
          ],
        },
      },
      {
        repositories,
        unitOfWork,
        isLessonCompleted: async (id) => id === 'lesson_stable',
        now: () => new Date('2026-07-13T01:00:00.000Z'),
      },
    );

    await expect(repositories.courses.get('course_01')).resolves.toMatchObject({
      lessonIds: ['lesson_stable'],
    });
    await expect(repositories.lessons.get('lesson_stable')).resolves.toMatchObject({
      title: '概率空间',
      objective: '理解概率空间',
      coreKnowledgePoints: ['样本空间'],
    });
  });

  it('does not resurrect a historical started lesson outside the current outline', async () => {
    const repositories = await seeded();
    await repositories.lessons.save(
      tx,
      {
        id: 'lesson_historical',
        courseId: 'course_01',
        outlineVersionId: 'outline_legacy',
        semanticKey: 'historical-only',
        title: 'Historical lesson',
        objective: 'Preserve its historical learning record',
        coreKnowledgePoints: ['Historical knowledge'],
        knowledgeStructure: {
          mainChain: [{ id: 'node_historical', content: 'Historical knowledge' }],
          branches: [],
        },
        prerequisiteLessonIds: [],
        estimatedMinutes: 20,
        sourceRefs: ['source_history'],
        resourceVersion: 0,
      },
      0,
    );

    await reviseCourseOutline(
      {
        adjustmentSessionId: 'adjustment_excludes_historical',
        courseId: 'course_01',
        sourceCandidateVersionId: 'candidate_v2',
        newOutlineVersionId: 'outline_v2',
        expectedCourseVersion: 1,
        candidate: revision,
        currentOutlineSemanticKeys: ['probability-space'],
      },
      {
        repositories,
        unitOfWork,
        getLessonProgress: async (id) =>
          id === 'lesson_historical' ? 'in_progress' : 'not_started',
        now: () => new Date('2026-07-13T01:00:00.000Z'),
      },
    );

    const course = await repositories.courses.get('course_01');
    expect(course?.lessonIds).toHaveLength(1);
    expect(course?.lessonIds).not.toContain('lesson_historical');
    await expect(repositories.lessons.get('lesson_historical')).resolves.toMatchObject({
      outlineVersionId: 'outline_legacy',
      semanticKey: 'historical-only',
    });
  });

  it('rejects the commit when a lesson starts after revision planning', async () => {
    const repositories = await seeded();
    let progressReadCount = 0;

    await expect(
      reviseCourseOutline(
        {
          adjustmentSessionId: 'adjustment_racing_lesson_start',
          courseId: 'course_01',
          sourceCandidateVersionId: 'candidate_v2',
          newOutlineVersionId: 'outline_v2',
          expectedCourseVersion: 1,
          candidate: revision,
        },
        {
          repositories,
          unitOfWork,
          getLessonProgress: async () => {
            progressReadCount += 1;
            return progressReadCount === 1 ? 'not_started' : 'in_progress';
          },
          now: () => new Date('2026-07-13T01:00:00.000Z'),
        },
      ),
    ).rejects.toMatchObject({ code: 'source_snapshot_changed' });

    await expect(repositories.courses.get('course_01')).resolves.toMatchObject({
      outlineVersionId: 'outline_v1',
      lessonIds: ['lesson_stable'],
    });
    await expect(repositories.outlineVersions.get('outline_v2')).resolves.toBeUndefined();
  });
});
