import { describe, expect, it } from 'vitest';

import {
  CandidateModelResponseSchema,
  CandidateOutlineMetadataSchema,
  CancelCandidateGenerationResponseSchema,
  COURSE_MODES,
  CreateOutlineSessionBodySchema,
  GenerationAcceptedResponseSchema,
  OutlineSessionViewResponseSchema,
  RequestCandidateGenerationBodySchema,
} from './course-authoring.js';

describe('CourseAuthoring transport contracts', () => {
  it('freezes the nine approved course modes', () => {
    expect(COURSE_MODES).toEqual([
      'standard',
      'brainstorm',
      'argument_clash',
      'case_study',
      'business_insight',
      'process_decomposition',
      'decision_analysis',
      'cross_explore',
      'reading_seminar',
    ]);
  });

  it('rejects legacy product dimensions and arbitrary generation input', () => {
    expect(
      CreateOutlineSessionBodySchema.safeParse({
        topic: 'probability theory',
        courseMode: 'standard',
        learnerStage: 'beginner',
      }).success,
    ).toBe(false);
    expect(
      RequestCandidateGenerationBodySchema.safeParse({ prompt: 'private prompt' }).success,
    ).toBe(false);
  });

  it('keeps the candidate output contract separate from authoring context fields', () => {
    const outline = {
      courseGoals: ['理解概率模型'],
      disciplineTag: '数学',
      topicTags: ['概率'],
      modules: [{ id: 'module_foundation', title: '基础', lessonIds: ['lesson_space'] }],
      lessons: [
        {
          id: 'lesson_space',
          title: '概率空间',
          objective: '理解样本空间',
          coreKnowledgePoints: ['样本空间'],
          prerequisiteLessonIds: [],
          estimatedMinutes: 30,
          sourceRefs: ['source_topic'],
        },
      ],
    };
    expect(CandidateOutlineMetadataSchema.safeParse(outline).success).toBe(true);
    expect(
      CandidateModelResponseSchema.parse({
        protocol: 'learning-more.candidate',
        schemaVersion: 1,
        outline,
      }),
    ).toMatchObject({ outline });
    expect(
      CandidateModelResponseSchema.safeParse({
        schemaVersion: 2,
        outlineSessionId: 'session_internal',
        courseMode: 'standard',
        topic: '概率论',
        title: '概率论课程',
        sourceRefs: ['source_topic'],
      }).success,
    ).toBe(false);
  });

  it('upgrades legacy knowledge points into a ledger-compatible main chain', () => {
    const parsed = CandidateOutlineMetadataSchema.parse({
      courseGoals: ['理解概率模型'],
      disciplineTag: '数学',
      topicTags: ['概率'],
      modules: [{ id: 'module_foundation', title: '基础', lessonIds: ['lesson_space'] }],
      lessons: [
        {
          id: 'lesson_space',
          title: '概率空间',
          objective: '理解样本空间',
          coreKnowledgePoints: ['样本空间', '事件'],
          prerequisiteLessonIds: [],
          estimatedMinutes: 30,
          sourceRefs: ['source_topic'],
        },
      ],
    });

    expect(parsed.lessons[0]).toMatchObject({
      coreKnowledgePoints: ['样本空间', '事件'],
      knowledgeStructure: {
        mainChain: [
          {
            id: 'node_1',
            content: '样本空间',
            relationToNext: '为下一步理解提供基础',
          },
          { id: 'node_2', content: '事件' },
        ],
        branches: [],
      },
    });
  });

  it('rejects broken main-chain relations and unattached branches', () => {
    const base = {
      courseGoals: ['理解概率模型'],
      disciplineTag: '数学',
      topicTags: ['概率'],
      modules: [{ id: 'module_foundation', title: '基础', lessonIds: ['lesson_space'] }],
      lessons: [
        {
          id: 'lesson_space',
          title: '概率空间',
          objective: '理解样本空间',
          knowledgeStructure: {
            mainChain: [
              { id: 'point_1', content: '样本空间' },
              { id: 'point_2', content: '事件', relationToNext: '错误的终点关系' },
            ],
            branches: [
              {
                id: 'branch_1',
                attachedTo: 'missing_point',
                content: '边界情况',
                relation: '限定适用范围',
              },
            ],
          },
          prerequisiteLessonIds: [],
          estimatedMinutes: 30,
          sourceRefs: ['source_topic'],
        },
      ],
    };

    const result = CandidateOutlineMetadataSchema.safeParse(base);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        'knowledge_chain_relation_required',
        'knowledge_chain_terminal_relation_forbidden',
        'knowledge_chain_branch_anchor_unknown',
      ]),
    );
  });

  it('accepts a richer set of descriptive topic tags', () => {
    const result = CandidateOutlineMetadataSchema.safeParse({
      courseGoals: ['理解 AI token 与货币的关系'],
      disciplineTag: '跨学科',
      topicTags: [
        'AI token',
        '算力经济',
        '货币',
        'AI 智能体',
        '机器间交易',
        '平台治理',
        '未来推演',
      ],
      modules: [{ id: 'module_1', title: '基础', lessonIds: ['lesson_1'] }],
      lessons: [
        {
          id: 'lesson_1',
          title: '概念基础',
          objective: '建立概念地图',
          coreKnowledgePoints: ['token', '货币'],
          prerequisiteLessonIds: [],
          estimatedMinutes: 30,
          sourceRefs: ['source_topic'],
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('transports the recoverable candidate failure category without exposing compiler details', () => {
    expect(
      GenerationAcceptedResponseSchema.parse({
        taskId: 'task_01',
        state: 'failed_recoverable',
        failureCode: 'candidate_invalid',
        resourceVersion: 3,
      }),
    ).toMatchObject({ failureCode: 'candidate_invalid' });
  });

  it('transports a cancelled candidate generation as a retryable session state', () => {
    expect(
      CancelCandidateGenerationResponseSchema.parse({
        outlineSessionId: 'session_01',
        state: 'assessment-ready',
        resourceVersion: 4,
      }),
    ).toMatchObject({ state: 'assessment-ready' });
  });

  it('exposes the active generation task so a client can reconnect after navigation', () => {
    expect(
      OutlineSessionViewResponseSchema.parse({
        outlineSessionId: 'session_01',
        resourceVersion: 2,
        state: 'generating-candidates',
        topic: 'probability',
        courseMode: 'standard',
        candidateVersionIds: [],
        completedAssessmentRounds: 3,
        canGenerateCandidate: false,
        messages: [],
        generationTaskId: 'task_01',
      }),
    ).toMatchObject({ generationTaskId: 'task_01' });
  });
});
