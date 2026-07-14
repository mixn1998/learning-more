import { useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { Button, ContentState, Page, SectionHeader } from '@learning-more/ui';

import type { CandidateGenerationFailureCode, CourseMode } from '@learning-more/contracts';

import {
  courseAuthoringClient,
  type AuthoringStreamEvent,
  type CourseAuthoringClient,
  type OutlineSessionView,
} from '../../client/course-authoring-client.js';
import { useAppShellHeaderStatus } from '../../state/app-shell-header.js';
import type { AuthoringStartIntent } from '../../state/authoring-start-intent.js';
import { getPageInstanceId } from '../../state/page-instance.js';
import { useCourseModeTheme } from '../../use-course-mode-theme.js';
import { createAuthoringWorkspaceData } from './authoring-workspace-model.js';
import {
  candidateGenerationFailureFromEvent,
  candidateGenerationFailurePresentation,
} from './candidate-generation-failure.js';
import { ConfirmDialog } from './confirm-dialog.js';
import { DeleteDraftDialog } from './delete-draft-dialog.js';
import { CourseModeSelector } from './course-mode-selector.js';
import { OutlineWorkspaceView } from './outline-workspace-view.js';

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

type RestoreStatus = 'idle' | 'loading' | 'failed';

type State = Readonly<{
  phase: Phase;
  topic: string;
  courseMode: CourseMode;
  assessment: string;
  completedAssessmentRounds: number;
  canGenerateCandidate: boolean;
  messages: readonly Readonly<{
    messageId: string;
    role: 'user' | 'assistant';
    content: string;
    status: 'submitting' | 'complete' | 'failed';
    createdAt: string;
    inReplyToMessageId?: string | undefined;
  }>[];
  assistantPending: boolean;
  turnError?: string | undefined;
  outlineSessionId?: string;
  resourceVersion?: number;
  savedAsDraft?: boolean;
  candidateMarkdown: string;
  generationTaskId?: string | undefined;
  candidateVersionId?: string;
  confirmedCourseId?: string;
  draftArtifactRef?: string;
  generationFailureCode?: CandidateGenerationFailureCode | undefined;
  confirmOpen: boolean;
  materials: readonly Readonly<{
    artifactRef: string;
    originalFileName: string;
    format: 'markdown' | 'text' | 'pdf';
    importedAt: string;
    sections: readonly string[];
    warnings: readonly string[];
  }>[];
}>;

type Action =
  | Readonly<{ type: 'edit-topic'; value: string }>
  | Readonly<{ type: 'select-mode'; value: CourseMode }>
  | Readonly<{ type: 'edit-assessment'; value: string }>
  | Readonly<{
      type: 'creating';
      content: string;
      messageId: string;
      createdAt: string;
    }>
  | Readonly<{
      type: 'assessment-submitted';
      content: string;
      messageId: string;
      createdAt: string;
    }>
  | Readonly<{
      type: 'turn-failed';
      content: string;
      versionConflict: boolean;
      restoreComposer: boolean;
    }>
  | Readonly<{
      type: 'session-loaded';
      outlineSessionId: string;
      resourceVersion: number;
      state: string;
      topic?: string;
      courseMode?: CourseMode;
      generationTaskId?: string;
      candidateMarkdown?: string;
      candidateVersionId?: string;
      confirmedCourseId?: string;
      materials?: State['materials'];
      completedAssessmentRounds?: number;
      canGenerateCandidate?: boolean;
      messages?: State['messages'];
      savedAsDraft?: boolean;
    }>
  | Readonly<{ type: 'draft-saved'; resourceVersion: number }>
  | Readonly<{ type: 'generation-requested' }>
  | Readonly<{
      type: 'generating';
      taskId: string;
      resourceVersion: number;
      draftArtifactRef?: string;
    }>
  | Readonly<{
      type: 'generation-failed';
      resourceVersion: number;
      failureCode: CandidateGenerationFailureCode;
      draftArtifactRef?: string;
    }>
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
  completedAssessmentRounds: 0,
  canGenerateCandidate: false,
  messages: [],
  assistantPending: false,
  candidateMarkdown: '',
  confirmOpen: false,
  materials: [],
};

function phaseFromServer(state: string): Phase {
  if (state === 'assessing' || state === 'assessment-turn-running' || state === 'collecting-input')
    return 'assessing';
  if (state === 'assessment-ready') return 'ready';
  if (state === 'generating-candidates') return 'generating';
  if (state === 'candidate-ready') return 'candidate-ready';
  if (state === 'confirming') return 'confirming';
  if (state === 'confirmed') return 'confirmed';
  return 'ready';
}

function workspacePrimaryLabel(phase: Phase): string {
  if (phase === 'creating') return '正在创建…';
  if (phase === 'ready') return '生成候选大纲';
  if (phase === 'generating') return '正在生成…';
  if (phase === 'candidate-ready') return '确认此候选';
  if (phase === 'generation-failed') return '重试生成';
  if (phase === 'confirming') return '正在创建…';
  if (phase === 'confirmed') return '查看正式课程';
  return '完成起点评估后生成';
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
      return {
        ...state,
        phase: 'creating',
        assistantPending: true,
        turnError: undefined,
        messages: [
          ...state.messages,
          {
            messageId: action.messageId,
            role: 'user',
            content: action.content,
            status: 'submitting',
            createdAt: action.createdAt,
          },
        ],
      };
    case 'assessment-submitted':
      return {
        ...state,
        assessment: '',
        assistantPending: true,
        turnError: undefined,
        messages: [
          ...state.messages,
          {
            messageId: action.messageId,
            role: 'user',
            content: action.content,
            status: 'submitting',
            createdAt: action.createdAt,
          },
        ],
      };
    case 'turn-failed':
      return {
        ...state,
        ...(action.versionConflict ? { phase: 'version-conflict' as const } : {}),
        ...(action.restoreComposer ? { assessment: action.content } : {}),
        assistantPending: false,
        turnError: action.versionConflict ? undefined : '消息发送失败，请重试。',
        messages: state.messages.map((message) =>
          message.status === 'submitting' ? { ...message, status: 'failed' as const } : message,
        ),
      };
    case 'session-loaded':
      return {
        ...state,
        phase: phaseFromServer(action.state),
        outlineSessionId: action.outlineSessionId,
        resourceVersion: action.resourceVersion,
        generationTaskId: action.generationTaskId,
        ...(action.savedAsDraft === undefined ? {} : { savedAsDraft: action.savedAsDraft }),
        ...(action.topic === undefined ? {} : { topic: action.topic }),
        ...(action.courseMode === undefined ? {} : { courseMode: action.courseMode }),
        ...(action.candidateMarkdown === undefined
          ? {}
          : { candidateMarkdown: action.candidateMarkdown }),
        ...(action.candidateVersionId === undefined
          ? {}
          : { candidateVersionId: action.candidateVersionId }),
        ...(action.confirmedCourseId === undefined
          ? {}
          : { confirmedCourseId: action.confirmedCourseId }),
        ...(action.materials === undefined ? {} : { materials: action.materials }),
        ...(action.completedAssessmentRounds === undefined
          ? {}
          : { completedAssessmentRounds: action.completedAssessmentRounds }),
        canGenerateCandidate:
          action.canGenerateCandidate ?? action.state === 'ready-for-candidates',
        ...(action.messages === undefined ? {} : { messages: action.messages }),
        assistantPending: false,
        turnError: undefined,
      };
    case 'generation-requested':
      return {
        ...state,
        phase: 'generating',
        generationFailureCode: undefined,
      };
    case 'draft-saved':
      return { ...state, savedAsDraft: true, resourceVersion: action.resourceVersion };
    case 'generating':
      return {
        ...state,
        phase: 'generating',
        generationTaskId: action.taskId,
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
        generationTaskId: undefined,
        generationFailureCode: action.failureCode,
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
      if (action.event.type === 'task.completed')
        return { ...state, phase: 'candidate-ready', generationTaskId: undefined };
      if (action.event.type === 'task.failed')
        return {
          ...state,
          phase: 'generation-failed',
          generationFailureCode: candidateGenerationFailureFromEvent(action.event.data),
          generationTaskId: undefined,
        };
      if (action.event.type === 'task.cancelled')
        return {
          ...state,
          phase: 'generation-failed',
          generationFailureCode: 'generation_interrupted',
          generationTaskId: undefined,
        };
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

export function AuthoringPage(props: {
  readonly client?: CourseAuthoringClient;
  readonly initialOutlineSessionId?: string;
  readonly initialStartIntent?: AuthoringStartIntent;
  readonly onNavigate?: (path: string) => void;
  readonly onSessionChanged?: (outlineSessionId: string) => void;
}) {
  const api = props.client ?? courseAuthoringClient;
  const instanceId = useMemo(getPageInstanceId, []);
  const initialAuthoringState = useMemo<State>(() => {
    const startIntent = props.initialStartIntent;
    if (startIntent === undefined) return initialState;
    return {
      ...initialState,
      phase: 'creating',
      topic: startIntent.topic,
      courseMode: startIntent.courseMode,
      assistantPending: true,
      messages: [
        {
          messageId: 'local-authoring-start',
          role: 'user',
          content: startIntent.topic,
          status: 'submitting',
          createdAt: new Date().toISOString(),
        },
      ],
    };
  }, [props.initialStartIntent]);
  const [state, dispatch] = useReducer(authoringReducer, initialAuthoringState);
  const inFlight = useRef(new Set<string>());
  const generationAbortController = useRef<AbortController | undefined>(undefined);
  const startIntentSubmitted = useRef(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [selectedMaterial, setSelectedMaterial] = useState<File | undefined>(
    props.initialStartIntent?.materialFile,
  );
  const [materialBusy, setMaterialBusy] = useState(false);
  const [materialError, setMaterialError] = useState<string>();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const [generationCancelBusy, setGenerationCancelBusy] = useState(false);
  const [restoreStatus, setRestoreStatus] = useState<RestoreStatus>(() =>
    props.initialOutlineSessionId === undefined ? 'idle' : 'loading',
  );
  useCourseModeTheme(state.courseMode);
  const workspaceData = useMemo(
    () =>
      createAuthoringWorkspaceData({
        phase: state.phase,
        topic: state.topic,
        courseMode: state.courseMode,
        assessment: state.assessment,
        completedAssessmentRounds: state.completedAssessmentRounds,
        ...(state.generationFailureCode === undefined
          ? {}
          : { generationFailureCode: state.generationFailureCode }),
        messages: state.messages,
        candidateMarkdown: state.candidateMarkdown,
        materials: state.materials,
      }),
    [
      state.assessment,
      state.candidateMarkdown,
      state.courseMode,
      state.materials,
      state.phase,
      state.topic,
      state.completedAssessmentRounds,
      state.generationFailureCode,
      state.messages,
    ],
  );
  const generationFailure = candidateGenerationFailurePresentation(state.generationFailureCode);
  useAppShellHeaderStatus(
    state.outlineSessionId === undefined
      ? undefined
      : state.phase === 'generating'
        ? { tone: 'warning', text: '● 候选大纲生成中' }
        : state.phase === 'generation-failed'
          ? { tone: 'danger', text: generationFailure.header }
          : state.phase === 'confirmed'
            ? { tone: 'success', text: '● 正式课程已创建' }
            : state.savedAsDraft
              ? { tone: 'success', text: '● 草稿已保存' }
              : { tone: 'warning', text: '● 建档进行中 · 未保存' },
  );

  const applySessionView = (view: OutlineSessionView) => {
    dispatch({
      type: 'session-loaded',
      outlineSessionId: view.outlineSessionId,
      resourceVersion: view.resourceVersion,
      state: view.state,
      ...(view.topic === undefined ? {} : { topic: view.topic }),
      ...(view.courseMode === undefined ? {} : { courseMode: view.courseMode }),
      ...(view.generationTaskId === undefined ? {} : { generationTaskId: view.generationTaskId }),
      ...(typeof view.candidateMarkdown === 'string'
        ? { candidateMarkdown: view.candidateMarkdown }
        : {}),
      ...(typeof view.candidateVersionId === 'string'
        ? { candidateVersionId: view.candidateVersionId }
        : {}),
      ...(typeof view.confirmedCourseId === 'string'
        ? { confirmedCourseId: view.confirmedCourseId }
        : {}),
      ...(view.materials === undefined ? {} : { materials: view.materials }),
      ...(view.completedAssessmentRounds === undefined
        ? {}
        : { completedAssessmentRounds: view.completedAssessmentRounds }),
      ...(view.canGenerateCandidate === undefined
        ? {}
        : { canGenerateCandidate: view.canGenerateCandidate }),
      ...(view.savedAsDraft === undefined ? {} : { savedAsDraft: view.savedAsDraft }),
      ...(view.messages === undefined ? {} : { messages: view.messages }),
    });
  };

  const loadSession = async (outlineSessionId: string) => {
    applySessionView(await api.getOutlineSession(outlineSessionId));
  };

  const loadCandidateSession = async (outlineSessionId: string) => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const view = await api.getOutlineSession(outlineSessionId);
      applySessionView(view);
      if (typeof view.candidateMarkdown === 'string' && view.candidateMarkdown.trim() !== '')
        return;
      if (view.state !== 'generating-candidates' && view.candidateVersionId === undefined) return;
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
  };

  useEffect(() => {
    const outlineSessionId = props.initialOutlineSessionId;
    if (outlineSessionId === undefined) {
      setRestoreStatus('idle');
      return;
    }
    let current = true;
    setRestoreStatus('loading');
    void loadSession(outlineSessionId).then(
      () => {
        if (current) setRestoreStatus('idle');
      },
      () => {
        if (current) setRestoreStatus('failed');
      },
    );
    return () => {
      current = false;
    };
  }, [props.initialOutlineSessionId]);

  useEffect(() => {
    if (
      state.phase !== 'generating' ||
      state.outlineSessionId === undefined ||
      state.generationTaskId === undefined
    ) {
      return;
    }
    const outlineSessionId = state.outlineSessionId;
    const taskId = state.generationTaskId;
    const resourceVersion = state.resourceVersion ?? 0;
    const controller = new AbortController();
    generationAbortController.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 120_000);
    let terminalRefresh: Promise<void> | undefined;

    void api
      .streamGeneration(
        taskId,
        {
          onEvent: (event) => {
            if (
              event.type === 'task.completed' ||
              event.type === 'task.failed' ||
              event.type === 'task.cancelled'
            ) {
              terminalRefresh ??= loadCandidateSession(outlineSessionId).catch(() => undefined);
            }
            dispatch({ type: 'stream-event', event });
          },
        },
        controller.signal,
      )
      .then(async () => {
        await (terminalRefresh ?? loadSession(outlineSessionId));
      })
      .catch(async () => {
        if (controller.signal.aborted) {
          await (terminalRefresh ?? loadSession(outlineSessionId)).catch(() => undefined);
          return;
        }
        const recovered = await Promise.resolve(api.getOutlineSession(outlineSessionId)).catch(
          () => undefined,
        );
        if (recovered !== undefined && recovered.state !== 'generating-candidates') {
          applySessionView(recovered);
          return;
        }
        dispatch({
          type: 'generation-failed',
          resourceVersion,
          failureCode: 'generation_interrupted',
          ...(state.draftArtifactRef === undefined
            ? {}
            : { draftArtifactRef: state.draftArtifactRef }),
        });
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (generationAbortController.current === controller) {
          generationAbortController.current = undefined;
        }
      });

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
      if (generationAbortController.current === controller) {
        generationAbortController.current = undefined;
      }
    };
  }, [api, state.generationTaskId, state.outlineSessionId, state.phase]);

  const once = async (key: string, work: () => Promise<void>) => {
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    try {
      await work();
    } finally {
      inFlight.current.delete(key);
    }
  };

  const create = (optimisticStateExists = false) =>
    once('create', async () => {
      const content = state.topic.trim();
      if (!optimisticStateExists) {
        dispatch({
          type: 'creating',
          content,
          messageId: `local-create-${Date.now()}`,
          createdAt: new Date().toISOString(),
        });
      }
      try {
        const session = await api.createOutlineSession({
          topic: content,
          courseMode: state.courseMode,
          pageInstanceId: instanceId,
        });
        dispatch({
          type: 'session-loaded',
          outlineSessionId: session.outlineSessionId,
          resourceVersion: session.resourceVersion,
          state: session.state,
          ...(session.topic === undefined ? {} : { topic: session.topic }),
          ...(session.courseMode === undefined ? {} : { courseMode: session.courseMode }),
          ...(session.completedAssessmentRounds === undefined
            ? {}
            : { completedAssessmentRounds: session.completedAssessmentRounds }),
          ...(session.canGenerateCandidate === undefined
            ? {}
            : { canGenerateCandidate: session.canGenerateCandidate }),
          ...(session.messages === undefined ? {} : { messages: session.messages }),
        });
        if (selectedMaterial !== undefined) {
          await api.uploadMaterial({
            outlineSessionId: session.outlineSessionId,
            file: selectedMaterial,
            resourceVersion: session.resourceVersion,
            pageInstanceId: instanceId,
          });
          await loadSession(session.outlineSessionId);
        }
        props.onSessionChanged?.(session.outlineSessionId);
      } catch {
        dispatch({
          type: 'turn-failed',
          content,
          versionConflict: false,
          restoreComposer: false,
        });
      }
    });

  useEffect(() => {
    if (
      props.initialStartIntent === undefined ||
      props.initialOutlineSessionId !== undefined ||
      startIntentSubmitted.current
    ) {
      return;
    }
    startIntentSubmitted.current = true;
    void create(true);
  }, [props.initialOutlineSessionId, props.initialStartIntent]);

  const completeAssessment = () =>
    once('assessment', async () => {
      if (state.outlineSessionId === undefined || state.resourceVersion === undefined) return;
      const content = state.assessment.trim();
      if (content === '') return;
      dispatch({
        type: 'assessment-submitted',
        content,
        messageId: `local-assessment-${Date.now()}`,
        createdAt: new Date().toISOString(),
      });
      try {
        const session = await api.appendMessage({
          outlineSessionId: state.outlineSessionId,
          content,
          resourceVersion: state.resourceVersion,
          pageInstanceId: instanceId,
        });
        await loadSession(session.outlineSessionId);
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'version_conflict'
        ) {
          dispatch({
            type: 'turn-failed',
            content,
            versionConflict: true,
            restoreComposer: true,
          });
        } else {
          dispatch({
            type: 'turn-failed',
            content,
            versionConflict: false,
            restoreComposer: true,
          });
        }
      }
    });

  const generate = () =>
    once('generation', async () => {
      if (state.outlineSessionId === undefined || state.resourceVersion === undefined) return;
      dispatch({ type: 'generation-requested' });
      let accepted: Awaited<ReturnType<CourseAuthoringClient['requestCandidateGeneration']>>;
      try {
        accepted = await api.requestCandidateGeneration({
          outlineSessionId: state.outlineSessionId,
          resourceVersion: state.resourceVersion,
          pageInstanceId: instanceId,
        });
      } catch {
        dispatch({
          type: 'generation-failed',
          resourceVersion: state.resourceVersion,
          failureCode: 'generation_interrupted',
        });
        return;
      }
      if (accepted.state === 'failed_recoverable') {
        dispatch({
          type: 'generation-failed',
          resourceVersion: accepted.resourceVersion,
          failureCode: accepted.failureCode ?? 'generation_interrupted',
          ...(accepted.draftArtifactRef === undefined
            ? {}
            : { draftArtifactRef: accepted.draftArtifactRef }),
        });
        return;
      }
      dispatch({
        type: 'generating',
        taskId: accepted.taskId,
        resourceVersion: accepted.resourceVersion,
        ...(accepted.draftArtifactRef === undefined
          ? {}
          : { draftArtifactRef: accepted.draftArtifactRef }),
      });
    });

  const cancelGeneration = () =>
    once('cancel-generation', async () => {
      if (state.outlineSessionId === undefined || state.resourceVersion === undefined) return;
      setGenerationCancelBusy(true);
      generationAbortController.current?.abort();
      try {
        await api.cancelCandidateGeneration({
          outlineSessionId: state.outlineSessionId,
          resourceVersion: state.resourceVersion,
          pageInstanceId: instanceId,
        });
      } finally {
        await loadSession(state.outlineSessionId).catch(() => undefined);
        setGenerationCancelBusy(false);
      }
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

  const uploadMaterial = async () => {
    if (
      selectedMaterial === undefined ||
      state.outlineSessionId === undefined ||
      state.resourceVersion === undefined ||
      materialBusy
    )
      return;
    setMaterialBusy(true);
    setMaterialError(undefined);
    try {
      await api.uploadMaterial({
        outlineSessionId: state.outlineSessionId,
        file: selectedMaterial,
        resourceVersion: state.resourceVersion,
        pageInstanceId: instanceId,
      });
      setSelectedMaterial(undefined);
      await loadSession(state.outlineSessionId);
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
      setMaterialError(
        code === 'material_pdf_encrypted'
          ? 'PDF 已加密，无法读取。'
          : code === 'material_pdf_text_unavailable'
            ? 'PDF 没有可提取的文本。'
            : code === 'material_too_large'
              ? '材料文件超出大小限制。'
              : '材料解析失败，请使用 UTF-8 的 PDF、TXT 或 Markdown。',
      );
    } finally {
      setMaterialBusy(false);
    }
  };

  const deleteDraft = async () => {
    if (state.outlineSessionId === undefined || state.resourceVersion === undefined || deleteBusy) {
      return;
    }
    setDeleteBusy(true);
    setDeleteError(undefined);
    try {
      await api.deleteOutlineSession({
        outlineSessionId: state.outlineSessionId,
        resourceVersion: state.resourceVersion,
        pageInstanceId: instanceId,
      });
      props.onNavigate?.('/');
    } catch {
      setDeleteError('删除失败，当前建档会话仍然保留，请稍后重试。');
    } finally {
      setDeleteBusy(false);
    }
  };

  const saveDraft = async () => {
    if (
      state.outlineSessionId === undefined ||
      state.resourceVersion === undefined ||
      state.savedAsDraft
    )
      return;
    const saved = await api.saveOutlineSessionDraft({
      outlineSessionId: state.outlineSessionId,
      resourceVersion: state.resourceVersion,
      pageInstanceId: instanceId,
    });
    dispatch({ type: 'draft-saved', resourceVersion: saved.resourceVersion });
  };

  if (restoreStatus === 'loading') {
    return (
      <Page className="authoring-workspace course-authoring-page">
        <ContentState title="正在恢复大纲建档…" />
      </Page>
    );
  }

  if (restoreStatus === 'failed') {
    return (
      <Page className="authoring-workspace course-authoring-page">
        <ContentState
          action={
            <Button type="button" onClick={() => props.onNavigate?.('/')}>
              返回主页
            </Button>
          }
          description="原有大纲建档会话未能加载，请返回主页后重试。"
          role="alert"
          title="无法恢复大纲建档"
        />
      </Page>
    );
  }

  if (state.phase === 'empty') {
    return (
      <Page className="authoring-workspace course-authoring-page">
        <SectionHeader
          title="创建课程"
          description="从需求评估到候选大纲确认，过程可恢复且不会重复创建会话。"
          level={1}
        />
        <section className="authoring-panel">
          <label>
            学习主题
            <input
              value={state.topic}
              onChange={(event) => dispatch({ type: 'edit-topic', value: event.target.value })}
            />
          </label>
          <CourseModeSelector
            value={state.courseMode}
            onChange={(value) => dispatch({ type: 'select-mode', value })}
            onMaterialSelected={setSelectedMaterial}
          />
          <button type="button" disabled={state.topic.trim() === ''} onClick={() => void create()}>
            开始创建
          </button>
        </section>
      </Page>
    );
  }

  const materialTools =
    state.courseMode === 'reading_seminar' && state.outlineSessionId !== undefined ? (
      <div className="ow-material-tools">
        <label className="lm-field">
          <span>添加 PDF、TXT 或 Markdown</span>
          <input
            accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
            disabled={materialBusy}
            type="file"
            onChange={(event) => setSelectedMaterial(event.currentTarget.files?.[0])}
          />
        </label>
        <Button
          busy={materialBusy}
          disabled={selectedMaterial === undefined}
          onClick={() => void uploadMaterial()}
          type="button"
          variant="primary"
        >
          解析并保存材料
        </Button>
        {state.materials.slice(1).map((material) => (
          <span key={material.artifactRef} className="lm-pill">
            已解析 · {material.originalFileName}
          </span>
        ))}
        {materialError === undefined ? null : <ContentState role="alert" title={materialError} />}
      </div>
    ) : undefined;

  const canSubmitAssessment = [
    'assessing',
    'ready',
    'candidate-ready',
    'generation-failed',
  ].includes(state.phase);
  const primaryDisabled =
    ['creating', 'assessing', 'version-conflict', 'generating', 'confirming'].includes(
      state.phase,
    ) ||
    (state.phase === 'ready' && !state.canGenerateCandidate) ||
    (state.phase === 'candidate-ready' && state.candidateVersionId === undefined) ||
    (state.phase === 'confirmed' && state.confirmedCourseId === undefined);
  const runPrimaryAction = () => {
    if (state.phase === 'ready' || state.phase === 'generation-failed') void generate();
    else if (state.phase === 'candidate-ready') dispatch({ type: 'open-confirm', open: true });
    else if (state.phase === 'confirmed' && state.confirmedCourseId !== undefined)
      props.onNavigate?.(`/courses/${state.confirmedCourseId}`);
  };

  return (
    <>
      {state.phase === 'version-conflict' ? (
        <section className="authoring-workspace-notice">
          <p role="alert">服务端版本已更新，你的输入仍保留。</p>
          <Button
            type="button"
            onClick={() =>
              state.outlineSessionId === undefined
                ? undefined
                : void loadSession(state.outlineSessionId)
            }
          >
            重新加载
          </Button>
        </section>
      ) : null}
      {state.phase === 'generation-failed' ? (
        <section className="authoring-workspace-notice">
          <p role="alert">{generationFailure.title}</p>
          <p role="status">{generationFailure.detail}</p>
        </section>
      ) : null}
      {state.phase === 'confirmed' && state.confirmedCourseId !== undefined ? (
        <section className="authoring-workspace-notice">
          <p>
            正式课程：
            <a href={`/courses/${state.confirmedCourseId}`}>{state.confirmedCourseId}</a>
          </p>
        </section>
      ) : null}
      <OutlineWorkspaceView
        assistantPending={state.assistantPending}
        candidatePending={state.phase === 'generating'}
        generationCancelBusy={generationCancelBusy}
        onCancelGeneration={() => void cancelGeneration()}
        composerDisabled={['creating', 'generating', 'confirming', 'confirmed'].includes(
          state.phase,
        )}
        composerLabel="补充需求"
        composerRef={composerRef}
        composerValue={state.assessment}
        confirmBusy={['creating', 'generating', 'confirming'].includes(state.phase)}
        confirmDisabled={primaryDisabled}
        data={workspaceData}
        dangerAction={
          state.phase === 'confirmed' ? undefined : (
            <>
              <Button
                disabled={
                  state.outlineSessionId === undefined ||
                  state.resourceVersion === undefined ||
                  state.savedAsDraft
                }
                type="button"
                onClick={() => void saveDraft()}
              >
                {state.savedAsDraft
                  ? '草稿已保存'
                  : state.outlineSessionId === undefined
                    ? '正在准备草稿…'
                    : '保存草稿'}
              </Button>
              {state.savedAsDraft && state.outlineSessionId !== undefined ? (
                <Button
                  disabled={deleteBusy || ['generating', 'confirming'].includes(state.phase)}
                  type="button"
                  variant="danger"
                  onClick={() => {
                    setDeleteError(undefined);
                    setDeleteOpen(true);
                  }}
                >
                  删除草稿
                </Button>
              ) : null}
            </>
          )
        }
        materialTools={materialTools}
        primaryBusyLabel={state.phase === 'generating' ? '正在生成…' : '正在创建…'}
        primaryLabel={workspacePrimaryLabel(state.phase)}
        secondaryActionVisible={false}
        secondaryLabel=""
        sendBusy={state.assistantPending || inFlight.current.has('assessment')}
        sendDisabled={!canSubmitAssessment || state.assessment.trim() === ''}
        sendLabel={state.phase === 'assessing' ? '完成评估' : '保存调整'}
        turnError={state.turnError}
        onAdjust={() => composerRef.current?.focus()}
        onComposerChange={(value) => dispatch({ type: 'edit-assessment', value })}
        onConfirm={runPrimaryAction}
        onSend={() => void completeAssessment()}
      />
      <ConfirmDialog
        open={state.confirmOpen}
        busy={state.phase === 'confirming'}
        onCancel={() => dispatch({ type: 'open-confirm', open: false })}
        onConfirm={() => void confirm()}
      />
      <DeleteDraftDialog
        busy={deleteBusy}
        error={deleteError}
        open={deleteOpen}
        onCancel={() => {
          setDeleteError(undefined);
          setDeleteOpen(false);
        }}
        onConfirm={() => void deleteDraft()}
      />
    </>
  );
}
