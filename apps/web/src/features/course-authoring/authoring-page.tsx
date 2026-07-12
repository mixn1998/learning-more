import { useEffect, useMemo, useReducer, useRef } from 'react';

import { COURSE_MODES, type CourseMode } from '@learning-more/contracts';

import {
  courseAuthoringClient,
  type AuthoringStreamEvent,
  type CourseAuthoringClient,
} from '../../client/course-authoring-client.js';
import { AssessmentPanel } from './assessment-panel.js';
import { CandidatePanel } from './candidate-panel.js';
import { ConfirmDialog } from './confirm-dialog.js';

type Phase =
  | 'empty'
  | 'creating'
  | 'assessing'
  | 'ready'
  | 'generating'
  | 'candidate-ready'
  | 'generation-failed'
  | 'version-conflict'
  | 'confirming'
  | 'confirmed';

type State = Readonly<{
  phase: Phase;
  topic: string;
  courseMode: CourseMode;
  assessment: string;
  outlineSessionId?: string;
  resourceVersion?: number;
  candidateMarkdown: string;
  candidateVersionId?: string;
  confirmedCourseId?: string;
  draftArtifactRef?: string;
  confirmOpen: boolean;
}>;

type Action =
  | Readonly<{ type: 'edit-topic'; value: string }>
  | Readonly<{ type: 'select-mode'; value: CourseMode }>
  | Readonly<{ type: 'edit-assessment'; value: string }>
  | Readonly<{ type: 'creating' }>
  | Readonly<{
      type: 'session-loaded';
      outlineSessionId: string;
      resourceVersion: number;
      state: string;
      candidateMarkdown?: string;
      candidateVersionId?: string;
      confirmedCourseId?: string;
    }>
  | Readonly<{ type: 'generating'; resourceVersion: number; draftArtifactRef?: string }>
  | Readonly<{ type: 'generation-failed'; resourceVersion: number; draftArtifactRef?: string }>
  | Readonly<{ type: 'stream-event'; event: AuthoringStreamEvent }>
  | Readonly<{ type: 'version-conflict' }>
  | Readonly<{ type: 'open-confirm'; open: boolean }>
  | Readonly<{ type: 'confirming' }>
  | Readonly<{ type: 'confirmed'; resourceVersion: number; courseId: string }>;

const initialState: State = {
  phase: 'empty',
  topic: '',
  courseMode: 'standard',
  assessment: '',
  candidateMarkdown: '',
  confirmOpen: false,
};

function phaseFromServer(state: string): Phase {
  if (state === 'assessing' || state === 'collecting-input') return 'assessing';
  if (state === 'candidate-ready') return 'candidate-ready';
  if (state === 'confirmed') return 'confirmed';
  return 'ready';
}

export function authoringReducer(state: State, action: Action): State {
  switch (action.type) {
    case 'edit-topic':
      return { ...state, topic: action.value };
    case 'select-mode':
      return { ...state, courseMode: action.value };
    case 'edit-assessment':
      return { ...state, assessment: action.value };
    case 'creating':
      return { ...state, phase: 'creating' };
    case 'session-loaded':
      return {
        ...state,
        phase: phaseFromServer(action.state),
        outlineSessionId: action.outlineSessionId,
        resourceVersion: action.resourceVersion,
        ...(action.candidateMarkdown === undefined
          ? {}
          : { candidateMarkdown: action.candidateMarkdown }),
        ...(action.candidateVersionId === undefined
          ? {}
          : { candidateVersionId: action.candidateVersionId }),
        ...(action.confirmedCourseId === undefined
          ? {}
          : { confirmedCourseId: action.confirmedCourseId }),
      };
    case 'generating':
      return {
        ...state,
        phase: 'generating',
        resourceVersion: action.resourceVersion,
        candidateMarkdown: '',
        ...(action.draftArtifactRef === undefined
          ? {}
          : { draftArtifactRef: action.draftArtifactRef }),
      };
    case 'generation-failed':
      return {
        ...state,
        phase: 'generation-failed',
        resourceVersion: action.resourceVersion,
        ...(action.draftArtifactRef === undefined
          ? {}
          : { draftArtifactRef: action.draftArtifactRef }),
      };
    case 'stream-event': {
      if (action.event.type === 'message.delta') {
        const markdown = action.event.data.markdown;
        return typeof markdown === 'string'
          ? { ...state, candidateMarkdown: state.candidateMarkdown + markdown }
          : state;
      }
      if (action.event.type === 'artifact.ready') {
        const artifactId = action.event.data.artifactId;
        return typeof artifactId === 'string'
          ? { ...state, candidateVersionId: artifactId }
          : state;
      }
      if (action.event.type === 'task.completed') return { ...state, phase: 'candidate-ready' };
      if (action.event.type === 'task.failed') return { ...state, phase: 'generation-failed' };
      return state;
    }
    case 'version-conflict':
      return { ...state, phase: 'version-conflict' };
    case 'open-confirm':
      return { ...state, confirmOpen: action.open };
    case 'confirming':
      return { ...state, phase: 'confirming' };
    case 'confirmed':
      return {
        ...state,
        phase: 'confirmed',
        confirmOpen: false,
        resourceVersion: action.resourceVersion,
        confirmedCourseId: action.courseId,
      };
  }
}

function pageInstanceId(): string {
  const key = 'learning-more.page-instance-id';
  const existing = sessionStorage.getItem(key);
  if (existing !== null) return existing;
  const created = crypto.randomUUID();
  sessionStorage.setItem(key, created);
  return created;
}

export function AuthoringPage(props: {
  readonly client?: CourseAuthoringClient;
  readonly initialOutlineSessionId?: string;
  readonly onNavigate?: (path: string) => void;
  readonly onSessionChanged?: (outlineSessionId: string) => void;
}) {
  const api = props.client ?? courseAuthoringClient;
  const instanceId = useMemo(pageInstanceId, []);
  const draftKey = `learning-more.authoring-draft.${instanceId}`;
  const savedDraft = useMemo(() => {
    try {
      return JSON.parse(sessionStorage.getItem(draftKey) ?? '{}') as Partial<State>;
    } catch {
      return {};
    }
  }, [draftKey]);
  const [state, dispatch] = useReducer(authoringReducer, { ...initialState, ...savedDraft });
  const inFlight = useRef(new Set<string>());

  useEffect(() => {
    sessionStorage.setItem(
      draftKey,
      JSON.stringify({
        topic: state.topic,
        courseMode: state.courseMode,
        assessment: state.assessment,
        outlineSessionId: state.outlineSessionId,
      }),
    );
  }, [draftKey, state.assessment, state.courseMode, state.outlineSessionId, state.topic]);

  const loadSession = async (outlineSessionId: string) => {
    const view = await api.getOutlineSession(outlineSessionId);
    dispatch({
      type: 'session-loaded',
      outlineSessionId: view.outlineSessionId,
      resourceVersion: view.resourceVersion,
      state: view.state,
      ...(typeof view.candidateMarkdown === 'string'
        ? { candidateMarkdown: view.candidateMarkdown }
        : {}),
      ...(typeof view.candidateVersionId === 'string'
        ? { candidateVersionId: view.candidateVersionId }
        : {}),
      ...(typeof view.confirmedCourseId === 'string'
        ? { confirmedCourseId: view.confirmedCourseId }
        : {}),
    });
  };

  useEffect(() => {
    if (props.initialOutlineSessionId !== undefined)
      void loadSession(props.initialOutlineSessionId);
  }, [props.initialOutlineSessionId]);

  const once = async (key: string, work: () => Promise<void>) => {
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    try {
      await work();
    } finally {
      inFlight.current.delete(key);
    }
  };

  const create = () =>
    once('create', async () => {
      dispatch({ type: 'creating' });
      const session = await api.createOutlineSession({
        topic: state.topic,
        courseMode: state.courseMode,
        pageInstanceId: instanceId,
      });
      dispatch({
        type: 'session-loaded',
        outlineSessionId: session.outlineSessionId,
        resourceVersion: session.resourceVersion,
        state: session.state,
      });
      props.onSessionChanged?.(session.outlineSessionId);
    });

  const completeAssessment = () =>
    once('assessment', async () => {
      if (state.outlineSessionId === undefined || state.resourceVersion === undefined) return;
      try {
        const session = await api.appendMessage({
          outlineSessionId: state.outlineSessionId,
          content: state.assessment,
          resourceVersion: state.resourceVersion,
          pageInstanceId: instanceId,
        });
        dispatch({
          type: 'session-loaded',
          outlineSessionId: session.outlineSessionId,
          resourceVersion: session.resourceVersion,
          state: session.state,
        });
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'version_conflict'
        )
          dispatch({ type: 'version-conflict' });
        else throw error;
      }
    });

  const generate = () =>
    once('generation', async () => {
      if (state.outlineSessionId === undefined || state.resourceVersion === undefined) return;
      const accepted = await api.requestCandidateGeneration({
        outlineSessionId: state.outlineSessionId,
        resourceVersion: state.resourceVersion,
        pageInstanceId: instanceId,
      });
      if (accepted.state === 'failed_recoverable') {
        dispatch({
          type: 'generation-failed',
          resourceVersion: accepted.resourceVersion,
          ...(accepted.draftArtifactRef === undefined
            ? {}
            : { draftArtifactRef: accepted.draftArtifactRef }),
        });
        return;
      }
      dispatch({
        type: 'generating',
        resourceVersion: accepted.resourceVersion,
        ...(accepted.draftArtifactRef === undefined
          ? {}
          : { draftArtifactRef: accepted.draftArtifactRef }),
      });
      await api.streamGeneration(accepted.taskId, {
        onEvent: (event) => dispatch({ type: 'stream-event', event }),
      });
    });

  const confirm = () =>
    once('confirmation', async () => {
      if (
        state.outlineSessionId === undefined ||
        state.resourceVersion === undefined ||
        state.candidateVersionId === undefined
      )
        return;
      dispatch({ type: 'confirming' });
      const result = await api.confirmCandidate({
        outlineSessionId: state.outlineSessionId,
        candidateVersionId: state.candidateVersionId,
        resourceVersion: state.resourceVersion,
        pageInstanceId: instanceId,
      });
      dispatch({
        type: 'confirmed',
        resourceVersion: result.resourceVersion,
        courseId: result.courseId,
      });
      props.onNavigate?.(`/courses/${result.courseId}`);
    });

  return (
    <main className="authoring-workspace">
      <header>
        <p className="eyebrow">CourseAuthoring</p>
        <h1>创建课程</h1>
      </header>
      {state.phase === 'empty' || state.phase === 'creating' ? (
        <section className="authoring-panel">
          <label>
            学习主题
            <input
              value={state.topic}
              onChange={(event) => dispatch({ type: 'edit-topic', value: event.target.value })}
            />
          </label>
          <fieldset>
            <legend>课程模式</legend>
            {COURSE_MODES.map((mode) => (
              <label key={mode}>
                <input
                  type="radio"
                  name="course-mode"
                  value={mode}
                  checked={state.courseMode === mode}
                  onChange={() => dispatch({ type: 'select-mode', value: mode })}
                />
                {mode}
              </label>
            ))}
          </fieldset>
          <button
            type="button"
            disabled={state.phase === 'creating' || state.topic.trim() === ''}
            onClick={() => void create()}
          >
            开始创建
          </button>
        </section>
      ) : null}
      {state.phase === 'assessing' ? (
        <AssessmentPanel
          value={state.assessment}
          busy={inFlight.current.has('assessment')}
          onChange={(value) => dispatch({ type: 'edit-assessment', value })}
          onComplete={() => void completeAssessment()}
        />
      ) : null}
      {state.phase === 'version-conflict' ? (
        <section className="authoring-panel">
          <p role="alert">服务端版本已更新，你的输入仍保留。</p>
          <textarea
            aria-label="补充需求"
            value={state.assessment}
            onChange={(event) => dispatch({ type: 'edit-assessment', value: event.target.value })}
          />
          <button
            type="button"
            onClick={() =>
              state.outlineSessionId === undefined
                ? undefined
                : void loadSession(state.outlineSessionId)
            }
          >
            重新加载
          </button>
        </section>
      ) : null}
      {state.phase === 'ready' ? (
        <section className="authoring-panel">
          <button type="button" onClick={() => void generate()}>
            生成候选大纲
          </button>
        </section>
      ) : null}
      {['generating', 'candidate-ready', 'generation-failed', 'confirmed'].includes(state.phase) ? (
        <CandidatePanel
          markdown={state.candidateMarkdown}
          state={
            state.phase === 'generating'
              ? 'generating'
              : state.phase === 'candidate-ready'
                ? 'ready'
                : state.phase === 'confirmed'
                  ? 'confirmed'
                  : 'failed'
          }
          {...(state.draftArtifactRef === undefined
            ? {}
            : { draftArtifactRef: state.draftArtifactRef })}
          onGenerate={() => void generate()}
          onConfirm={() => dispatch({ type: 'open-confirm', open: true })}
        />
      ) : null}
      {state.confirmedCourseId === undefined ? null : (
        <p>
          正式课程：<a href={`/courses/${state.confirmedCourseId}`}>{state.confirmedCourseId}</a>
        </p>
      )}
      <ConfirmDialog
        open={state.confirmOpen}
        busy={state.phase === 'confirming'}
        onCancel={() => dispatch({ type: 'open-confirm', open: false })}
        onConfirm={() => void confirm()}
      />
    </main>
  );
}
