import { useEffect, useReducer, useRef, useState } from 'react';

import { learningClient, type LearningClient } from '../../client/learning-client.js';
import { ChatComposer } from '../../components/chat/chat.js';
import { ReviewDialog } from '../review/review-dialog.js';
import type { SessionMessageView } from './message-stream.js';
import { LessonSessionWorkspace } from './lesson-session-workspace.js';
import { useSessionWindowLifecycle } from './session-window-lifecycle.js';

type TeachingProgress = NonNullable<
  Awaited<ReturnType<LearningClient['getSession']>>['teachingProgress']
>;

type State = Readonly<{
  sessionId?: string;
  resourceVersion: number;
  writable: boolean;
  input: string;
  assistantMarkdown: string;
  assistantPending: boolean;
  opening: boolean;
  openingError: boolean;
  pendingUserMessage?:
    | Readonly<{
        id: string;
        markdown: string;
        status: 'submitting' | 'complete' | 'failed';
      }>
    | undefined;
  sendError?: string | undefined;
  taskId?: string | undefined;
  draftArtifactRef?: string | undefined;
  phase: 'starting' | 'ready' | 'generating' | 'stopped';
  progress: 'in_progress' | 'abandoned' | 'completed';
  activity: 'active' | 'paused';
  actualSeconds: number;
  reviewMarkdown?: string;
  stageReviewStatus?: 'generating' | 'failed' | 'ready' | undefined;
  reviewDismissed: boolean;
  supplementarySessionId?: string;
  supplementaryVersion?: number;
  supplementaryInput: string;
  messages: readonly SessionMessageView[];
  teachingProgress?: TeachingProgress;
  sessionSnapshotHash?: string;
  closurePreparation?: Readonly<{
    sessionId: string;
    sourceSessionIds: readonly string[];
    sourceMessageIds: readonly string[];
    messageRangeChecksum: string;
    endIntent: string;
  }>;
  closureTransactionId?: string;
  closureState?: string;
  closureError?: string;
}>;

type Action =
  | Readonly<{ type: 'started'; sessionId: string; resourceVersion: number; writable: boolean }>
  | Readonly<{ type: 'opening-started' }>
  | Readonly<{ type: 'opening-failed' }>
  | Readonly<{ type: 'opening-skipped' }>
  | Readonly<{
      type: 'hydrated';
      resourceVersion: number;
      progress: State['progress'];
      activity: State['activity'];
      reviewMarkdown?: string;
      messages?: readonly SessionMessageView[];
      actualSeconds?: number;
      sessionSnapshotHash?: string;
      closurePreparation?: State['closurePreparation'];
      teachingProgress?: TeachingProgress;
    }>
  | Readonly<{ type: 'input'; value: string }>
  | Readonly<{ type: 'send-started'; content: string; messageId: string }>
  | Readonly<{
      type: 'send-failed';
      content: string;
      requestAccepted: boolean;
    }>
  | Readonly<{ type: 'generating'; taskId: string; resourceVersion: number }>
  | Readonly<{ type: 'delta'; markdown: string }>
  | Readonly<{ type: 'completed' }>
  | Readonly<{ type: 'stopped'; draftArtifactRef: string; resourceVersion: number }>
  | Readonly<{ type: 'transferred'; resourceVersion: number }>
  | Readonly<{
      type: 'progress';
      progress: State['progress'];
      resourceVersion: number;
      stageReviewStatus?: State['stageReviewStatus'];
    }>
  | Readonly<{ type: 'activity'; activity: State['activity']; resourceVersion: number }>
  | Readonly<{ type: 'review'; markdown: string; resourceVersion: number }>
  | Readonly<{ type: 'review-dismissed' }>
  | Readonly<{ type: 'closure-requested' }>
  | Readonly<{ type: 'closure-request-failed'; error: string }>
  | Readonly<{
      type: 'closure';
      transactionId: string;
      state?: string;
      resourceVersion: number;
      error?: string;
    }>
  | Readonly<{ type: 'supplementary-started'; sessionId: string; resourceVersion: number }>
  | Readonly<{ type: 'supplementary-input'; value: string }>
  | Readonly<{ type: 'supplementary-sent'; resourceVersion: number }>
  | Readonly<{ type: 'tick' }>;

const initial: State = {
  resourceVersion: 0,
  writable: false,
  input: '',
  assistantMarkdown: '',
  assistantPending: false,
  opening: false,
  openingError: false,
  phase: 'starting',
  progress: 'in_progress',
  activity: 'active',
  actualSeconds: 0,
  reviewDismissed: false,
  supplementaryInput: '',
  messages: [],
};

function reducer(state: State, action: Action): State {
  if (action.type === 'started') {
    return {
      ...state,
      sessionId: action.sessionId,
      resourceVersion: action.resourceVersion,
      writable: action.writable,
      phase: 'ready',
    };
  }
  if (action.type === 'opening-started') {
    return {
      ...state,
      opening: true,
      openingError: false,
      phase: 'generating',
      assistantPending: true,
      sendError: undefined,
    };
  }
  if (action.type === 'opening-failed') {
    return {
      ...state,
      opening: false,
      openingError: true,
      phase: 'ready',
      assistantPending: false,
      taskId: undefined,
      sendError: undefined,
    };
  }
  if (action.type === 'opening-skipped') {
    return { ...state, opening: false, openingError: false, phase: 'ready' };
  }
  if (action.type === 'hydrated') {
    const pendingUserPersisted =
      state.pendingUserMessage !== undefined &&
      action.messages?.some(
        (message) =>
          message.role === 'user' && message.markdown === state.pendingUserMessage?.markdown,
      );
    return {
      ...state,
      resourceVersion: action.resourceVersion,
      progress: action.progress,
      activity: action.activity,
      ...(action.reviewMarkdown === undefined ? {} : { reviewMarkdown: action.reviewMarkdown }),
      ...(action.messages === undefined
        ? {}
        : { messages: action.messages, assistantMarkdown: '' }),
      ...(pendingUserPersisted ? { pendingUserMessage: undefined } : {}),
      ...(action.actualSeconds === undefined ? {} : { actualSeconds: action.actualSeconds }),
      ...(action.sessionSnapshotHash === undefined
        ? {}
        : { sessionSnapshotHash: action.sessionSnapshotHash }),
      ...(action.closurePreparation === undefined
        ? {}
        : { closurePreparation: action.closurePreparation }),
      ...(action.teachingProgress === undefined
        ? {}
        : { teachingProgress: action.teachingProgress }),
    };
  }
  if (action.type === 'input') return { ...state, input: action.value };
  if (action.type === 'review-dismissed') return { ...state, reviewDismissed: true };
  if (action.type === 'closure-requested') {
    const { closureError: _closureError, ...withoutClosureError } = state;
    void _closureError;
    return {
      ...withoutClosureError,
      writable: false,
      closureState: 'requesting',
    };
  }
  if (action.type === 'closure-request-failed') {
    return {
      ...state,
      writable: true,
      closureState: 'request-failed',
      closureError: action.error,
    };
  }
  if (action.type === 'send-started') {
    return {
      ...state,
      phase: 'generating',
      input: '',
      assistantMarkdown: '',
      assistantPending: true,
      pendingUserMessage: {
        id: action.messageId,
        markdown: action.content,
        status: 'submitting',
      },
      sendError: undefined,
      opening: false,
      openingError: false,
      taskId: undefined,
      draftArtifactRef: undefined,
    };
  }
  if (action.type === 'send-failed') {
    return {
      ...state,
      phase: 'ready',
      input: action.requestAccepted ? state.input : action.content,
      assistantPending: false,
      taskId: undefined,
      sendError: action.requestAccepted ? 'AI 回复生成中断，请重试。' : '消息发送失败，请重试。',
      pendingUserMessage:
        state.pendingUserMessage === undefined
          ? undefined
          : {
              ...state.pendingUserMessage,
              status: action.requestAccepted ? 'complete' : 'failed',
            },
    };
  }
  if (action.type === 'generating') {
    return {
      ...state,
      phase: 'generating',
      opening: state.opening,
      taskId: action.taskId,
      resourceVersion: action.resourceVersion,
      assistantPending: state.assistantMarkdown === '',
      pendingUserMessage:
        state.pendingUserMessage === undefined
          ? undefined
          : { ...state.pendingUserMessage, status: 'complete' },
    };
  }
  if (action.type === 'delta') {
    return {
      ...state,
      assistantMarkdown: state.assistantMarkdown + action.markdown,
      assistantPending: false,
    };
  }
  if (action.type === 'completed')
    return {
      ...state,
      opening: false,
      openingError: false,
      phase: state.draftArtifactRef === undefined ? 'ready' : 'stopped',
      assistantPending: false,
      ...(state.draftArtifactRef === undefined ? { pendingUserMessage: undefined } : {}),
      taskId: undefined,
    };
  if (action.type === 'stopped') {
    return {
      ...state,
      phase: 'stopped',
      assistantPending: false,
      draftArtifactRef: action.draftArtifactRef,
      resourceVersion: action.resourceVersion,
    };
  }
  if (action.type === 'transferred') {
    return { ...state, writable: true, resourceVersion: action.resourceVersion, phase: 'ready' };
  }
  if (action.type === 'progress') {
    return {
      ...state,
      progress: action.progress,
      resourceVersion: action.resourceVersion,
      stageReviewStatus:
        action.progress === 'abandoned'
          ? (action.stageReviewStatus ?? state.stageReviewStatus)
          : undefined,
    };
  }
  if (action.type === 'activity') {
    return { ...state, activity: action.activity, resourceVersion: action.resourceVersion };
  }
  if (action.type === 'supplementary-started') {
    return {
      ...state,
      supplementarySessionId: action.sessionId,
      supplementaryVersion: action.resourceVersion,
    };
  }
  if (action.type === 'supplementary-input') {
    return { ...state, supplementaryInput: action.value };
  }
  if (action.type === 'supplementary-sent') {
    return { ...state, supplementaryInput: '', supplementaryVersion: action.resourceVersion };
  }
  if (action.type === 'tick') return { ...state, actualSeconds: state.actualSeconds + 1 };
  if (action.type === 'closure') {
    return {
      ...state,
      closureTransactionId: action.transactionId,
      ...(action.state === undefined ? {} : { closureState: action.state }),
      resourceVersion: action.resourceVersion,
      ...(action.error === undefined ? {} : { closureError: action.error }),
    };
  }
  return {
    ...state,
    progress: 'completed',
    writable: false,
    closureState: 'completed',
    reviewMarkdown: action.markdown,
    reviewDismissed: false,
    resourceVersion: action.resourceVersion,
  };
}

function buildLessonPath(state: State, fallbackPoints: readonly string[]) {
  const teaching = state.teachingProgress;
  if (teaching === undefined) {
    const points = fallbackPoints.length === 0 ? ['当前知识点'] : fallbackPoints;
    return points.map((title, index) => ({
      title,
      detail:
        state.progress === 'completed' ? '该知识点已完成' : index === 0 ? '正在学习中' : '待讲解',
      state:
        state.progress === 'completed'
          ? ('done' as const)
          : index === 0
            ? ('active' as const)
            : ('pending' as const),
    }));
  }

  const completed = state.progress === 'completed';
  const phase = teaching.lessonPhase;
  const afterWarmup = phase !== 'warmup';
  const afterComprehensive = ['summary', 'ready_to_close'].includes(phase);
  const path = [
    {
      title: '课前热身',
      detail: completed || afterWarmup ? '已完成学习起点确认' : '正在连接目标与已有经验',
      state: completed || afterWarmup ? ('done' as const) : ('active' as const),
    },
    ...teaching.knowledgePoints.map((point) => {
      const active = point.progress === 'learning';
      if (point.progress === 'completed') {
        return {
          title: point.title,
          detail: point.interactionStatus === 'skipped' ? '跳过知识点互动' : '该知识点已完成',
          state: 'done' as const,
        };
      }
      if (point.progress === 'skipped') {
        return { title: point.title, detail: '跳过知识点', state: 'done' as const };
      }
      if (active) {
        return { title: point.title, detail: '正在学习中', state: 'active' as const };
      }
      return { title: point.title, detail: '待讲解', state: 'pending' as const };
    }),
    {
      title: '综合检测',
      detail:
        completed || afterComprehensive
          ? teaching.comprehensiveCheck === 'skipped'
            ? '跳过检测'
            : '综合检测已完成'
          : phase === 'comprehensive_check'
            ? '正在连接本课全部知识点'
            : '等待逐项学习完成',
      state:
        completed || afterComprehensive
          ? ('done' as const)
          : phase === 'comprehensive_check'
            ? ('active' as const)
            : ('pending' as const),
    },
    {
      title: '本课总结',
      detail:
        completed || phase === 'ready_to_close'
          ? '知识点总结已完成'
          : phase === 'summary'
            ? teaching.closureInquiry === 'awaiting_confirmation'
              ? '等待你确认是否还有疑问或讲解需求'
              : teaching.closureInquiry === 'confirmed_no_questions'
                ? 'AI 正在整理本课最终总结'
                : '正在进入课末疑问确认'
            : '等待综合检测完成',
      state:
        completed || phase === 'ready_to_close'
          ? ('done' as const)
          : phase === 'summary'
            ? ('active' as const)
            : ('pending' as const),
    },
  ];

  return path;
}

export function SessionPage(props: {
  readonly lessonId: string;
  readonly client?: LearningClient;
  readonly title?: string;
  readonly courseTitle?: string;
  readonly courseId?: string;
  readonly autoOpen?: boolean;
  readonly moduleLabel?: string;
  readonly outlineVersionLabel?: string;
  readonly knowledgePoints?: readonly string[];
  readonly onNavigate?: (path: string) => void;
}) {
  const api = props.client ?? learningClient;
  const [state, dispatch] = useReducer(reducer, initial);
  const inFlight = useRef(new Set<string>());
  const teachingRefreshes = useRef(new Set<string>());
  const [navigationError, setNavigationError] = useState<string>();

  const hydrate = (snapshot: Awaited<ReturnType<LearningClient['getSession']>>) => {
    dispatch({
      type: 'hydrated',
      resourceVersion: snapshot.resourceVersion,
      progress:
        snapshot.learning.progress === 'not_started' ? 'in_progress' : snapshot.learning.progress,
      activity: snapshot.learning.session?.state === 'paused' ? 'paused' : 'active',
      ...(snapshot.actualSeconds === undefined ? {} : { actualSeconds: snapshot.actualSeconds }),
      ...(snapshot.finalReview?.markdown === undefined
        ? {}
        : { reviewMarkdown: snapshot.finalReview.markdown }),
      ...(snapshot.messages === undefined ? {} : { messages: snapshot.messages }),
      ...(snapshot.sessionSnapshotHash === undefined
        ? {}
        : { sessionSnapshotHash: snapshot.sessionSnapshotHash }),
      ...(snapshot.closurePreparation === undefined
        ? {}
        : { closurePreparation: snapshot.closurePreparation }),
      ...(snapshot.teachingProgress === undefined
        ? {}
        : { teachingProgress: snapshot.teachingProgress }),
    });
  };

  const hydrateAndRefreshTeachingProgress = (
    sessionId: string,
    initialSnapshot: Awaited<ReturnType<LearningClient['getSession']>>,
  ) => {
    hydrate(initialSnapshot);
    if (
      initialSnapshot.teachingProgress?.observationStatus === 'pending' &&
      !teachingRefreshes.current.has(sessionId)
    ) {
      teachingRefreshes.current.add(sessionId);
      void (async () => {
        try {
          for (let attempt = 0; attempt < 120; attempt += 1) {
            await new Promise((resolve) => window.setTimeout(resolve, 1_000));
            const refreshed = await api.getSession(sessionId);
            hydrate(refreshed);
            if (refreshed.teachingProgress?.observationStatus !== 'pending') break;
          }
        } finally {
          teachingRefreshes.current.delete(sessionId);
        }
      })();
    }
    return initialSnapshot;
  };

  useEffect(() => {
    void api.start(props.lessonId).then(async (started) => {
      dispatch({
        type: 'started',
        sessionId: started.sessionId,
        resourceVersion: started.resourceVersion,
        writable: started.writable,
      });
      const initialSnapshot = await api.getSession(started.sessionId);
      const snapshot = hydrateAndRefreshTeachingProgress(started.sessionId, initialSnapshot);
      const activeTaskId = snapshot.learning.session?.activeGenerationTaskId;
      if (activeTaskId !== undefined) {
        dispatch({
          type: 'generating',
          taskId: activeTaskId,
          resourceVersion: snapshot.resourceVersion,
        });
        await api.stream(activeTaskId, (event) => {
          if (event.type === 'message.delta' && typeof event.data.markdown === 'string') {
            dispatch({ type: 'delta', markdown: event.data.markdown });
          }
        });
        const refreshed = await api.getSession(started.sessionId);
        hydrateAndRefreshTeachingProgress(started.sessionId, refreshed);
        dispatch({ type: 'completed' });
      } else if (
        props.autoOpen === true &&
        snapshot.learning.progress === 'in_progress' &&
        (snapshot.messages?.length ?? 0) === 0
      ) {
        await openOpening(started.sessionId, snapshot.resourceVersion);
      }
    });
  }, [api, props.autoOpen, props.lessonId]);

  useEffect(() => {
    if (
      state.activity !== 'active' ||
      state.phase === 'generating' ||
      state.closureState !== undefined ||
      state.progress !== 'in_progress'
    ) {
      return undefined;
    }
    const timer = window.setInterval(() => dispatch({ type: 'tick' }), 1_000);
    return () => window.clearInterval(timer);
  }, [state.activity, state.closureState, state.phase, state.progress]);

  useEffect(() => {
    if (state.closureTransactionId === undefined) return undefined;
    let cancelled = false;
    const poll = async () => {
      for (let attempt = 0; attempt < 300 && !cancelled; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
        if (cancelled) return;
        try {
          const result = await api.getClosure(state.closureTransactionId!);
          if (result.review?.markdown !== undefined && result.state === 'completed') {
            dispatch({
              type: 'review',
              markdown: result.review.markdown,
              resourceVersion: result.resourceVersion,
            });
            return;
          }
          dispatch({
            type: 'closure',
            transactionId: result.transactionId,
            ...(result.state === undefined ? {} : { state: result.state }),
            resourceVersion: result.resourceVersion,
          });
          if (result.state === 'generating-failed' || result.state === 'cancelled') return;
        } catch {
          // A transient read failure must not roll the lesson back to an active editing state.
        }
      }
    };
    void poll();
    return () => {
      cancelled = true;
    };
  }, [api, state.closureTransactionId]);

  const once = async (key: string, work: () => Promise<void>) => {
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    try {
      await work();
    } finally {
      inFlight.current.delete(key);
    }
  };

  const openOpening = (sessionId: string, resourceVersion: number) =>
    once('opening', async () => {
      dispatch({ type: 'opening-started' });
      try {
        const opening = await api.openLesson(sessionId, resourceVersion);
        let terminalFailure = false;
        dispatch({
          type: 'generating',
          taskId: opening.taskId,
          resourceVersion: opening.resourceVersion,
        });
        await api.stream(opening.taskId, (event) => {
          if (event.type === 'message.delta' && typeof event.data.markdown === 'string') {
            dispatch({ type: 'delta', markdown: event.data.markdown });
          }
          if (event.type === 'task.failed' || event.type === 'task.cancelled') {
            terminalFailure = true;
          }
        });
        if (terminalFailure) {
          throw new Error('lesson_opening_generation_failed');
        }
        const refreshed = await api.getSession(sessionId);
        if (!refreshed.messages?.some((message) => message.role === 'assistant')) {
          throw new Error('lesson_opening_content_missing');
        }
        hydrateAndRefreshTeachingProgress(sessionId, refreshed);
        dispatch({ type: 'completed' });
      } catch {
        try {
          const recovered = await api.getSession(sessionId);
          if (recovered.messages?.some((message) => message.role === 'assistant')) {
            hydrateAndRefreshTeachingProgress(sessionId, recovered);
            dispatch({ type: 'completed' });
            return;
          }
        } catch {
          // Keep the explicit opening retry state below when reconciliation also fails.
        }
        dispatch({ type: 'opening-failed' });
      }
    });

  const withLatestSessionVersion = async <T,>(
    work: (
      resourceVersion: number,
      refreshed?: Awaited<ReturnType<LearningClient['getSession']>>,
    ) => Promise<T>,
  ): Promise<T> => {
    try {
      return await work(state.resourceVersion);
    } catch (error) {
      if (
        state.sessionId === undefined ||
        typeof error !== 'object' ||
        error === null ||
        !('code' in error) ||
        error.code !== 'version_conflict'
      ) {
        throw error;
      }
      const refreshed = await api.getSession(state.sessionId);
      hydrateAndRefreshTeachingProgress(state.sessionId, refreshed);
      return work(refreshed.resourceVersion, refreshed);
    }
  };

  const send = () =>
    once('send', async () => {
      if (state.sessionId === undefined || state.input.trim() === '') return;
      const content = state.input.trim();
      dispatch({
        type: 'send-started',
        content,
        messageId: `local-session-${Date.now()}`,
      });
      let task: Awaited<ReturnType<LearningClient['sendMessage']>>;
      try {
        task = await withLatestSessionVersion((resourceVersion) =>
          api.sendMessage({
            sessionId: state.sessionId!,
            markdown: content,
            resourceVersion,
          }),
        );
      } catch {
        dispatch({ type: 'send-failed', content, requestAccepted: false });
        return;
      }
      dispatch({ type: 'generating', taskId: task.taskId, resourceVersion: task.resourceVersion });
      try {
        await api.stream(task.taskId, (event) => {
          if (event.type === 'message.delta' && typeof event.data.markdown === 'string') {
            dispatch({ type: 'delta', markdown: event.data.markdown });
          }
        });
      } catch {
        dispatch({ type: 'send-failed', content, requestAccepted: true });
        return;
      }
      const refreshed = await api.getSession(state.sessionId);
      hydrateAndRefreshTeachingProgress(state.sessionId, refreshed);
      dispatch({ type: 'completed' });
    });

  const retryOpening = () => {
    if (state.sessionId === undefined) return;
    void openOpening(state.sessionId, state.resourceVersion);
  };

  const stop = () =>
    once('stop', async () => {
      if (state.sessionId === undefined || state.taskId === undefined) return;
      const stopped = await withLatestSessionVersion((resourceVersion) =>
        api.stop({
          sessionId: state.sessionId!,
          taskId: state.taskId!,
          resourceVersion,
        }),
      );
      dispatch({
        type: 'stopped',
        draftArtifactRef: stopped.draftArtifactRef,
        resourceVersion: stopped.resourceVersion,
      });
    });

  const transfer = () =>
    once('transfer', async () => {
      if (state.sessionId === undefined) return;
      const result = await withLatestSessionVersion((resourceVersion) =>
        api.transferLease(state.sessionId!, resourceVersion),
      );
      dispatch({ type: 'transferred', resourceVersion: result.resourceVersion });
    });

  const pause = () =>
    once('pause', async () => {
      if (state.sessionId === undefined) return;
      const result = await withLatestSessionVersion((resourceVersion) =>
        api.pause(state.sessionId!, resourceVersion),
      );
      dispatch({ type: 'activity', activity: 'paused', resourceVersion: result.resourceVersion });
    });

  const resume = () =>
    once('resume', async () => {
      if (state.sessionId === undefined) return;
      const result = await withLatestSessionVersion((resourceVersion) =>
        api.resume(state.sessionId!, resourceVersion),
      );
      dispatch({ type: 'activity', activity: 'active', resourceVersion: result.resourceVersion });
    });

  const backToOutline = () =>
    once('back-to-outline', async () => {
      setNavigationError(undefined);
      if (
        state.sessionId !== undefined &&
        state.activity === 'active' &&
        state.progress === 'in_progress' &&
        state.writable
      ) {
        try {
          await pause();
        } catch {
          setNavigationError('课程暂停失败，请重试后再返回课程大纲。');
          return;
        }
      }
      props.onNavigate?.(props.courseId === undefined ? '/' : `/courses/${props.courseId}`);
    });

  useSessionWindowLifecycle({
    enabled: state.writable && state.sessionId !== undefined && state.progress === 'in_progress',
    pause: async () => {
      if (state.sessionId === undefined || state.activity !== 'active') return;
      const result = await withLatestSessionVersion((resourceVersion) =>
        api.pause(state.sessionId!, resourceVersion),
      );
      dispatch({ type: 'activity', activity: 'paused', resourceVersion: result.resourceVersion });
    },
    resume: async () => {
      if (state.sessionId === undefined || state.activity !== 'paused') return;
      const result = await withLatestSessionVersion((resourceVersion) =>
        api.resume(state.sessionId!, resourceVersion),
      );
      dispatch({ type: 'activity', activity: 'active', resourceVersion: result.resourceVersion });
    },
  });

  const abandon = () =>
    once('abandon', async () => {
      const result = await withLatestSessionVersion((resourceVersion, refreshed) =>
        api.abandon(
          props.lessonId,
          resourceVersion,
          refreshed?.sessionSnapshotHash ?? state.sessionSnapshotHash ?? '0'.repeat(64),
        ),
      );
      dispatch({
        type: 'progress',
        progress: result.progress === 'not_started' ? 'in_progress' : result.progress,
        resourceVersion: result.resourceVersion,
        stageReviewStatus: result.reviewStatus ?? 'generating',
      });
    });

  const restore = () =>
    once('restore', async () => {
      const result = await withLatestSessionVersion((resourceVersion) =>
        api.restore(props.lessonId, resourceVersion),
      );
      dispatch({
        type: 'progress',
        progress: result.progress === 'not_started' ? 'in_progress' : result.progress,
        resourceVersion: result.resourceVersion,
      });
    });

  const finish = () =>
    once('finish', async () => {
      if (state.closurePreparation === undefined) return;
      dispatch({ type: 'closure-requested' });
      try {
        const result = await withLatestSessionVersion((resourceVersion, refreshed) =>
          api.closeLesson(
            props.lessonId,
            resourceVersion,
            refreshed?.closurePreparation ?? state.closurePreparation!,
          ),
        );
        if (result.review?.markdown !== undefined) {
          dispatch({
            type: 'review',
            markdown: result.review.markdown,
            resourceVersion: result.resourceVersion,
          });
        } else {
          dispatch({
            type: 'closure',
            transactionId: result.transactionId,
            ...(result.state === undefined ? {} : { state: result.state }),
            resourceVersion: result.resourceVersion,
          });
        }
      } catch {
        dispatch({ type: 'closure-request-failed', error: '完成本课失败，请重试。' });
      }
    });

  const retryClosure = () =>
    once('retry-closure', async () => {
      if (state.closureTransactionId === undefined) return;
      dispatch({ type: 'closure-requested' });
      try {
        const result = await api.retryClosure(state.closureTransactionId, state.resourceVersion);
        dispatch({
          type: 'closure',
          transactionId: result.transactionId,
          ...(result.state === undefined ? {} : { state: result.state }),
          resourceVersion: result.resourceVersion,
        });
      } catch {
        dispatch({ type: 'closure-request-failed', error: '重试生成最终 Review 失败。' });
      }
    });

  const startSupplementary = () =>
    once('start-supplementary', async () => {
      const session = await api.startSupplementary(props.lessonId);
      dispatch({
        type: 'supplementary-started',
        sessionId: session.id,
        resourceVersion: session.resourceVersion,
      });
    });

  const sendSupplementary = (markdown = state.supplementaryInput) =>
    once('send-supplementary', async () => {
      if (
        state.supplementarySessionId === undefined ||
        state.supplementaryVersion === undefined ||
        markdown.trim() === ''
      )
        return;
      const session = await api.sendSupplementary(
        state.supplementarySessionId,
        markdown,
        state.supplementaryVersion,
      );
      dispatch({ type: 'supplementary-sent', resourceVersion: session.resourceVersion });
    });

  const lessonPath = buildLessonPath(state, props.knowledgePoints ?? []);
  const messages = [
    ...state.messages.map((message) => ({
      id: message.id,
      role: message.role,
      markdown: message.markdown,
    })),
    ...(state.pendingUserMessage === undefined
      ? []
      : [
          {
            id: state.pendingUserMessage.id,
            role: 'user' as const,
            markdown: state.pendingUserMessage.markdown,
            status: state.pendingUserMessage.status,
          },
        ]),
    ...(state.assistantMarkdown === ''
      ? []
      : [
          {
            id: 'streaming-assistant',
            role: 'assistant' as const,
            markdown: state.assistantMarkdown,
          },
        ]),
  ];

  return (
    <>
      <LessonSessionWorkspace
        abandoned={state.progress === 'abandoned'}
        assistantPending={state.assistantPending}
        canComplete={
          state.closurePreparation !== undefined &&
          (state.teachingProgress === undefined ||
            state.teachingProgress.lessonPhase === 'ready_to_close')
        }
        canStop={state.taskId !== undefined}
        courseTitle={props.courseTitle ?? '当前课程'}
        elapsedSeconds={state.actualSeconds}
        generating={state.phase === 'generating'}
        opening={state.opening}
        openingError={state.openingError}
        input={state.input}
        messages={messages}
        moduleLabel={props.moduleLabel ?? '正式课程课节'}
        outlineVersionLabel={props.outlineVersionLabel ?? '大纲 v1'}
        path={lessonPath}
        paused={state.activity === 'paused'}
        sendError={navigationError ?? state.sendError}
        stopped={state.draftArtifactRef !== undefined}
        title={props.title ?? '当前课节'}
        writable={state.writable && state.progress === 'in_progress'}
        onAbandon={() => void abandon()}
        onBackToOutline={backToOutline}
        onComplete={() => void finish()}
        onInput={(value) => dispatch({ type: 'input', value })}
        onPause={() => void pause()}
        onRestore={() => void restore()}
        onRetryOpening={retryOpening}
        onSkipOpening={() => dispatch({ type: 'opening-skipped' })}
        onResume={() => void resume()}
        onSend={() => void send()}
        onStop={() => void stop()}
        onTransfer={() => void transfer()}
      />
      {state.progress === 'abandoned' && state.stageReviewStatus === 'generating' ? (
        <div className="lesson-closure-status" role="status">
          本课已结束，阶段性 Review 正在生成中，可稍后返回课程页面查看。
        </div>
      ) : null}
      {state.progress === 'abandoned' && state.stageReviewStatus === 'failed' ? (
        <div className="lesson-closure-status" role="alert">
          本课已结束，但阶段性 Review 生成失败。课节档案与原始对话仍可正常查看。
        </div>
      ) : null}
      {state.draftArtifactRef === undefined ? null : (
        <p aria-label="生成停止状态" className="sr-only" role="status">
          生成已停止，未完成内容已安全保留。
        </p>
      )}
      {['requesting', 'open', 'generating', 'review-ready', 'committing'].includes(
        state.closureState ?? '',
      ) ? (
        <div className="lesson-closure-status" role="status">
          本课已结束，最终 Review 正在生成中，可稍后返回课程页面查看。
        </div>
      ) : null}
      {state.closureState === 'generating-failed' ? (
        <div className="lesson-closure-status" role="alert">
          <span>本课结束状态已保存，但最终 Review 生成失败。</span>
          <button className="lm-btn" type="button" onClick={() => void retryClosure()}>
            重试生成 Review
          </button>
        </div>
      ) : null}
      {state.closureState === 'request-failed' ? (
        <div className="lesson-closure-status" role="alert">
          {state.closureError ?? '完成本课失败，请重试。'}
        </div>
      ) : null}
      <ReviewDialog
        courseTitle={props.courseTitle ?? '当前课程'}
        markdown={state.reviewMarkdown ?? ''}
        open={state.reviewMarkdown !== undefined && !state.reviewDismissed}
        title={props.title ?? '当前课节'}
        onClose={() => dispatch({ type: 'review-dismissed' })}
        onBackToOutline={() =>
          props.onNavigate?.(props.courseId === undefined ? '/' : `/courses/${props.courseId}`)
        }
        onViewRecord={() =>
          props.onNavigate?.(
            props.courseId === undefined
              ? '#lesson-record'
              : `/courses/${props.courseId}/lessons/${props.lessonId}/record?tab=review`,
          )
        }
      />
      {state.progress === 'completed' &&
      (state.reviewMarkdown === undefined || state.reviewDismissed) ? (
        <section className="lesson-supplementary-controls">
          {state.supplementarySessionId === undefined ? (
            <button className="lm-btn" type="button" onClick={() => void startSupplementary()}>
              开始补充学习
            </button>
          ) : (
            <>
              <p>补充学习会话已独立创建</p>
              <ChatComposer
                label="补充学习输入"
                placeholder="继续追问或补充你的思考…"
                sendLabel="发送补充消息"
                value={state.supplementaryInput}
                onChange={(value) => dispatch({ type: 'supplementary-input', value })}
                onSubmit={(markdown) => void sendSupplementary(markdown)}
              />
            </>
          )}
        </section>
      ) : null}
    </>
  );
}
