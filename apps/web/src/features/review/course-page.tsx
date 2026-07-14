import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  CourseArchiveView,
  CourseOutlineVersionView,
  CourseReviewView as CourseReviewPayload,
  HomeDashboardView,
} from '@learning-more/contracts';
import { Button, ContentState, Dialog, Toast } from '@learning-more/ui';

import {
  courseAuthoringClient,
  type CourseAuthoringClient,
  type OutlineSessionView,
} from '../../client/course-authoring-client.js';
import { homeClient } from '../../client/home-client.js';
import { learningClient, type LearningClient } from '../../client/learning-client.js';
import { getPageInstanceId } from '../../state/page-instance.js';
import { useAppShellHeaderStatus } from '../../state/app-shell-header.js';
import { FormalCourseView, type CourseDirectoryItem } from '../course/formal-course-view.js';
import {
  OutlineRevisionWorkspace,
  type CourseRevisionCandidate,
  type CourseRevisionMessage,
} from '../course/outline-revision-workspace.js';
import type { CourseLessonRuntimeState } from '../course/outline-view.js';
import { CourseReviewView } from './course-review-view.js';

type CoursePageAuthoringClient = Pick<
  CourseAuthoringClient,
  | 'appendMessage'
  | 'createOutlineSession'
  | 'getCourse'
  | 'getOutlineSession'
  | 'getOutlineVersion'
  | 'requestCandidateGeneration'
  | 'reviseOutline'
  | 'streamGeneration'
>;

export type CoursePageView = 'outline' | 'revision' | 'review';

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

function candidateFromSession(
  course: CourseArchiveView,
  session: OutlineSessionView,
): CourseRevisionCandidate | undefined {
  const candidateVersionId = session.candidateVersionId;
  if (candidateVersionId === undefined) return undefined;
  const markdown = session.candidateMarkdown ?? '';
  const markdownTitle = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const paragraphs = markdown
    .replace(/^#{1,6}\s+.+$/gm, '')
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  const lessons = course.lessons ?? [];
  const modules: Array<CourseRevisionCandidate['modules'][number]> = [];
  for (let offset = 0; offset < lessons.length; offset += 2) {
    const group = lessons.slice(offset, offset + 2);
    const first = group[0];
    if (first === undefined) continue;
    modules.push({
      title: `模块${['一', '二', '三', '四', '五'][Math.floor(offset / 2)] ?? ` ${Math.floor(offset / 2) + 1}`} · ${first.objective}`,
      change: offset === 0 ? '调整' : '保留',
      lessons: group.map((lesson) => ({
        title: lesson.title,
        detail:
          lesson.coreKnowledgePoints.length === 0
            ? lesson.objective
            : `${lesson.coreKnowledgePoints.join('、')}。`,
      })),
    });
  }
  return {
    candidateVersionId,
    title: markdownTitle ?? course.title,
    summary: paragraphs[0] ?? '候选版本已根据本轮调整要求生成。',
    discipline: '课程主题',
    tags: [courseModeLabel(course.courseMode)],
    versionLabel: `基于当前版 · 候选 ${candidateVersionId.slice(-4)}`,
    modules,
    impact: '当前确认版与既有课节归档保持不变；发布后候选版本成为新的正式大纲。',
  };
}

function courseModeLabel(mode: CourseArchiveView['courseMode']): string {
  return {
    standard: '标准模式',
    brainstorm: '头脑风暴',
    argument_clash: '论证交锋',
    case_study: '案例研习',
    business_insight: '商业洞察',
    process_decomposition: '流程拆解',
    decision_analysis: '决策分析',
    cross_explore: '交叉探索',
    reading_seminar: '阅读研讨',
  }[mode];
}

export function CoursePage(props: {
  readonly courseId: string;
  readonly view?: CoursePageView | undefined;
  readonly client?: LearningClient;
  readonly authoringClient?: CoursePageAuthoringClient;
  readonly initiallyOpenDelete?: boolean | undefined;
  readonly onNavigate?: (path: string) => void;
  readonly onDeleted?: (message: string) => void;
}) {
  const api = props.client ?? learningClient;
  const authoring =
    props.authoringClient ?? (props.client === undefined ? courseAuthoringClient : undefined);
  const requestedView = props.view;
  const [localView, setLocalView] = useState<CoursePageView>(requestedView ?? 'outline');
  const view = requestedView ?? localView;
  const [course, setCourse] = useState<CourseArchiveView>();
  const [currentOutline, setCurrentOutline] = useState<CourseOutlineVersionView>();
  const [lessonStates, setLessonStates] = useState<
    Readonly<Record<string, CourseLessonRuntimeState | undefined>>
  >({});
  const [dashboard, setDashboard] = useState<HomeDashboardView>();
  const [review, setReview] = useState<CourseReviewPayload>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [revisionBusy, setRevisionBusy] = useState(false);
  const [revisionError, setRevisionError] = useState<string>();
  const [revisionSession, setRevisionSession] = useState<OutlineSessionView>();
  const [revisionCandidate, setRevisionCandidate] = useState<CourseRevisionCandidate>();
  const [revisionMessages, setRevisionMessages] = useState<readonly CourseRevisionMessage[]>([
    {
      role: 'assistant',
      markdown:
        '说明希望保留、删除、重排或强化的内容。我会继承当前大纲与已完成 Review，生成完整候选版本；发布前不会改变正式课程。',
    },
  ]);
  const mounted = useRef(true);

  useAppShellHeaderStatus(
    course === undefined
      ? undefined
      : course.status === 'closed'
        ? { tone: 'readonly', text: '● 课程已关闭' }
        : view === 'revision'
          ? { tone: 'success', text: '● 调整会话已保存' }
          : { tone: 'success', text: '● 课程进行中' },
  );

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  useEffect(() => {
    if (requestedView !== undefined) setLocalView(requestedView);
  }, [requestedView]);

  const loadCourse = useCallback(async () => {
    const next =
      authoring === undefined
        ? await api.getCourse(props.courseId)
        : await authoring.getCourse(props.courseId);
    if (!mounted.current) return next as CourseArchiveView;
    const archive = next as CourseArchiveView;
    setCourse(archive);
    setError(undefined);

    if (authoring !== undefined) {
      void authoring.getOutlineVersion(archive.courseId, archive.outlineVersionId).then(
        (outline) => {
          if (mounted.current) setCurrentOutline(outline);
        },
        () => undefined,
      );
    }

    const getLessonState = api.getLessonState?.bind(api);
    if (getLessonState !== undefined) {
      const entries = await Promise.all(
        archive.lessonIds.map(async (lessonId) => {
          try {
            const state = await getLessonState(lessonId);
            return [lessonId, { progress: state.progress, sessionId: state.sessionId }] as const;
          } catch {
            return [lessonId, { progress: 'not_started' as const }] as const;
          }
        }),
      );
      if (mounted.current) setLessonStates(Object.fromEntries(entries));
    }
    return archive;
  }, [api, authoring, props.courseId]);

  useEffect(() => {
    mounted.current = true;
    void loadCourse().catch(() => {
      if (mounted.current) setError('课程档案暂时不可用，请稍后重试。');
    });
    void api.getCourseReview(props.courseId).then((next) => {
      if (mounted.current && next !== undefined) setReview(next);
    });
    if (props.client === undefined) {
      const controller = new AbortController();
      void homeClient.getDashboard(controller.signal).then(
        (next) => {
          if (mounted.current) setDashboard(next);
        },
        () => undefined,
      );
      return () => controller.abort();
    }
    return undefined;
  }, [api, loadCourse, props.client, props.courseId]);

  const navigate = (path: string) => {
    if (props.onNavigate !== undefined) {
      props.onNavigate(path);
      return;
    }
    const query = path.includes('?')
      ? new URLSearchParams(path.slice(path.indexOf('?') + 1))
      : undefined;
    const next = query?.get('view');
    setLocalView(next === 'revision' || next === 'review' ? next : 'outline');
  };

  const deleteCourse = async () => {
    if (course === undefined) throw new Error('course_archive_not_loaded');
    await api.deleteCourse(course.courseId, course.resourceVersion);
    props.onDeleted?.('课程及关联记录已永久删除');
  };

  const closeCourse = async () => {
    if (course === undefined || closing) return;
    setClosing(true);
    setError(undefined);
    const hasAbandoned = Object.values(lessonStates).some(
      (state) => state?.progress === 'abandoned',
    );
    try {
      const result = await api.closeCourse(course.courseId, course.resourceVersion, hasAbandoned);
      setReview(result);
      const refreshed = await loadCourse();
      if (refreshed.status !== 'closed') {
        setCourse({ ...refreshed, status: 'closed', resourceVersion: result.resourceVersion });
      }
      setCloseConfirmOpen(false);
      setNotice('课程已关闭，主题总结已生成');
      navigate(`/courses/${course.courseId}?view=review`);
    } catch (caught) {
      setError(
        errorCode(caught) === 'version_conflict'
          ? '课程状态已变化，正在重新读取最新版本。'
          : '课程尚不具备关闭条件；未完成课节和现有记录均已保留。',
      );
      if (errorCode(caught) === 'version_conflict') await loadCourse();
    } finally {
      setClosing(false);
    }
  };

  const sendRevision = async (message: string) => {
    if (course === undefined || authoring === undefined || revisionBusy) {
      setRevisionError('当前运行环境暂时无法创建大纲候选版本。');
      return;
    }
    setRevisionBusy(true);
    setRevisionError(undefined);
    setRevisionMessages((current) => [...current, { role: 'user', markdown: message }]);
    try {
      let session = revisionSession;
      if (session === undefined) {
        session = await authoring.createOutlineSession({
          topic: `${course.title}（大纲调整）`,
          courseMode: course.courseMode,
          pageInstanceId: getPageInstanceId(),
        });
      }
      const appended = await authoring.appendMessage({
        outlineSessionId: session.outlineSessionId,
        content: message,
        resourceVersion: session.resourceVersion,
        pageInstanceId: getPageInstanceId(),
      });
      const generation = await authoring.requestCandidateGeneration({
        outlineSessionId: session.outlineSessionId,
        resourceVersion: appended.resourceVersion,
        pageInstanceId: getPageInstanceId(),
      });
      await authoring.streamGeneration(generation.taskId, { onEvent: () => undefined });
      const refreshed = await authoring.getOutlineSession(session.outlineSessionId);
      const candidate = candidateFromSession(course, refreshed);
      setRevisionSession(refreshed);
      setRevisionCandidate(candidate);
      setRevisionMessages((current) => [
        ...current,
        {
          role: 'assistant',
          markdown:
            candidate === undefined
              ? '生成任务已经结束，但候选版本尚未就绪。请重试本轮调整。'
              : '已将这项要求纳入完整候选版本，并保留当前正式大纲与既有课节归档。你可以继续调整或发布右侧版本。',
        },
      ]);
    } catch (caught) {
      setRevisionError(
        errorCode(caught) === 'version_conflict'
          ? '调整会话已在其他页面更新，请返回课程大纲后重新进入。'
          : '候选大纲生成未完成；当前正式大纲没有发生变化，可以直接重试。',
      );
    } finally {
      setRevisionBusy(false);
    }
  };

  const publishRevision = async (candidateVersionId: string) => {
    if (course === undefined || authoring === undefined) return;
    setRevisionError(undefined);
    try {
      await authoring.reviseOutline({
        courseId: course.courseId,
        sourceCandidateVersionId: candidateVersionId,
        resourceVersion: course.resourceVersion,
        pageInstanceId: getPageInstanceId(),
      });
      await loadCourse();
      setNotice('大纲新版本已发布，历史版本保持只读');
      navigate(`/courses/${course.courseId}`);
    } catch (caught) {
      if (errorCode(caught) === 'version_conflict') {
        setRevisionError('课程大纲已被更新。最新正式版本已重新读取，请基于最新版本再次生成候选。');
        await loadCourse();
        return;
      }
      setRevisionError('大纲发布未完成；候选版本和当前正式大纲均已保留。');
      throw caught;
    }
  };

  if (course === undefined) {
    return (
      <main className="lm-page course-page-loading">
        <ContentState
          role={error === undefined ? 'status' : 'alert'}
          title={error ?? '正在读取课程档案…'}
        />
      </main>
    );
  }

  if (view === 'revision') {
    return (
      <>
        <OutlineRevisionWorkspace
          busy={revisionBusy}
          candidate={revisionCandidate}
          course={course}
          currentOutline={currentOutline}
          error={revisionError}
          initialMessages={revisionMessages}
          onBack={() => navigate(`/courses/${course.courseId}`)}
          onPublish={publishRevision}
          onSend={sendRevision}
        />
        {notice === undefined ? null : <Toast>{notice}</Toast>}
      </>
    );
  }

  if (view === 'review') {
    return review?.markdown === undefined ? (
      <main className="lm-page course-page-loading">
        <ContentState
          title="课程主题总结尚未生成"
          description="关闭课程后可查看永久只读的主题总结。"
        />
        <Button type="button" onClick={() => navigate(`/courses/${course.courseId}`)}>
          返回课程大纲
        </Button>
      </main>
    ) : (
      <CourseReviewView
        course={course}
        currentOutline={currentOutline}
        markdown={review.markdown}
        onNavigate={navigate}
      />
    );
  }

  const availableCourses: readonly CourseDirectoryItem[] = (dashboard?.courses ?? []).map(
    (item) => ({
      courseId: item.courseId,
      title: item.title,
      status: item.status,
      courseMode: item.courseMode,
    }),
  );
  const abandonedLessonIds = course.lessonIds.filter(
    (lessonId) => lessonStates[lessonId]?.progress === 'abandoned',
  );

  return (
    <>
      <FormalCourseView
        availableCourses={availableCourses}
        course={course}
        currentOutline={currentOutline}
        initiallyOpenDelete={props.initiallyOpenDelete}
        lessonStates={lessonStates}
        onCloseCourse={() => setCloseConfirmOpen(true)}
        onDeleteCourse={deleteCourse}
        onModifyOutline={() => navigate(`/courses/${course.courseId}?view=revision`)}
        onNavigate={navigate}
        onOpenReview={() => navigate(`/courses/${course.courseId}?view=review`)}
        onSelectVersion={async (outlineVersionId) => {
          if (authoring === undefined) throw new Error('outline_history_unavailable');
          return authoring.getOutlineVersion(course.courseId, outlineVersionId);
        }}
      />
      <Dialog
        footer={
          <>
            <Button disabled={closing} type="button" onClick={() => setCloseConfirmOpen(false)}>
              取消
            </Button>
            <Button
              busy={closing}
              type="button"
              variant="primary"
              onClick={() => void closeCourse()}
            >
              {closing ? '正在生成总结…' : '确认关闭课程'}
            </Button>
          </>
        }
        onClose={() => {
          if (!closing) setCloseConfirmOpen(false);
        }}
        open={closeConfirmOpen}
        title="关闭课程并生成主题总结？"
      >
        <p>关闭后课程大纲与全部课节归档永久只读，并生成课程主题总 Review。</p>
        {abandonedLessonIds.length === 0 ? null : (
          <p>以下已放弃课节将以现有阶段 Review 纳入总结：{abandonedLessonIds.join('、')}</p>
        )}
      </Dialog>
      {error === undefined ? null : <Toast assertive>{error}</Toast>}
      {notice === undefined ? null : <Toast>{notice}</Toast>}
    </>
  );
}
