// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LearningClient } from '../../client/learning-client.js';
import type { CourseAuthoringClient } from '../../client/course-authoring-client.js';
import { CoursePage } from './course-page.js';

afterEach(cleanup);

describe('CoursePage', () => {
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

    await screen.findByText('Probability');
    fireEvent.click(screen.getByRole('button', { name: '关闭课程并生成总结' }));
    const close = screen.getByRole('button', { name: '确认关闭课程' });
    fireEvent.click(close);
    fireEvent.click(close);

    expect(await screen.findByRole('heading', { name: '主题核心知识线索' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '总体学习表现' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '推荐扩展课程' })).toBeInTheDocument();
    expect(document.querySelector('.course-review-content')).toHaveAttribute('data-ai-surface');
    expect(closeCourse).toHaveBeenCalledTimes(1);
    expect(document.body).not.toHaveTextContent('course_review_course_01');
  });

  it('[EQ-COURSE-06] confirms the irreversible cascade once and delegates successful home navigation', async () => {
    let resolveDelete!: (value: {
      courseId: string;
      deletedAt: string;
      portraitRefresh: 'updating';
    }) => void;
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
    expect(dialog).toHaveTextContent('学习画像');
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
      portraitRefresh: 'updating',
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
    const createOutlineSession = vi.fn().mockResolvedValue({
      outlineSessionId: 'outline_session_01',
      resourceVersion: 1,
      state: 'assessing',
    });
    const appendMessage = vi.fn().mockResolvedValue({
      outlineSessionId: 'outline_session_01',
      resourceVersion: 2,
      state: 'assessing',
    });
    const requestCandidateGeneration = vi.fn().mockResolvedValue({
      taskId: 'task_01',
      resourceVersion: 3,
      state: 'queued',
    });
    const streamGeneration = vi.fn().mockResolvedValue(undefined);
    const getOutlineSession = vi.fn().mockResolvedValue({
      outlineSessionId: 'outline_session_01',
      resourceVersion: 4,
      state: 'candidate-ready',
      candidateVersionId: 'candidate_02',
      candidateMarkdown: '# Revised Probability\n\nA tighter evidence loop.',
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
        current: true,
        markdown: '# Probability',
        createdAt: '2026-07-14T08:00:00.000Z',
      }),
      createOutlineSession,
      appendMessage,
      requestCandidateGeneration,
      streamGeneration,
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

    fireEvent.change(await screen.findByRole('textbox', { name: '继续说明希望怎样调整大纲' }), {
      target: { value: 'Strengthen the evidence loop' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送调整要求' }));

    expect(await screen.findByRole('heading', { name: 'Revised Probability' })).toBeInTheDocument();
    expect(createOutlineSession).toHaveBeenCalledTimes(1);
    expect(appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        outlineSessionId: 'outline_session_01',
        content: 'Strengthen the evidence loop',
        resourceVersion: 1,
      }),
    );
    expect(requestCandidateGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ outlineSessionId: 'outline_session_01', resourceVersion: 2 }),
    );
    expect(streamGeneration).toHaveBeenCalledWith('task_01', expect.any(Object));

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
        current: true,
        markdown: '# Probability',
        createdAt: '2026-07-14T08:00:00.000Z',
      }),
      createOutlineSession: vi.fn().mockResolvedValue({
        outlineSessionId: 'outline_session_01',
        resourceVersion: 1,
        state: 'assessing',
      }),
      appendMessage: vi.fn().mockResolvedValue({
        outlineSessionId: 'outline_session_01',
        resourceVersion: 2,
        state: 'assessing',
      }),
      requestCandidateGeneration: vi.fn().mockResolvedValue({
        taskId: 'task_01',
        resourceVersion: 3,
        state: 'queued',
      }),
      streamGeneration: vi.fn().mockResolvedValue(undefined),
      getOutlineSession: vi.fn().mockResolvedValue({
        outlineSessionId: 'outline_session_01',
        resourceVersion: 4,
        state: 'candidate-ready',
        candidateVersionId: 'candidate_02',
        candidateMarkdown: '# Revised Probability\n\nA tighter evidence loop.',
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
    await screen.findByRole('heading', { name: 'Revised Probability' });
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
