import { describe, expect, it, vi } from 'vitest';

import type { LocalCourseRuntime } from './local-application/course-runtime.js';
import { createLearningTeachingContext } from './local-application/learning-teaching-context.js';

describe('createLearningTeachingContext', () => {
  it('uses the active candidate for course goals, module position, and future-lesson labels', async () => {
    const frozenLesson = {
      id: 'lesson_frozen',
      courseId: 'course_1',
      outlineVersionId: 'outline_old',
      semanticKey: 'lesson_reasoning',
      title: '推理语言',
      objective: '建立推理基础',
      coreKnowledgePoints: ['定义'],
      knowledgeStructure: {
        mainChain: [{ id: 'n1', content: '定义' }],
        branches: [],
      },
      prerequisiteLessonIds: [],
      estimatedMinutes: 30,
      sourceRefs: [],
      resourceVersion: 1,
    };
    const currentLesson = {
      ...frozenLesson,
      id: 'lesson_current',
      outlineVersionId: 'outline_active',
      semanticKey: 'lesson_vectors',
      title: '向量语言',
      objective: '理解向量',
      prerequisiteLessonIds: ['lesson_frozen'],
    };
    const futureLesson = {
      ...frozenLesson,
      id: 'lesson_future',
      outlineVersionId: 'outline_active',
      semanticKey: 'lesson_systems',
      title: '方程组',
      objective: '理解共同约束',
    };
    const access = {
      getCourse: vi.fn().mockResolvedValue({
        id: 'course_1',
        title: '线性代数',
        courseMode: 'standard',
        outlineVersionId: 'outline_active',
        lessonIds: ['lesson_frozen', 'lesson_current', 'lesson_future'],
        status: 'active',
        createdAt: '2026-07-27T00:00:00.000Z',
        resourceVersion: 1,
      }),
      getLesson: vi.fn().mockResolvedValue(currentLesson),
      getOutlineVersion: vi.fn().mockResolvedValue({
        id: 'outline_active',
        courseId: 'course_1',
        sourceCandidateVersionId: 'candidate_active',
        outlineMarkdown: '# 线性代数',
        disciplineTag: '数学',
        topicTags: ['线性代数'],
        createdAt: '2026-07-27T00:00:00.000Z',
        resourceVersion: 1,
      }),
      getOutlineCandidate: vi.fn().mockResolvedValue({
        id: 'candidate_active',
        candidate: {
          courseGoals: ['建立线性代数知识体系'],
          disciplineTag: '数学',
          topicTags: ['线性代数'],
          outlineMarkdown: '# 线性代数',
          modules: [
            {
              id: 'module_1',
              title: '模块一：推理与向量',
              lessonIds: ['lesson_reasoning', 'lesson_vectors'],
            },
            {
              id: 'module_2',
              title: '模块二：线性方程组',
              lessonIds: ['lesson_systems'],
            },
          ],
          lessons: [
            {
              id: 'lesson_reasoning',
              title: '推理语言',
              objective: '建立推理基础',
              knowledgeStructure: {
                mainChain: [{ id: 'n1', content: '定义' }],
                branches: [],
              },
              coreKnowledgePoints: ['定义'],
              prerequisiteLessonIds: [],
              estimatedMinutes: 30,
              sourceRefs: ['source_topic'],
            },
            {
              id: 'lesson_vectors',
              title: '向量语言',
              objective: '理解向量',
              knowledgeStructure: {
                mainChain: [{ id: 'n1', content: '向量' }],
                branches: [],
              },
              coreKnowledgePoints: ['向量'],
              prerequisiteLessonIds: ['lesson_reasoning'],
              estimatedMinutes: 30,
              sourceRefs: ['source_topic'],
            },
            {
              id: 'lesson_systems',
              title: '方程组',
              objective: '理解共同约束',
              knowledgeStructure: {
                mainChain: [{ id: 'n1', content: '约束' }],
                branches: [],
              },
              coreKnowledgePoints: ['约束'],
              prerequisiteLessonIds: ['lesson_vectors'],
              estimatedMinutes: 30,
              sourceRefs: ['source_topic'],
            },
          ],
        },
      }),
      getTeachingWeightMetadata: vi.fn().mockResolvedValue(undefined),
      async *listLessons() {
        yield frozenLesson;
        yield currentLesson;
        yield futureLesson;
      },
    } as unknown as LocalCourseRuntime['access'];
    const sources = createLearningTeachingContext({
      course: access,
      getLearningRecord: vi.fn(),
      listMessages: vi.fn(),
      artifactStore: {
        read: vi.fn(),
        readDraft: vi.fn(),
      },
    });

    const context = await sources.getCourseAndLesson({
      courseId: 'course_1',
      lessonId: 'lesson_current',
    });

    expect(context.course.goals).toEqual(['建立线性代数知识体系']);
    expect(context.course.knowledgeMap).toMatchObject({
      discipline: '数学',
      courseLessonIndex: 2,
      courseLessonCount: 3,
      currentModule: {
        id: 'module_1',
        title: '模块一：推理与向量',
        lessonIndex: 2,
        lessonCount: 2,
        nextModuleTitle: '模块二：线性方程组',
      },
      isFirstLessonInModule: false,
      isFirstLessonInCourse: false,
    });
    expect(context.course.lessonMap.map((lesson) => lesson.relation)).toEqual([
      'prerequisite',
      'current',
      'future',
    ]);
  });
});
