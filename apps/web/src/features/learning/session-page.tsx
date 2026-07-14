import { useEffect, useReducer, useRef } from 'react';

import { learningClient, type LearningClient } from '../../client/learning-client.js';
import { ReviewDialog } from '../review/review-dialog.js';
import type { SessionMessageView } from './message-stream.js';
import { LessonSessionWorkspace } from './lesson-session-workspace.js';
import { useSessionWindowLifecycle } from './session-window-lifecycle.js';

type State = Readonly<{
  sessionId?: string;
  resourceVersion: number;
  writable: boolean;
  input: string;
  assistantMarkdown: string;
  assistantPending: boolean;
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
  reviewDismissed: boolean;
  supplementarySessionId?: string;
  supplementaryVersion?: number;
  supplementaryInput: string;
  messages: readonly SessionMessageView[];
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
  | Readonly<{ type: 'progress'; progress: State['progress']; resourceVersion: number }>
  | Readonly<{ type: 'activity'; activity: State['activity']; resourceVersion: number }>
  | Readonly<{ type: 'review'; markdown: string; resourceVersion: number }>
  | Readonly<{ type: 'review-dismissed' }>
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
    };
  }
  if (action.type === 'input') return { ...state, input: action.value };
  if (action.type === 'review-dismissed') return { ...state, reviewDismissed: true };
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
    return { ...state, progress: action.progress, resourceVersion: action.resourceVersion };
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
    reviewMarkdown: action.markdown,
    reviewDismissed: false,
    resourceVersion: action.resourceVersion,
  };
}

export function SessionPage(props: {
  readonly lessonId: string;
  readonly client?: LearningClient;
  readonly title?: string;
  readonly courseTitle?: string;
  readonly courseId?: string;
  readonly moduleLabel?: string;
  readonly outlineVersionLabel?: string;
  readonly knowledgePoints?: readonly string[];
  readonly onNavigate?: (path: string) => void;
}) {
  const api = props.client ?? learningClient;
  const [state, dispatch] = useReducer(reducer, initial);
  const inFlight = useRef(new Set<string>());

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
    });
  };

  useEffect(() => {
    void api.start(props.lessonId).then(async (started) => {
      dispatch({
        type: 'started',
        sessionId: started.sessionId,
        resourceVersion: started.resourceVersion,
        writable: started.writable,
      });
      const snapshot = await api.getSession(started.sessionId);
      hydrate(snapshot);
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
        hydrate(refreshed);
        dispatch({ type: 'completed' });
      }
    });
  }, [api, props.lessonId]);

  useEffect(() => {
    if (state.activity !== 'active' || state.progress !== 'in_progress') return undefined;
    const timer = window.setInterval(() => dispatch({ type: 'tick' }), 1_000);
    return () => window.clearInterval(timer);
  }, [state.activity, state.progress]);

  const once = async (key: string, work: () => Promise<void>) => {
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    try {
      await work();
    } finally {
      inFlight.current.delete(key);
    }
  };

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
      hydrate(refreshed);
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
      hydrate(refreshed);
      dispatch({ type: 'completed' });
    });

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
      if (state.sessionSnapshotHash === undefined) return;
      const result = await withLatestSessionVersion((resourceVersion, refreshed) =>
        api.abandon(
          props.lessonId,
          resourceVersion,
          refreshed?.sessionSnapshotHash ?? state.sessionSnapshotHash!,
        ),
      );
      dispatch({
        type: 'progress',
        progress: result.progress === 'not_started' ? 'in_progress' : result.progress,
        resourceVersion: result.resourceVersion,
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
    });

  const retryClosure = () =>
    once('retry-closure', async () => {
      if (state.closureTransactionId === undefined) return;
      const result = await api.retryClosure(state.closureTransactionId, state.resourceVersion);
      dispatch({
        type: 'closure',
        transactionId: result.transactionId,
        ...(result.state === undefined ? {} : { state: result.state }),
        resourceVersion: result.resourceVersion,
      });
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

  const sendSupplementary = () =>
    once('send-supplementary', async () => {
      if (
        state.supplementarySessionId === undefined ||
        state.supplementaryVersion === undefined ||
        state.supplementaryInput.trim() === ''
      )
        return;
      const session = await api.sendSupplementary(
        state.supplementarySessionId,
        state.supplementaryInput,
        state.supplementaryVersion,
      );
      dispatch({ type: 'supplementary-sent', resourceVersion: session.resourceVersion });
    });

  const pathPoints = (props.knowledgePoints ?? []).slice(0, 4);
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
        canComplete={state.closurePreparation !== undefined}
        canStop={state.taskId !== undefined}
        courseTitle={props.courseTitle ?? '当前课程'}
        elapsedSeconds={state.actualSeconds}
        generating={state.phase === 'generating'}
        input={state.input}
        messages={messages}
        moduleLabel={props.moduleLabel ?? '正式课程课节'}
        outlineVersionLabel={props.outlineVersionLabel ?? '大纲 v1'}
        path={(pathPoints.length === 0 ? ['当前知识点'] : pathPoints).map((point, index) => ({
          title: point,
          detail: index === 0 ? '正在建立判断' : '等待继续推进',
          state: index === 0 ? 'active' : 'pending',
        }))}
        paused={state.activity === 'paused'}
        sendError={state.sendError}
        stopped={state.draftArtifactRef !== undefined}
        title={props.title ?? '当前课节'}
        writable={state.writable && state.progress === 'in_progress'}
        onAbandon={() => void abandon()}
        onBackToOutline={() =>
          props.onNavigate?.(props.courseId === undefined ? '/' : `/courses/${props.courseId}`)
        }
        onComplete={() => void finish()}
        onInput={(value) => dispatch({ type: 'input', value })}
        onPause={() => void pause()}
        onRestore={() => void restore()}
        onResume={() => void resume()}
        onSend={() => void send()}
        onStop={() => void stop()}
        onTransfer={() => void transfer()}
      />
      {state.draftArtifactRef === undefined ? null : (
        <p aria-label="生成停止状态" className="sr-only" role="status">
          生成已停止，未完成内容已安全保留。
        </p>
      )}
      {state.closureTransactionId === undefined ? null : (
        <div className="lesson-closure-status" role="status">
          <span>课时 Review 状态：{state.closureState ?? '处理中'}</span>
          {state.closureState === 'generating-failed' ? (
            <button className="lm-btn" type="button" onClick={() => void retryClosure()}>
              重试生成 Review
            </button>
          ) : null}
        </div>
      )}
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
              <label htmlFor="supplementary-learning-input">补充学习输入</label>
              <textarea
                id="supplementary-learning-input"
                value={state.supplementaryInput}
                onChange={(event) =>
                  dispatch({ type: 'supplementary-input', value: event.target.value })
                }
              />
              <button className="lm-btn" type="button" onClick={() => void sendSupplementary()}>
                发送补充消息
              </button>
            </>
          )}
        </section>
      ) : null}
    </>
  );
}
