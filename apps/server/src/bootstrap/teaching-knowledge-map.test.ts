import { describe, expect, it } from 'vitest';

import { projectTeachingKnowledgeMap } from './local-application/teaching-knowledge-map.js';

describe('projectTeachingKnowledgeMap', () => {
  it('places a frozen lesson in the active module through its stable semantic key', () => {
    const result = projectTeachingKnowledgeMap({
      course: {
        lessonIds: ['lesson_frozen', 'lesson_current', 'lesson_future'],
      },
      currentLesson: {
        id: 'lesson_frozen',
        semanticKey: 'lesson_reasoning_language',
        title: '对象、条件、结论与反例',
        objective: '建立数学推理框架',
      },
      activeLessons: [
        {
          id: 'lesson_frozen',
          semanticKey: 'lesson_reasoning_language',
          title: '对象、条件、结论与反例',
          objective: '建立数学推理框架',
        },
        {
          id: 'lesson_current',
          semanticKey: 'lesson_vectors_geometry',
          title: '向量：方向、位移与坐标',
          objective: '理解向量及其基本运算',
        },
        {
          id: 'lesson_future',
          semanticKey: 'lesson_system_consistency',
          title: '线性方程组的相容性与解的分类',
          objective: '理解解的分类',
        },
      ],
      outline: {
        disciplineTag: '数学',
      },
      candidate: {
        candidate: {
          courseGoals: ['建立完整的线性代数知识体系'],
          modules: [
            {
              id: 'module_reasoning_vectors',
              title: '模块一：推理基础与向量语言',
              lessonIds: ['lesson_reasoning_language', 'lesson_vectors_geometry'],
            },
            {
              id: 'module_linear_systems',
              title: '模块二：线性方程组与解集结构',
              lessonIds: ['lesson_system_consistency'],
            },
          ],
          lessons: [
            {
              id: 'lesson_reasoning_language',
              title: '对象、条件、结论与反例',
              objective: '建立数学推理框架',
            },
            {
              id: 'lesson_vectors_geometry',
              title: '向量：方向、位移与坐标',
              objective: '理解向量及其基本运算',
            },
            {
              id: 'lesson_system_consistency',
              title: '线性方程组的相容性与解的分类',
              objective: '理解解的分类',
            },
          ],
        },
      },
    });

    expect(result).toEqual({
      discipline: '数学',
      courseLessonIndex: 1,
      courseLessonCount: 3,
      currentModule: {
        id: 'module_reasoning_vectors',
        title: '模块一：推理基础与向量语言',
        lessonIndex: 1,
        lessonCount: 2,
        lessons: [
          {
            lessonId: 'lesson_frozen',
            title: '对象、条件、结论与反例',
            objective: '建立数学推理框架',
          },
          {
            lessonId: 'lesson_current',
            title: '向量：方向、位移与坐标',
            objective: '理解向量及其基本运算',
          },
        ],
        nextModuleTitle: '模块二：线性方程组与解集结构',
      },
      isFirstLessonInModule: true,
      isFirstLessonInCourse: true,
    });
  });

  it('falls back to one unique candidate title without guessing ambiguous matches', () => {
    const base = {
      course: { lessonIds: ['lesson_1'] },
      currentLesson: {
        id: 'lesson_1',
        semanticKey: 'legacy_key',
        title: '共同标题',
        objective: '当前目标',
      },
      activeLessons: [
        {
          id: 'lesson_1',
          semanticKey: 'legacy_key',
          title: '共同标题',
          objective: '当前目标',
        },
      ],
      outline: { disciplineTag: '数学' },
    };

    expect(
      projectTeachingKnowledgeMap({
        ...base,
        candidate: {
          candidate: {
            courseGoals: ['目标'],
            modules: [{ id: 'module_1', title: '模块一', lessonIds: ['candidate_1'] }],
            lessons: [{ id: 'candidate_1', title: '共同标题', objective: '目标' }],
          },
        },
      }),
    ).toMatchObject({ currentModule: { id: 'module_1' } });

    expect(
      projectTeachingKnowledgeMap({
        ...base,
        candidate: {
          candidate: {
            courseGoals: ['目标'],
            modules: [
              {
                id: 'module_1',
                title: '模块一',
                lessonIds: ['candidate_1', 'candidate_2'],
              },
            ],
            lessons: [
              { id: 'candidate_1', title: '共同标题', objective: '目标一' },
              { id: 'candidate_2', title: '共同标题', objective: '目标二' },
            ],
          },
        },
      }),
    ).toBeUndefined();
  });
});
