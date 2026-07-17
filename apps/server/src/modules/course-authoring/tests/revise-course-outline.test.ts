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
        hasLearningEvidence: async (id) => id === 'lesson_stable',
        liveCleanup: { retireOutlineReferences },
        now: () => new Date('2026-07-13T01:00:00.000Z'),
      },
    );

    await expect(repositories.courses.get('course_01')).resolves.toMatchObject({
      title: 'v2',
      outlineVersionId: 'outline_v2',
      lessonIds: ['lesson_stable'],
      resourceVersion: 2,
    });
    await expect(repositories.outlineVersions.get('outline_v1')).resolves.toMatchObject({
      outlineMarkdown: '# v1',
    });
    await expect(repositories.outlineVersions.get('outline_v2')).resolves.toBeDefined();
    expect(retireOutlineReferences).toHaveBeenCalledWith(
      expect.objectContaining({
        courseId: 'course_01',
        retainedLessonIds: ['lesson_stable'],
        knownCourseLessonIds: ['lesson_stable'],
      }),
      tx,
    );
  });

  it('preserves an unchanged lesson id even before the lesson has learning evidence', async () => {
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
        hasLearningEvidence: async () => false,
        now: () => new Date('2026-07-13T01:00:00.000Z'),
      },
    );

    await expect(repositories.courses.get('course_01')).resolves.toMatchObject({
      lessonIds: ['lesson_stable'],
    });
  });

  it('maps an unchanged lesson back to its existing id when the generated semantic key drifts', async () => {
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
        hasLearningEvidence: async () => false,
        now: () => new Date('2026-07-13T01:00:00.000Z'),
      },
    );

    await expect(repositories.courses.get('course_01')).resolves.toMatchObject({
      lessonIds: ['lesson_stable'],
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
        { repositories, unitOfWork, hasLearningEvidence: async () => false, now: () => new Date() },
      ),
    ).rejects.toMatchObject({ code: 'course_closed' });
  });
});
