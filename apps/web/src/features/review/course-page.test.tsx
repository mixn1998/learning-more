// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LearningClient } from '../../client/learning-client.js';
import type { CourseAuthoringClient } from '../../client/course-authoring-client.js';
import { CoursePage } from './course-page.js';

afterEach(cleanup);

describe('CoursePage', () => {
  it('loads the bound historical outline so a frozen lesson keeps its original module', async () => {
    const course = {
      courseId: 'course_revised',
      title: 'Revised course',
      status: 'active' as const,
      courseMode: 'standard' as const,
      outlineVersionId: 'outline_current',
      lessonIds: ['lesson_frozen', 'lesson_current'],
      lessons: [
        {
          lessonId: 'lesson_frozen',
          outlineVersionId: 'outline_original',
          title: 'Frozen lesson',
          objective: 'Keep the completed lesson structure',
          coreKnowledgePoints: [],
          prerequisiteLessonIds: [],
          estimatedMinutes: 20,
        },
        {
          lessonId: 'lesson_current',
          outlineVersionId: 'outline_current',
          title: 'Current lesson',
          objective: 'Use the revised outline',
          coreKnowledgePoints: [],
          prerequisiteLessonIds: [],
          estimatedMinutes: 20,
        },
      ],
      outlineMarkdown: '# Revised course\n\n## Current module\n\n### Current lesson',
      outlineVersions: [
        {
          outlineVersionId: 'outline_original',
          sourceCandidateVersionId: 'candidate_original',
          createdAt: '2026-07-20T00:00:00.000Z',
          current: false,
        },
        {
          outlineVersionId: 'outline_current',
          sourceCandidateVersionId: 'candidate_current',
          createdAt: '2026-07-21T00:00:00.000Z',
          current: true,
        },
      ],
      resourceVersion: 2,
    };
    const getOutlineVersion = vi.fn(async (_courseId: string, outlineVersionId: string) => ({
      courseId: 'course_revised',
      outlineVersionId,
      sourceCandidateVersionId:
        outlineVersionId === 'outline_original' ? 'candidate_original' : 'candidate_current',
      outlineMarkdown:
        outlineVersionId === 'outline_original'
          ? '# Original course\n\n## Original module one\n\n### Frozen lesson'
          : course.outlineMarkdown,
      disciplineTag: 'general',
      topicTags: [],
      createdAt:
        outlineVersionId === 'outline_original'
          ? '2026-07-20T00:00:00.000Z'
          : '2026-07-21T00:00:00.000Z',
      resourceVersion: 1,
      current: outlineVersionId === 'outline_current',
    }));

    render(
      <CoursePage
        courseId="course_revised"
        client={
          {
            getCourseReview: vi.fn().mockResolvedValue(undefined),
            getLessonState: vi.fn(async (lessonId: string) => ({
              lessonId,
              progress: lessonId === 'lesson_frozen' ? 'completed' : 'not_started',
              resourceVersion: 1,
            })),
          } as unknown as LearningClient
        }
        authoringClient={
          {
            getCourse: vi.fn().mockResolvedValue(course),
            getOutlineVersion,
          } as unknown as CourseAuthoringClient
        }
      />,
    );

    expect(await screen.findByText('Original module one')).toBeInTheDocument();
    expect(screen.getByText('Current module')).toBeInTheDocument();
    expect(screen.queryByText('未分组课程')).not.toBeInTheDocument();
    expect(getOutlineVersion).toHaveBeenCalledWith('course_revised', 'outline_original');
  });

  it('saves a course-page title edit and updates the visible canonical name', async () => {
    const course = {
      courseId: 'course_rename',
      title: 'Original course title',
      status: 'active' as const,
      courseMode: 'standard' as const,
      outlineVersionId: 'outline_01',
      lessonIds: [],
      outlineMarkdown: '# Markdown title',
      resourceVersion: 4,
    };
    const renameCourseTitle = vi.fn().mockResolvedValue({
      courseId: 'course_rename',
      title: 'User course title',
      resourceVersion: 5,
    });
    render(
      <CoursePage
        courseId="course_rename"
        client={
          {
            getCourseReview: vi.fn().mockResolvedValue(undefined),
          } as unknown as LearningClient
        }
        authoringClient={
          {
            getCourse: vi.fn().mockResolvedValue(course),
            getOutlineVersion: vi.fn().mockResolvedValue({
              courseId: 'course_rename',
              outlineVersionId: 'outline_01',
              sourceCandidateVersionId: 'candidate_01',
              outlineMarkdown: '# Markdown title',
              disciplineTag: 'general',
              topicTags: [],
              createdAt: '2026-07-22T00:00:00.000Z',
              resourceVersion: 1,
              current: true,
            }),
            renameCourseTitle,
          } as unknown as CourseAuthoringClient
        }
      />,
    );

    expect(
      await screen.findByRole('heading', { name: 'Original course title' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '修改课程名称' }));
    fireEvent.change(screen.getByRole('textbox', { name: '课程名称' }), {
      target: { value: 'User course title' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByRole('heading', { name: 'User course title' })).toBeInTheDocument();
    expect(renameCourseTitle).toHaveBeenCalledWith(
      expect.objectContaining({
        courseId: 'course_rename',
        title: 'User course title',
        resourceVersion: 4,
      }),
    );
  });

  it('[EQ-COURSE-01] closes an eligible course and exposes its immutable topic summary only from the course archive', async () => {
    const course = {
      courseId: 'course_01',
      title: 'Probability',
      status: 'active' as const,
      courseMode: 'standard' as const,
      outlineVersionId: 'outline_01',
      lessonIds: ['lesson_01'],
      lessons: [
        {
          lessonId: 'lesson_01',
          outlineVersionId: 'outline_01',
          title: 'Evidence',
          objective: 'Use evidence',
          coreKnowledgePoints: ['Probability'],
          prerequisiteLessonIds: [],
          estimatedMinutes: 20,
        },
      ],
      resourceVersion: 1,
    };
    const closeCourse = vi.fn().mockResolvedValue({
      state: 'review-finalized',
      artifactRef: 'course_review_course_01',
      markdown:
        '# 主题总结\n## 核心知识线索\nProbability\n## 总体学习表现\nEvidence based\n## 推荐扩展课程\nBayesian inference',
      document: {
        schemaVersion: 1,
        kind: 'course-final',
        title: '概率判断：从直觉到证据',
        knowledgeThreads: [
          { title: '条件改变参照系', markdown: '先确定当前样本空间，再比较概率。' },
          { title: '证据更新判断', markdown: '新证据会改变不同解释的相对可信度。' },
        ],
        strengths: [{ title: '稳定优势', markdown: '能够主动检查前提。' }],
        development: [{ title: '继续发展', markdown: '寻找反例后再收敛。' }],
        boundaries: [{ title: '因果与相关', markdown: '下一步区分预测证据与因果证据。' }],
        extensions: [{ title: '贝叶斯推断', markdown: '继续研究证据如何更新判断。' }],
      },
      resourceVersion: 2,
    });
    render(
      <CoursePage
        courseId="course_01"
        client={
          {
            getCourse: vi
              .fn()
              .mockResolvedValueOnce(course)
              .mockResolvedValue({ ...course, status: 'closed', resourceVersion: 2 }),
            getLessonState: vi.fn().mockResolvedValue({
              lessonId: 'lesson_01',
              progress: 'completed',
              resourceVersion: 1,
            }),
            deleteCourse: vi.fn(),
            closeCourse,
            getCourseReview: vi.fn().mockResolvedValue(undefined),
          } as unknown as LearningClient
        }
      />,
    );

    await screen.findAllByText('Probability');
    fireEvent.click(screen.getByRole('button', { name: '关闭课程并生成总结' }));
    const close = screen.getByRole('button', { name: '确认关闭课程' });
    fireEvent.click(close);
    fireEvent.click(close);

    expect(await screen.findByRole('heading', { name: '主题核心知识线索' })).toBeInTheDocument();
    expect(screen.getByText('条件改变参照系')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '总体学习表现' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '推荐扩展课程' })).toBeInTheDocument();
    expect(document.querySelector('.course-review-content')).toHaveAttribute('data-ai-surface');
    expect(closeCourse).toHaveBeenCalledTimes(1);
    expect(document.body).not.toHaveTextContent('course_review_course_01');
  });

  it('[EQ-COURSE-06] confirms the irreversible cascade once and delegates successful home navigation', async () => {
    let resolveDelete!: (value: { courseId: string; deletedAt: string }) => void;
    const deleteCourse = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveDelete = resolve;
      }),
    );
    const onDeleted = vi.fn();
    render(
      <CoursePage
        courseId="course_01"
        onDeleted={onDeleted}
        client={
          {
            getCourse: vi.fn().mockResolvedValue({
              courseId: 'course_01',
              title: 'Probability',
              status: 'active',
              courseMode: 'standard',
              outlineVersionId: 'outline_01',
              lessonIds: ['lesson_01'],
              resourceVersion: 4,
            }),
            deleteCourse,
            closeCourse: vi.fn(),
            getCourseReview: vi.fn().mockResolvedValue(undefined),
          } as unknown as LearningClient
        }
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: '删除课程' }));
    const dialog = screen.getByRole('dialog', { name: '永久删除课程？' });
    expect(dialog).toHaveTextContent('课程档案');
    expect(dialog).toHaveTextContent('学习记录');
    expect(dialog).toHaveTextContent('Review');
    expect(dialog).toHaveTextContent('排期');
    expect(dialog).toHaveTextContent('历史统计');
    expect(screen.queryByRole('textbox', { name: /课程名称/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(deleteCourse).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '删除课程' }));
    const permanentDelete = screen.getByRole('button', { name: '永久删除' });
    fireEvent.click(permanentDelete);
    fireEvent.click(permanentDelete);
    expect(permanentDelete).toBeDisabled();
    expect(deleteCourse).toHaveBeenCalledTimes(1);
    expect(deleteCourse).toHaveBeenCalledWith('course_01', 4);

    resolveDelete({
      courseId: 'course_01',
      deletedAt: '2026-07-13T08:01:00.000Z',
    });
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('课程及关联记录已永久删除'));
  });

  it('keeps the archive and dialog available when permanent deletion fails', async () => {
    const deleteCourse = vi.fn().mockRejectedValue({ code: 'storage_corrupted' });
    render(
      <CoursePage
        courseId="course_01"
        client={
          {
            getCourse: vi.fn().mockResolvedValue({
              courseId: 'course_01',
              title: 'Probability',
              status: 'closed',
              courseMode: 'standard',
              outlineVersionId: 'outline_01',
              lessonIds: ['lesson_01'],
              resourceVersion: 7,
            }),
            deleteCourse,
            closeCourse: vi.fn(),
            getCourseReview: vi.fn().mockResolvedValue({
              state: 'review-finalized',
              resourceVersion: 1,
            }),
          } as unknown as LearningClient
        }
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '删除课程' }));
    fireEvent.click(screen.getByRole('button', { name: '永久删除' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('课程及现有数据已完整保留');
    expect(screen.getByRole('dialog', { name: '永久删除课程？' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '永久删除' }));
    await waitFor(() => expect(deleteCourse).toHaveBeenCalledTimes(2));
  });

  it('[EQ-COURSE-02] loads real lesson states and routes completed lessons to records while continuing active lessons', async () => {
    const onNavigate = vi.fn();
    const getLessonState = vi.fn(async (lessonId: string) => ({
      lessonId,
      progress: lessonId === 'lesson_done' ? ('completed' as const) : ('in_progress' as const),
      ...(lessonId === 'lesson_active' ? { sessionId: 'session_active' } : {}),
      resourceVersion: 2,
    }));
    render(
      <CoursePage
        courseId="course_01"
        onNavigate={onNavigate}
        client={
          {
            getCourse: vi.fn().mockResolvedValue({
              courseId: 'course_01',
              title: 'Probability',
              status: 'active',
              courseMode: 'standard',
              outlineVersionId: 'outline_01',
              lessonIds: ['lesson_done', 'lesson_active'],
              lessons: [
                {
                  lessonId: 'lesson_done',
                  outlineVersionId: 'outline_01',
                  title: 'Evidence trail',
                  objective: 'Read the evidence trail',
                  coreKnowledgePoints: ['Evidence'],
                  prerequisiteLessonIds: [],
                  estimatedMinutes: 20,
                },
                {
                  lessonId: 'lesson_active',
                  outlineVersionId: 'outline_01',
                  title: 'Bayesian update',
                  objective: 'Update a prior',
                  coreKnowledgePoints: ['Prior', 'Likelihood'],
                  prerequisiteLessonIds: ['lesson_done'],
                  estimatedMinutes: 25,
                },
              ],
              recommendedLessonId: 'lesson_active',
              resourceVersion: 5,
            }),
            getLessonState,
            deleteCourse: vi.fn(),
            closeCourse: vi.fn(),
            getCourseReview: vi.fn().mockResolvedValue(undefined),
          } as unknown as LearningClient
        }
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Evidence trail/ }));
    expect(onNavigate).toHaveBeenLastCalledWith('/courses/course_01/lessons/lesson_done/record');

    fireEvent.click(screen.getByRole('button', { name: /Bayesian update/ }));
    expect(onNavigate).toHaveBeenLastCalledWith('/courses/course_01/lessons/lesson_active');
    expect(getLessonState).toHaveBeenCalledTimes(2);
  });

  it('restores the original authoring conversation, later revisions, and the latest candidate after refresh', async () => {
    const course = {
      courseId: 'course_01',
      title: '微积分',
      status: 'active' as const,
      courseMode: 'standard' as const,
      outlineVersionId: 'outline_01',
      lessonIds: [],
      lessons: [],
      resourceVersion: 7,
    };
    const createOutlineAdjustmentSession = vi.fn().mockResolvedValue({
      outlineSessionId: 'outline_session_01',
      resourceVersion: 5,
      state: 'candidate-ready',
      candidateVersionId: 'candidate_02',
      candidateMarkdown: '# 微积分核心版\n\n## 极限\n### 直观理解极限',
      messages: [
        {
          messageId: 'origin_user',
          role: 'user',
          content: '我想系统学习微积分。',
          status: 'complete',
          createdAt: '2026-07-14T08:00:00.000Z',
        },
        {
          messageId: 'origin_assistant',
          role: 'assistant',
          content: '你希望投入多长时间？',
          status: 'complete',
          createdAt: '2026-07-14T08:01:00.000Z',
        },
        {
          messageId: 'revision_user',
          role: 'user',
          content: '四周时间不严格，也可以延长。',
          status: 'complete',
          createdAt: '2026-07-14T08:02:00.000Z',
        },
      ],
    });
    render(
      <CoursePage
        authoringClient={
          {
            getCourse: vi.fn().mockResolvedValue(course),
            getOutlineVersion: vi.fn().mockResolvedValue({
              courseId: 'course_01',
              outlineVersionId: 'outline_01',
              sourceCandidateVersionId: 'candidate_01',
              current: true,
              outlineMarkdown: '# 微积分\n\n## 极限\n### 极限是什么',
              disciplineTag: '数学',
              topicTags: ['微积分'],
              resourceVersion: 1,
              createdAt: '2026-07-14T08:00:00.000Z',
            }),
            createOutlineAdjustmentSession,
            appendMessage: vi.fn(),
            getOutlineSession: vi.fn(),
            reviseOutline: vi.fn(),
          } as unknown as CourseAuthoringClient
        }
        client={
          {
            getCourseReview: vi.fn().mockResolvedValue(undefined),
          } as unknown as LearningClient
        }
        courseId="course_01"
        view="revision"
      />,
    );

    expect(await screen.findByText('我想系统学习微积分。')).toBeInTheDocument();
    expect(screen.getByText('四周时间不严格，也可以延长。')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '微积分核心版', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('log', { name: '大纲调整对话' }).closest('.ow-panel')).toHaveClass(
      'ow-panel--conversation',
    );
    expect(
      screen.getByRole('heading', { name: '微积分核心版', level: 2 }).closest('.ow-panel'),
    ).toHaveClass('ow-panel--outline');
    expect(createOutlineAdjustmentSession).toHaveBeenCalledTimes(1);
  });

  it('[EQ-COURSE-03] completes the AI outline revision chain and publishes the candidate against the loaded course version', async () => {
    const course = {
      courseId: 'course_01',
      title: 'Probability',
      status: 'active' as const,
      courseMode: 'standard' as const,
      outlineVersionId: 'outline_01',
      lessonIds: ['lesson_01'],
      lessons: [
        {
          lessonId: 'lesson_01',
          outlineVersionId: 'outline_01',
          title: 'Evidence',
          objective: 'Use evidence',
          coreKnowledgePoints: ['Probability'],
          prerequisiteLessonIds: [],
          estimatedMinutes: 20,
        },
      ],
      resourceVersion: 7,
    };
    const createOutlineAdjustmentSession = vi.fn().mockResolvedValue({
      outlineSessionId: 'outline_session_01',
      resourceVersion: 1,
      state: 'candidate-ready',
      candidateVersionId: 'candidate_01',
      candidateMarkdown: '# Probability\n\n## Foundations\n### Evidence',
    });
    const appendMessage = vi.fn().mockResolvedValue({
      outlineSessionId: 'outline_session_01',
      resourceVersion: 2,
      state: 'candidate-ready',
    });
    const requestCandidateGeneration = vi.fn().mockResolvedValue({
      taskId: 'task_revision_01',
      resourceVersion: 4,
      state: 'running',
    });
    const getOutlineSession = vi
      .fn()
      .mockResolvedValueOnce({
        outlineSessionId: 'outline_session_01',
        resourceVersion: 3,
        state: 'candidate-ready',
        candidateVersionId: 'candidate_01',
        candidateMarkdown: '# Probability\n\n## Foundations\n### Evidence',
        messages: [
          {
            messageId: 'assistant_alignment',
            role: 'assistant',
            content: 'I understand the requested evidence-loop adjustment.',
            status: 'complete',
            createdAt: '2026-07-14T08:00:30.000Z',
          },
        ],
      })
      .mockResolvedValue({
        outlineSessionId: 'outline_session_01',
        resourceVersion: 4,
        state: 'candidate-ready',
        candidateVersionId: 'candidate_02',
        candidateMarkdown:
          '# Revised Probability\n\n## Foundations\n### Evidence\nA tighter evidence loop.',
        messages: [
          {
            messageId: 'assistant_01',
            role: 'assistant',
            content: 'I updated the evidence loop.',
            status: 'complete',
            createdAt: '2026-07-14T08:01:00.000Z',
          },
        ],
      });
    const reviseOutline = vi.fn().mockResolvedValue({
      courseId: 'course_01',
      outlineVersionId: 'outline_02',
      resourceVersion: 8,
    });
    const getCourse = vi
      .fn()
      .mockResolvedValueOnce(course)
      .mockResolvedValue({ ...course, outlineVersionId: 'outline_02', resourceVersion: 8 });
    const authoringClient = {
      getCourse,
      getOutlineVersion: vi.fn().mockResolvedValue({
        courseId: 'course_01',
        outlineVersionId: 'outline_01',
        sourceCandidateVersionId: 'candidate_01',
        current: true,
        outlineMarkdown: '# Probability\n\n## Foundations\n### Evidence',
        disciplineTag: 'Mathematics',
        topicTags: ['Probability'],
        resourceVersion: 1,
        createdAt: '2026-07-14T08:00:00.000Z',
      }),
      createOutlineAdjustmentSession,
      appendMessage,
      requestCandidateGeneration,
      cancelCandidateGeneration: vi.fn(),
      getOutlineSession,
      reviseOutline,
    } as unknown as CourseAuthoringClient;
    const onNavigate = vi.fn();

    render(
      <CoursePage
        authoringClient={authoringClient}
        client={
          {
            getLessonState: vi.fn().mockResolvedValue({
              lessonId: 'lesson_01',
              progress: 'completed',
              resourceVersion: 1,
            }),
            getCourseReview: vi.fn().mockResolvedValue(undefined),
          } as unknown as LearningClient
        }
        courseId="course_01"
        onNavigate={onNavigate}
        view="revision"
      />,
    );

    expect(await screen.findByRole('heading', { name: '当前正式大纲' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: 'Probability' }).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByRole('textbox', { name: '继续说明希望怎样调整大纲' }), {
      target: { value: 'Strengthen the evidence loop' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送调整要求' }));

    expect(
      await screen.findByText('I understand the requested evidence-loop adjustment.'),
    ).toBeInTheDocument();
    expect(requestCandidateGeneration).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Revised Probability' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '生成新候选' }));

    expect(
      await screen.findByRole('heading', { name: 'Revised Probability', level: 2 }),
    ).toBeInTheDocument();
    expect(requestCandidateGeneration).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('heading', { name: '当前正式大纲' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认并发布 v2' }).closest('.ow-panel')).toHaveClass(
      'ow-panel--conversation',
    );
    expect(createOutlineAdjustmentSession).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: 'course_01', resourceVersion: 7 }),
    );
    expect(appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        outlineSessionId: 'outline_session_01',
        content: 'Strengthen the evidence loop',
        resourceVersion: 1,
      }),
    );
    expect(screen.getAllByText('内容调整').length).toBeGreaterThan(0);
    expect(screen.getAllByText('查看前后内容').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: '确认并发布 v2' }));
    fireEvent.click(screen.getByRole('button', { name: '确认发布' }));

    await waitFor(() =>
      expect(reviseOutline).toHaveBeenCalledWith(
        expect.objectContaining({
          courseId: 'course_01',
          sourceCandidateVersionId: 'candidate_02',
          resourceVersion: 7,
        }),
      ),
    );
    await waitFor(() => expect(getCourse).toHaveBeenCalledTimes(2));
    expect(onNavigate).toHaveBeenCalledWith('/courses/course_01');
  });

  it('[EQ-COURSE-04] reloads the authoritative course after an outline publish version conflict', async () => {
    const course = {
      courseId: 'course_01',
      title: 'Probability',
      status: 'active' as const,
      courseMode: 'standard' as const,
      outlineVersionId: 'outline_01',
      lessonIds: ['lesson_01'],
      lessons: [
        {
          lessonId: 'lesson_01',
          outlineVersionId: 'outline_01',
          title: 'Evidence',
          objective: 'Use evidence',
          coreKnowledgePoints: ['Probability'],
          prerequisiteLessonIds: [],
          estimatedMinutes: 20,
        },
      ],
      resourceVersion: 7,
    };
    const getCourse = vi
      .fn()
      .mockResolvedValueOnce(course)
      .mockResolvedValue({ ...course, outlineVersionId: 'outline_other', resourceVersion: 9 });
    const reviseOutline = vi.fn().mockRejectedValue({ code: 'version_conflict' });
    const authoringClient = {
      getCourse,
      getOutlineVersion: vi.fn().mockResolvedValue({
        courseId: 'course_01',
        outlineVersionId: 'outline_01',
        sourceCandidateVersionId: 'candidate_01',
        current: true,
        outlineMarkdown: '# Probability\n\n## Foundations\n### Evidence',
        disciplineTag: 'Mathematics',
        topicTags: ['Probability'],
        resourceVersion: 1,
        createdAt: '2026-07-14T08:00:00.000Z',
      }),
      createOutlineAdjustmentSession: vi.fn().mockResolvedValue({
        outlineSessionId: 'outline_session_01',
        resourceVersion: 1,
        state: 'candidate-ready',
        candidateVersionId: 'candidate_01',
        candidateMarkdown: '# Probability\n\n## Foundations\n### Evidence',
      }),
      appendMessage: vi.fn().mockResolvedValue({
        outlineSessionId: 'outline_session_01',
        resourceVersion: 2,
        state: 'generating-candidates',
      }),
      getOutlineSession: vi.fn().mockResolvedValue({
        outlineSessionId: 'outline_session_01',
        resourceVersion: 4,
        state: 'candidate-ready',
        candidateVersionId: 'candidate_02',
        candidateMarkdown:
          '# Revised Probability\n\n## Foundations\n### Evidence\nA tighter evidence loop.',
        messages: [],
      }),
      reviseOutline,
    } as unknown as CourseAuthoringClient;

    render(
      <CoursePage
        authoringClient={authoringClient}
        client={
          {
            getLessonState: vi.fn().mockResolvedValue({
              lessonId: 'lesson_01',
              progress: 'completed',
              resourceVersion: 1,
            }),
            getCourseReview: vi.fn().mockResolvedValue(undefined),
          } as unknown as LearningClient
        }
        courseId="course_01"
        view="revision"
      />,
    );

    fireEvent.change(await screen.findByRole('textbox', { name: '继续说明希望怎样调整大纲' }), {
      target: { value: 'Strengthen the evidence loop' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送调整要求' }));
    await screen.findByRole(
      'heading',
      { name: 'Revised Probability', level: 2 },
      { timeout: 3_000 },
    );
    fireEvent.click(screen.getByRole('button', { name: '确认并发布 v2' }));
    fireEvent.click(screen.getByRole('button', { name: '确认发布' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('最新正式版本已重新读取');
    expect(reviseOutline).toHaveBeenCalledTimes(1);
    expect(getCourse).toHaveBeenCalledTimes(2);
  });

  it('[EQ-COURSE-05] keeps a closed course read-only and opens every lesson from its immutable record', async () => {
    const onNavigate = vi.fn();
    render(
      <CoursePage
        courseId="course_01"
        onNavigate={onNavigate}
        client={
          {
            getCourse: vi.fn().mockResolvedValue({
              courseId: 'course_01',
              title: 'Probability',
              status: 'closed',
              courseMode: 'standard',
              outlineVersionId: 'outline_01',
              lessonIds: ['lesson_01'],
              lessons: [
                {
                  lessonId: 'lesson_01',
                  outlineVersionId: 'outline_01',
                  title: 'Evidence archive',
                  objective: 'Use evidence',
                  coreKnowledgePoints: ['Probability'],
                  prerequisiteLessonIds: [],
                  estimatedMinutes: 20,
                },
              ],
              resourceVersion: 9,
            }),
            getLessonState: vi.fn().mockResolvedValue({
              lessonId: 'lesson_01',
              progress: 'completed',
              resourceVersion: 1,
            }),
            deleteCourse: vi.fn(),
            closeCourse: vi.fn(),
            getCourseReview: vi.fn().mockResolvedValue({
              state: 'review-finalized',
              markdown: '# Topic review',
              resourceVersion: 9,
            }),
          } as unknown as LearningClient
        }
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Evidence archive/ }));
    expect(onNavigate).toHaveBeenCalledWith('/courses/course_01/lessons/lesson_01/record');
    expect(screen.queryByRole('button', { name: '修改大纲' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '关闭课程并生成总结' })).not.toBeInTheDocument();
  });
});
