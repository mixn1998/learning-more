import { useEffect, useReducer, useRef } from 'react';

import { learningClient, type LearningClient } from '../../client/learning-client.js';
import { ReviewDialog } from '../review/review-dialog.js';
import { MessageStream } from './message-stream.js';
import { SessionControls } from './session-controls.js';

type State = Readonly<{
  sessionId?: string;
  resourceVersion: number;
  writable: boolean;
  input: string;
  assistantMarkdown: string;
  taskId?: string;
  draftArtifactRef?: string;
  phase: 'starting' | 'ready' | 'generating' | 'stopped';
  progress: 'in_progress' | 'abandoned' | 'completed';
  activity: 'active' | 'paused';
  reviewMarkdown?: string;
  supplementarySessionId?: string;
  supplementaryVersion?: number;
  supplementaryInput: string;
}>;

type Action =
  | Readonly<{ type: 'started'; sessionId: string; resourceVersion: number; writable: boolean }>
  | Readonly<{
      type: 'hydrated';
      resourceVersion: number;
      progress: State['progress'];
      activity: State['activity'];
      reviewMarkdown?: string;
    }>
  | Readonly<{ type: 'input'; value: string }>
  | Readonly<{ type: 'generating'; taskId: string; resourceVersion: number }>
  | Readonly<{ type: 'delta'; markdown: string }>
  | Readonly<{ type: 'completed' }>
  | Readonly<{ type: 'stopped'; draftArtifactRef: string; resourceVersion: number }>
  | Readonly<{ type: 'transferred'; resourceVersion: number }>
  | Readonly<{ type: 'progress'; progress: State['progress']; resourceVersion: number }>
  | Readonly<{ type: 'activity'; activity: State['activity']; resourceVersion: number }>
  | Readonly<{ type: 'review'; markdown: string; resourceVersion: number }>
  | Readonly<{ type: 'supplementary-started'; sessionId: string; resourceVersion: number }>
  | Readonly<{ type: 'supplementary-input'; value: string }>
  | Readonly<{ type: 'supplementary-sent'; resourceVersion: number }>;

const initial: State = {
  resourceVersion: 0,
  writable: false,
  input: '',
  assistantMarkdown: '',
  phase: 'starting',
  progress: 'in_progress',
  activity: 'active',
  supplementaryInput: '',
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
    return {
      ...state,
      resourceVersion: action.resourceVersion,
      progress: action.progress,
      activity: action.activity,
      ...(action.reviewMarkdown === undefined ? {} : { reviewMarkdown: action.reviewMarkdown }),
    };
  }
  if (action.type === 'input') return { ...state, input: action.value };
  if (action.type === 'generating') {
    return {
      ...state,
      phase: 'generating',
      taskId: action.taskId,
      resourceVersion: action.resourceVersion,
    };
  }
  if (action.type === 'delta') {
    return { ...state, assistantMarkdown: state.assistantMarkdown + action.markdown };
  }
  if (action.type === 'completed') return { ...state, phase: 'ready' };
  if (action.type === 'stopped') {
    return {
      ...state,
      phase: 'stopped',
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
  return {
    ...state,
    progress: 'completed',
    reviewMarkdown: action.markdown,
    resourceVersion: action.resourceVersion,
  };
}

export function SessionPage(props: {
  readonly lessonId: string;
  readonly client?: LearningClient;
}) {
  const api = props.client ?? learningClient;
  const [state, dispatch] = useReducer(reducer, initial);
  const inFlight = useRef(new Set<string>());

  useEffect(() => {
    void api.start(props.lessonId).then(async (started) => {
      dispatch({
        type: 'started',
        sessionId: started.sessionId,
        resourceVersion: started.resourceVersion,
        writable: started.writable,
      });
      const snapshot = await api.getSession(started.sessionId);
      dispatch({
        type: 'hydrated',
        resourceVersion: snapshot.resourceVersion,
        progress:
          snapshot.learning.progress === 'not_started' ? 'in_progress' : snapshot.learning.progress,
        activity: snapshot.learning.session?.state === 'paused' ? 'paused' : 'active',
        ...(snapshot.finalReview?.markdown === undefined
          ? {}
          : { reviewMarkdown: snapshot.finalReview.markdown }),
      });
    });
  }, [api, props.lessonId]);

  const once = async (key: string, work: () => Promise<void>) => {
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    try {
      await work();
    } finally {
      inFlight.current.delete(key);
    }
  };

  const send = () =>
    once('send', async () => {
      if (state.sessionId === undefined || state.input.trim() === '') return;
      const task = await api.sendMessage({
        sessionId: state.sessionId,
        markdown: state.input,
        establishesEvidence: true,
        resourceVersion: state.resourceVersion,
      });
      dispatch({ type: 'generating', taskId: task.taskId, resourceVersion: task.resourceVersion });
      await api.stream(task.taskId, (event) => {
        if (event.type === 'message.delta' && typeof event.data.markdown === 'string') {
          dispatch({ type: 'delta', markdown: event.data.markdown });
        }
      });
      const refreshed = await api.getSession(state.sessionId);
      dispatch({
        type: 'progress',
        progress: 'in_progress',
        resourceVersion: refreshed.resourceVersion,
      });
      dispatch({ type: 'completed' });
    });

  const stop = () =>
    once('stop', async () => {
      if (state.sessionId === undefined || state.taskId === undefined) return;
      const stopped = await api.stop({
        sessionId: state.sessionId,
        taskId: state.taskId,
        resourceVersion: state.resourceVersion,
      });
      dispatch({
        type: 'stopped',
        draftArtifactRef: stopped.draftArtifactRef,
        resourceVersion: stopped.resourceVersion,
      });
    });

  const transfer = () =>
    once('transfer', async () => {
      if (state.sessionId === undefined) return;
      const result = await api.transferLease(state.sessionId, state.resourceVersion);
      dispatch({ type: 'transferred', resourceVersion: result.resourceVersion });
    });

  const pause = () =>
    once('pause', async () => {
      if (state.sessionId === undefined) return;
      const result = (await api.pause(state.sessionId, state.resourceVersion)) as {
        resourceVersion: number;
      };
      dispatch({ type: 'activity', activity: 'paused', resourceVersion: result.resourceVersion });
    });

  const resume = () =>
    once('resume', async () => {
      if (state.sessionId === undefined) return;
      const result = (await api.resume(state.sessionId, state.resourceVersion)) as {
        resourceVersion: number;
      };
      dispatch({ type: 'activity', activity: 'active', resourceVersion: result.resourceVersion });
    });

  const abandon = () =>
    once('abandon', async () => {
      const result = (await api.abandon(props.lessonId, state.resourceVersion, 'a'.repeat(64))) as {
        progress: State['progress'];
        resourceVersion: number;
      };
      dispatch({
        type: 'progress',
        progress: result.progress,
        resourceVersion: result.resourceVersion,
      });
    });

  const restore = () =>
    once('restore', async () => {
      const result = (await api.restore(props.lessonId, state.resourceVersion)) as {
        progress: State['progress'];
        resourceVersion: number;
      };
      dispatch({
        type: 'progress',
        progress: result.progress,
        resourceVersion: result.resourceVersion,
      });
    });

  const finish = () =>
    once('finish', async () => {
      if (state.sessionId === undefined) return;
      const result = (await api.closeLesson(props.lessonId, state.resourceVersion, {
        sessionId: state.sessionId,
        sourceSessionIds: [state.sessionId],
        sourceMessageIds: ['message_committed'],
        messageRangeChecksum: 'a'.repeat(64),
        endIntent: 'finish lesson',
      })) as {
        resourceVersion: number;
        review?: { markdown?: string };
      };
      dispatch({
        type: 'review',
        markdown: result.review?.markdown ?? '# Final Review',
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

  return (
    <main className="authoring-workspace">
      <h1>课节学习</h1>
      <MessageStream assistantMarkdown={state.assistantMarkdown} />
      <section className="authoring-panel">
        <label>
          学习输入
          <textarea
            value={state.input}
            disabled={
              !state.writable || state.progress !== 'in_progress' || state.activity !== 'active'
            }
            onChange={(event) => dispatch({ type: 'input', value: event.target.value })}
          />
        </label>
        <button
          type="button"
          disabled={
            !state.writable || state.progress !== 'in_progress' || state.activity !== 'active'
          }
          onClick={() => void send()}
        >
          发送
        </button>
        {state.draftArtifactRef === undefined ? null : <code>{state.draftArtifactRef}</code>}
        <SessionControls
          generating={state.phase === 'generating'}
          writable={state.writable}
          abandoned={state.progress === 'abandoned'}
          paused={state.activity === 'paused'}
          onStop={() => void stop()}
          onTransfer={() => void transfer()}
          onPause={() => void pause()}
          onResume={() => void resume()}
          onAbandon={() => void abandon()}
          onRestore={() => void restore()}
          onFinish={() => void finish()}
        />
      </section>
      <ReviewDialog
        markdown={state.reviewMarkdown ?? ''}
        open={state.reviewMarkdown !== undefined}
      />
      {state.progress === 'completed' ? (
        state.supplementarySessionId === undefined ? (
          <button type="button" onClick={() => void startSupplementary()}>
            开始补充学习
          </button>
        ) : (
          <section className="authoring-panel">
            <p>补充学习会话已独立创建</p>
            <label>
              补充学习输入
              <textarea
                value={state.supplementaryInput}
                onChange={(event) =>
                  dispatch({ type: 'supplementary-input', value: event.target.value })
                }
              />
            </label>
            <button type="button" onClick={() => void sendSupplementary()}>
              发送补充消息
            </button>
          </section>
        )
      ) : null}
    </main>
  );
}
