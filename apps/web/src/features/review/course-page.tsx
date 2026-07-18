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
import { diffOutlineMarkdown } from '../course/outline-markdown-diff.js';
import { projectOutlineMarkdown } from '../course/outline-markdown-projection.js';
import {
  OutlineRevisionWorkspace,
  type CourseRevisionCandidate,
  type CourseRevisionMessage,
  type CourseRevisionPhase,
} from '../course/outline-revision-workspace.js';
import type { CourseLessonRuntimeState } from '../course/outline-view.js';
import { CourseReviewView } from './course-review-view.js';

type CoursePageAuthoringClient = Pick<
  CourseAuthoringClient,
  | 'appendMessage'
  | 'cancelCandidateGeneration'
  | 'createOutlineAdjustmentSession'
  | 'getCourse'
  | 'getOutlineSession'
  | 'getOutlineVersion'
  | 'requestCandidateGeneration'
  | 'reviseOutline'
>;

export type CoursePageView = 'outline' | 'revision' | 'review';

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

function candidateFromSession(
  course: CourseArchiveView,
  currentOutline: CourseOutlineVersionView,
  session: OutlineSessionView,
): CourseRevisionCandidate | undefined {
  const candidateVersionId = session.candidateVersionId;
  const markdown = session.candidateMarkdown?.trim() ?? '';
  if (
    candidateVersionId === undefined ||
    candidateVersionId === currentOutline.sourceCandidateVersionId ||
    markdown === ''
  ) {
    return undefined;
  }
  const formalLessons = (course.lessons ?? []).map((lesson) => ({
    lessonId: lesson.lessonId,
    title: lesson.title,
  }));
  const alignment = session.messages
    ?.slice()
    .reverse()
    .find(
      (message) =>
        message.role === 'assistant' &&
        (message.alignmentAction === 'patch' || message.alignmentAction === 'regenerate'),
    );
  const diff = diffOutlineMarkdown(currentOutline.outlineMarkdown, markdown, formalLessons, {
    ...(alignment?.alignmentAction === 'patch' || alignment?.alignmentAction === 'regenerate'
      ? { action: alignment.alignmentAction }
      : {}),
    ...(alignment?.targetModuleIds === undefined
      ? {}
      : { targetNodeRefs: alignment.targetModuleIds }),
  });
  const changes = [
    ...diff.modules.flatMap((module) => [module, ...module.lessons]),
    ...diff.courseSections,
  ];
  const counts = changes
    .map((change) => change.status)
    .reduce<Record<string, number>>((current, status) => {
      current[status] = (current[status] ?? 0) + 1;
      return current;
    }, {});
  const requested = changes.filter(
    (change) => change.status !== 'unchanged' && change.attribution === 'requested',
  ).length;
  const synchronised = changes.filter(
    (change) => change.status !== 'unchanged' && change.attribution === 'ai_sync',
  ).length;
  const title = projectOutlineMarkdown(markdown).title ?? course.title;
  return {
    candidateVersionId,
    title,
    markdown,
    versionLabel: `基于当前版 · 候选 ${candidateVersionId.slice(-4)}`,
    diff,
    impact: `响应要求 ${requested} · AI 同步调整 ${synchronised} · 新增 ${counts.added ?? 0} · 删除 ${counts.removed ?? 0}`,
  };
}

function messagesFromSession(session: OutlineSessionView): readonly CourseRevisionMessage[] {
  return (session.messages ?? [])
    .filter((message) => message.status === 'complete')
    .map((message) => ({ role: message.role, markdown: message.content }));
}

function hasUnappliedRevisionConversation(session: OutlineSessionView): boolean {
  const messages = session.messages ?? [];
  const generationMessageIndex = messages.findLastIndex(
    (message) =>
      message.role === 'assistant' &&
      (message.alignmentAction === 'patch' || message.alignmentAction === 'regenerate'),
  );
  return generationMessageIndex >= 0 && generationMessageIndex < messages.length - 1;
}

async function waitForAdjustedSession(input: {
  readonly authoring: CoursePageAuthoringClient;
  readonly outlineSessionId: string;
  readonly baselineCandidateVersionId?: string | undefined;
  readonly appendState: string;
}): Promise<OutlineSessionView> {
  for (let attempt = 0; attempt < 480; attempt += 1) {
    const session = await input.authoring.getOutlineSession(input.outlineSessionId);
    if (
      session.candidateVersionId !== undefined &&
      session.candidateVersionId !== input.baselineCandidateVersionId
    ) {
      return session;
    }
    const latestAssistant = session.messages
      ?.slice()
      .reverse()
      .find((message) => message.role === 'assistant');
    if (session.state === 'candidate-ready' && latestAssistant?.alignmentAction === 'clarify') {
      return session;
    }
    const candidateExpected =
      input.appendState !== 'candidate-ready' ||
      latestAssistant?.alignmentAction === 'regenerate' ||
      latestAssistant?.alignmentAction === 'patch';
    if (
      !candidateExpected &&
      session.state !== 'generating-candidates' &&
      session.state !== 'alignment-turn-running'
    ) {
      return session;
    }
    if (candidateExpected && session.state === 'candidate-ready') return session;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('outline_adjustment_generation_timeout');
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
  const [revisionPhase, setRevisionPhase] = useState<CourseRevisionPhase>('opening');
  const [generationCancelBusy, setGenerationCancelBusy] = useState(false);
  const [hasUnappliedConversation, setHasUnappliedConversation] = useState(false);
  const [revisionError, setRevisionError] = useState<string>();
  const [revisionSession, setRevisionSession] = useState<OutlineSessionView>();
  const [revisionCandidate, setRevisionCandidate] = useState<CourseRevisionCandidate>();
  const [revisionMessages, setRevisionMessages] = useState<readonly CourseRevisionMessage[]>([]);
  const openedRevisionKey = useRef<string | undefined>(undefined);
  const generationCancelled = useRef(false);
  const mounted = useRef(true);

  useAppShellHeaderStatus(
    course === undefined
      ? undefined
      : course.status === 'closed'
        ? { tone: 'readonly', text: '● 课程已关闭' }
        : view === 'revision'
          ? revisionPhase === 'opening'
            ? { tone: 'warning', text: '● 正在恢复调整会话' }
            : revisionPhase === 'thinking'
              ? { tone: 'warning', text: '● AI 正在思考' }
              : revisionPhase === 'generating'
                ? { tone: 'warning', text: '● 正在生成候选大纲' }
                : revisionSession === undefined
                  ? { tone: 'readonly', text: '● 调整会话待恢复' }
                  : { tone: 'success', text: '● 调整会话已保存' }
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

  useEffect(() => {
    if (view !== 'review') return undefined;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const next = await api.getCourseReview(props.courseId);
        if (cancelled) return;
        if (next !== undefined) setReview(next);
        if (next?.state === 'review-finalized' || next?.state === 'review-failed') return;
      } catch {
        // The background task may not have been created yet; keep the read side passive.
      }
      if (!cancelled) timer = window.setTimeout(() => void poll(), 1_000);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [api, props.courseId, view]);

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

  useEffect(() => {
    if (
      view !== 'revision' ||
      course === undefined ||
      currentOutline === undefined ||
      authoring === undefined
    ) {
      return;
    }
    const key = `${course.courseId}:${course.resourceVersion}:${currentOutline.outlineVersionId}`;
    if (openedRevisionKey.current === key) return;
    openedRevisionKey.current = key;
    let cancelled = false;
    setRevisionPhase('opening');
    void authoring
      .createOutlineAdjustmentSession({
        courseId: course.courseId,
        resourceVersion: course.resourceVersion,
        pageInstanceId: getPageInstanceId(),
      })
      .then(async (opened) => {
        if (!cancelled && mounted.current) {
          setRevisionSession(opened);
          setRevisionMessages(messagesFromSession(opened));
          setRevisionCandidate(candidateFromSession(course, currentOutline, opened));
          setHasUnappliedConversation(hasUnappliedRevisionConversation(opened));
          setRevisionPhase(
            opened.state === 'generating-candidates'
              ? 'generating'
              : opened.state === 'alignment-turn-running'
                ? 'thinking'
                : candidateFromSession(course, currentOutline, opened) === undefined
                  ? 'ready'
                  : 'candidate-ready',
          );
        }
        let restored = opened;
        if (opened.state === 'generating-candidates' || opened.state === 'alignment-turn-running') {
          restored = await waitForAdjustedSession({
            authoring,
            outlineSessionId: opened.outlineSessionId,
            baselineCandidateVersionId: currentOutline.sourceCandidateVersionId,
            appendState: opened.state,
          });
        }
        if (cancelled || !mounted.current) return;
        setRevisionSession(restored);
        setRevisionMessages(messagesFromSession(restored));
        const candidate = candidateFromSession(course, currentOutline, restored);
        setRevisionCandidate(candidate);
        setHasUnappliedConversation(hasUnappliedRevisionConversation(restored));
        setRevisionPhase(candidate === undefined ? 'ready' : 'candidate-ready');
      })
      .catch(() => {
        if (cancelled || !mounted.current) return;
        openedRevisionKey.current = undefined;
        setRevisionError('大纲调整会话暂时无法恢复，请稍后重试。');
        setRevisionPhase('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [authoring, course, currentOutline, view]);

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
      setNotice(
        result.markdown === undefined
          ? '课程已关闭，课程总 Review 正在后台生成'
          : '课程已关闭，课程总 Review 已保存',
      );
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
    if (
      course === undefined ||
      authoring === undefined ||
      revisionPhase === 'opening' ||
      revisionPhase === 'thinking' ||
      revisionPhase === 'generating'
    ) {
      setRevisionError('当前调整会话暂时无法发送消息。');
      return;
    }
    setRevisionPhase('thinking');
    setRevisionError(undefined);
    setRevisionMessages((current) => [...current, { role: 'user', markdown: message }]);
    try {
      let session = revisionSession;
      if (session === undefined) {
        session = await authoring.createOutlineAdjustmentSession({
          courseId: course.courseId,
          resourceVersion: course.resourceVersion,
          pageInstanceId: getPageInstanceId(),
        });
      }
      await authoring.appendMessage({
        outlineSessionId: session.outlineSessionId,
        content: message,
        resourceVersion: session.resourceVersion,
        pageInstanceId: getPageInstanceId(),
      });
      const refreshed = await authoring.getOutlineSession(session.outlineSessionId);
      const candidate =
        currentOutline === undefined
          ? undefined
          : candidateFromSession(course, currentOutline, refreshed);
      const assistantReply = refreshed.messages
        ?.slice()
        .reverse()
        .find((message) => message.role === 'assistant')?.content;
      setRevisionSession(refreshed);
      setRevisionCandidate(candidate);
      setHasUnappliedConversation(candidate !== undefined);
      const authoritativeMessages = messagesFromSession(refreshed);
      setRevisionMessages(
        authoritativeMessages.length > 0
          ? authoritativeMessages
          : [
              { role: 'user', markdown: message },
              {
                role: 'assistant',
                markdown: assistantReply ?? '我已记录这项调整想法；当前右侧大纲保持不变。',
              },
            ],
      );
      setRevisionPhase(candidate === undefined ? 'ready' : 'candidate-ready');
    } catch (caught) {
      if (revisionSession !== undefined) {
        void authoring.getOutlineSession(revisionSession.outlineSessionId).then(
          (restored) => {
            if (!mounted.current) return;
            setRevisionSession(restored);
            setRevisionMessages(messagesFromSession(restored));
            if (currentOutline !== undefined) {
              setRevisionCandidate(candidateFromSession(course, currentOutline, restored));
            }
          },
          () => undefined,
        );
      }
      setRevisionError(
        errorCode(caught) === 'version_conflict'
          ? '调整会话已在其他页面更新，请返回课程大纲后重新进入。'
          : 'AI 回复未完成；当前大纲没有发生变化，可以直接重试。',
      );
      setRevisionPhase('failed');
    }
  };

  const generateRevisionCandidate = async () => {
    if (
      course === undefined ||
      currentOutline === undefined ||
      authoring === undefined ||
      revisionSession === undefined ||
      revisionPhase === 'thinking' ||
      revisionPhase === 'generating'
    ) {
      return;
    }
    generationCancelled.current = false;
    setRevisionPhase('generating');
    setRevisionError(undefined);
    const baselineCandidateVersionId = revisionSession.candidateVersionId;
    try {
      const accepted = await authoring.requestCandidateGeneration({
        outlineSessionId: revisionSession.outlineSessionId,
        resourceVersion: revisionSession.resourceVersion,
        pageInstanceId: getPageInstanceId(),
      });
      if (accepted.failureCode !== undefined) {
        throw Object.assign(new Error(accepted.failureCode), { code: accepted.failureCode });
      }
      setRevisionSession({
        ...revisionSession,
        state: 'generating-candidates',
        generationTaskId: accepted.taskId,
        resourceVersion: accepted.resourceVersion,
      });
      const refreshed = await waitForAdjustedSession({
        authoring,
        outlineSessionId: revisionSession.outlineSessionId,
        baselineCandidateVersionId,
        appendState: accepted.state,
      });
      if (generationCancelled.current || !mounted.current) return;
      const candidate = candidateFromSession(course, currentOutline, refreshed);
      if (candidate === undefined || refreshed.candidateVersionId === baselineCandidateVersionId) {
        throw new Error('outline_adjustment_generation_incomplete');
      }
      setRevisionSession(refreshed);
      setRevisionMessages(messagesFromSession(refreshed));
      setRevisionCandidate(candidate);
      setHasUnappliedConversation(false);
      setRevisionPhase('candidate-ready');
    } catch (caught) {
      if (generationCancelled.current || !mounted.current) return;
      setRevisionError(
        errorCode(caught) === 'version_conflict'
          ? '调整会话已在其他页面更新，请重新进入修改大纲。'
          : '候选大纲生成未完成；当前正式大纲和上一候选均已保留。',
      );
      setRevisionPhase('failed');
    }
  };

  const cancelRevisionGeneration = async () => {
    if (authoring === undefined || revisionSession === undefined || generationCancelBusy) return;
    generationCancelled.current = true;
    setGenerationCancelBusy(true);
    setRevisionError(undefined);
    try {
      await authoring.cancelCandidateGeneration({
        outlineSessionId: revisionSession.outlineSessionId,
        resourceVersion: revisionSession.resourceVersion,
        pageInstanceId: getPageInstanceId(),
      });
      const restored = await authoring.getOutlineSession(revisionSession.outlineSessionId);
      if (!mounted.current || course === undefined || currentOutline === undefined) return;
      const candidate = candidateFromSession(course, currentOutline, restored);
      setRevisionSession(restored);
      setRevisionMessages(messagesFromSession(restored));
      setRevisionCandidate(candidate);
      setHasUnappliedConversation(hasUnappliedRevisionConversation(restored));
      setRevisionPhase(candidate === undefined ? 'ready' : 'candidate-ready');
    } catch {
      generationCancelled.current = false;
      setRevisionError('取消生成未完成，系统将继续读取当前候选任务状态。');
      setRevisionPhase('generating');
    } finally {
      setGenerationCancelBusy(false);
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
        setRevisionSession(undefined);
        setRevisionCandidate(undefined);
        openedRevisionKey.current = undefined;
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
          candidate={revisionCandidate}
          course={course}
          currentOutline={currentOutline}
          error={revisionError}
          generationCancelBusy={generationCancelBusy}
          hasUnappliedConversation={hasUnappliedConversation}
          initialMessages={revisionMessages}
          onBack={() => navigate(`/courses/${course.courseId}`)}
          onCancelGeneration={cancelRevisionGeneration}
          onGenerate={generateRevisionCandidate}
          onPublish={publishRevision}
          onSend={sendRevision}
          phase={revisionPhase}
        />
        {notice === undefined ? null : <Toast>{notice}</Toast>}
      </>
    );
  }

  if (view === 'review') {
    return review?.markdown === undefined ? (
      <main className="lm-page course-page-loading">
        <ContentState
          title={
            review?.state === 'review-failed'
              ? '课程总 Review 生成失败'
              : review?.state === 'generating-review' || review?.state === 'review-ready'
                ? '课程总 Review 正在后台生成'
                : '课程总 Review 尚未生成'
          }
          description={
            review?.state === 'review-failed'
              ? '课时 Review 与学习档案均已保留，可稍后重试课程总结。'
              : '最后一节课完成后会自动汇总并静态保存；生成期间无需停留在本页。'
          }
        />
        <Button type="button" onClick={() => navigate(`/courses/${course.courseId}`)}>
          返回课程大纲
        </Button>
      </main>
    ) : (
      <CourseReviewView
        course={course}
        currentOutline={currentOutline}
        {...(review.document?.kind === 'course-final' ? { document: review.document } : {})}
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
        title="关闭课程并在后台生成课程总 Review？"
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
