import { useEffect, useReducer, useRef, useState } from 'react';

import type { LessonFinalReviewDocument } from '@learning-more/contracts';

import { learningClient, type LearningClient } from '../../client/learning-client.js';
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
  continuationPending: boolean;
  generationKnowledgePointRef?: string | undefined;
  opening: boolean;
  openingError: boolean;
  pendingUserMessage?:
    | Readonly<{
        id: string;
        markdown: string;
        status: 'submitting' | 'complete' | 'failed';
      }>
    | undefined;
  revisingMessageId?: string | undefined;
  editingMessageId?: string | undefined;
  editingTargetMessageId?: string | undefined;
  editingDraft: string;
  editingCancellationPending: boolean;
  sendError?: string | undefined;
  taskId?: string | undefined;
  draftArtifactRef?: string | undefined;
  phase: 'starting' | 'ready' | 'generating' | 'stopped';
  progress: 'in_progress' | 'abandoned' | 'completed';
  activity: 'active' | 'paused';
  actualSeconds: number;
  reviewMarkdown?: string;
  reviewDocument?: LessonFinalReviewDocument;
  stageReviewStatus?: 'generating' | 'failed' | 'ready' | undefined;
  reviewDismissed: boolean;
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
      reviewDocument?: LessonFinalReviewDocument;
      messages?: readonly SessionMessageView[];
      actualSeconds?: number;
      sessionSnapshotHash?: string;
      closurePreparation?: State['closurePreparation'];
      teachingProgress?: TeachingProgress;
      activeGenerationTaskId?: string;
    }>
  | Readonly<{ type: 'input'; value: string }>
  | Readonly<{
      type: 'send-started';
      content: string;
      messageId: string;
      revisingMessageId?: string | undefined;
    }>
  | Readonly<{
      type: 'edit-started';
      messageId: string;
      targetMessageId: string;
      markdown: string;
      resourceVersion: number;
      cancellationPending: boolean;
    }>
  | Readonly<{
      type: 'edit-generation-synchronized';
      localMessageId: string;
      userMessageId?: string | undefined;
      resourceVersion: number;
      requestAccepted: boolean;
    }>
  | Readonly<{ type: 'edit-input'; value: string }>
  | Readonly<{ type: 'edit-cancelled' }>
  | Readonly<{ type: 'retry-started' }>
  | Readonly<{
      type: 'send-failed';
      content: string;
      requestAccepted: boolean;
    }>
  | Readonly<{
      type: 'generating';
      taskId: string;
      resourceVersion: number;
      userMessageId?: string | undefined;
    }>
  | Readonly<{ type: 'continuation-started'; knowledgePointRef?: string | undefined }>
  | Readonly<{ type: 'continuation-failed' }>
  | Readonly<{ type: 'delta'; markdown: string }>
  | Readonly<{ type: 'completed' }>
  | Readonly<{
      type: 'stopped';
      draftArtifactRef?: string | undefined;
      resourceVersion: number;
    }>
  | Readonly<{ type: 'transferred'; resourceVersion: number }>
  | Readonly<{
      type: 'progress';
      progress: State['progress'];
      resourceVersion: number;
      stageReviewStatus?: State['stageReviewStatus'];
    }>
  | Readonly<{ type: 'activity'; activity: State['activity']; resourceVersion: number }>
  | Readonly<{
      type: 'review';
      markdown: string;
      document?: LessonFinalReviewDocument;
      resourceVersion: number;
    }>
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
  | Readonly<{ type: 'tick' }>;

const initial: State = {
  resourceVersion: 0,
  writable: false,
  input: '',
  editingDraft: '',
  editingCancellationPending: false,
  assistantMarkdown: '',
  assistantPending: false,
  continuationPending: false,
  opening: false,
  openingError: false,
  phase: 'starting',
  progress: 'in_progress',
  activity: 'active',
  actualSeconds: 0,
  reviewDismissed: false,
  messages: [],
};

function hasAssistantResponse(messages: readonly SessionMessageView[] | undefined): boolean {
  if (messages === undefined) return false;
  const latestUserIndex = messages.findLastIndex((message) => message.role === 'user');
  if (latestUserIndex < 0) return false;
  return messages
    .slice(latestUserIndex + 1)
    .some(
      (message) =>
        message.role === 'assistant' &&
        message.completionStatus !== 'interrupted' &&
        message.markdown.trim() !== '',
    );
}

function hasCompletedAssistantTurn(messages: readonly SessionMessageView[]): boolean {
  const latest = messages.at(-1);
  return (
    latest?.role === 'assistant' &&
    latest.completionStatus !== 'interrupted' &&
    latest.markdown.trim() !== ''
  );
}

function learnerTurnKnowledgePointRef(
  teachingProgress: TeachingProgress | undefined,
): string | undefined {
  if (teachingProgress === undefined) return undefined;
  if (teachingProgress.lessonPhase === 'warmup') {
    return teachingProgress.knowledgePoints[0]?.ref;
  }
  return teachingProgress.activeKnowledgePointRef;
}

function hasUnansweredUserMessage(messages: readonly SessionMessageView[] | undefined): boolean {
  if (messages === undefined) return false;
  const latestUserMessage = messages.findLast((message) => message.role === 'user');
  return latestUserMessage !== undefined && !hasAssistantResponse(messages);
}

function hasGenerationResponse(
  messages: readonly SessionMessageView[] | undefined,
  taskId: string,
  userMessageId?: string,
): boolean {
  if (messages === undefined) return false;
  const userIndex =
    userMessageId === undefined
      ? messages.findLastIndex((message) => message.role === 'user')
      : messages.findIndex((message) => message.role === 'user' && message.id === userMessageId);
  if (userIndex < 0) return false;
  return messages
    .slice(userIndex + 1)
    .some(
      (message) =>
        message.role === 'assistant' &&
        (message.generationTaskId === taskId ||
          (message.generationTaskId === undefined && userMessageId !== undefined)) &&
        message.completionStatus !== 'interrupted' &&
        message.markdown.trim() !== '',
    );
}

function lessonClosureFailureMessage(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : undefined;
  if (code === 'lesson_not_completable') return '教学尚未闭环，暂时不能完成本课。';
  if (code === 'projection_incomplete') return '教学记录仍在同步，请稍后重试完成本课。';
  if (code === 'source_snapshot_changed') return '会话内容已经变化，请重新确认后完成本课。';
  return '完成本课失败，请重试。';
}

const GENERATION_RECONCILIATION_DELAY_MS = 8_000;
const GENERATION_PROJECTION_POLL_MS = 1_000;
const GENERATION_STOP_ERROR = '无法取消当前生成，请取消编辑后重试。';

async function consumeGenerationStream(
  api: LearningClient,
  taskId: string,
  onEvent: Parameters<LearningClient['stream']>[1],
  timeoutIds: Set<number>,
): Promise<'completed' | 'failed' | 'cancelled' | 'closed' | 'stalled'> {
  let terminalOutcome: 'completed' | 'failed' | 'cancelled' | undefined;
  const stream = api.stream(taskId, (event) => {
    if (event.type === 'task.completed') terminalOutcome = 'completed';
    else if (event.type === 'task.failed') terminalOutcome = 'failed';
    else if (event.type === 'task.cancelled') terminalOutcome = 'cancelled';
    onEvent(event);
  });
  let timeoutId: number | undefined;
  const firstOutcome = await Promise.race([
    stream.then(() => terminalOutcome ?? ('closed' as const)),
    new Promise<'stalled'>((resolve) => {
      timeoutId = window.setTimeout(() => resolve('stalled'), GENERATION_RECONCILIATION_DELAY_MS);
      timeoutIds.add(timeoutId);
    }),
  ]).finally(() => {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
      timeoutIds.delete(timeoutId);
    }
  });
  if (firstOutcome === 'stalled') {
    void stream.catch(() => undefined);
    return 'stalled';
  }
  return firstOutcome;
}

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
    if (action.resourceVersion < state.resourceVersion) return state;
    const pendingUserPersisted =
      state.pendingUserMessage !== undefined &&
      action.messages?.some(
        (message) => message.role === 'user' && message.id === state.pendingUserMessage?.id,
      );
    const streamedReplyCommitted =
      state.taskId !== undefined &&
      action.messages?.some(
        (message) => message.role === 'assistant' && message.generationTaskId === state.taskId,
      ) === true;
    const preserveActiveStream =
      state.assistantMarkdown !== '' &&
      state.taskId !== undefined &&
      action.activeGenerationTaskId === state.taskId &&
      !streamedReplyCommitted;
    return {
      ...state,
      resourceVersion: action.resourceVersion,
      progress: action.progress,
      activity: action.activity,
      ...(action.reviewMarkdown === undefined ? {} : { reviewMarkdown: action.reviewMarkdown }),
      ...(action.reviewDocument === undefined ? {} : { reviewDocument: action.reviewDocument }),
      ...(action.messages === undefined
        ? {}
        : {
            messages: action.messages,
            assistantMarkdown: preserveActiveStream ? state.assistantMarkdown : '',
            ...(state.revisingMessageId !== undefined &&
            !action.messages.some((message) => message.id === state.revisingMessageId)
              ? { revisingMessageId: undefined }
              : {}),
          }),
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
  if (action.type === 'edit-input') return { ...state, editingDraft: action.value };
  if (action.type === 'edit-cancelled') {
    return {
      ...state,
      editingMessageId: undefined,
      editingTargetMessageId: undefined,
      editingDraft: '',
      editingCancellationPending: false,
      sendError:
        state.pendingUserMessage?.status === 'failed' ? undefined : 'AI 回复生成中断，请重试。',
    };
  }
  if (action.type === 'retry-started') {
    return {
      ...state,
      phase: 'generating',
      assistantMarkdown: '',
      assistantPending: true,
      continuationPending: false,
      generationKnowledgePointRef: learnerTurnKnowledgePointRef(state.teachingProgress),
      taskId: undefined,
      sendError: undefined,
      draftArtifactRef: undefined,
    };
  }
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
      continuationPending: false,
      generationKnowledgePointRef: learnerTurnKnowledgePointRef(state.teachingProgress),
      pendingUserMessage: {
        id: action.messageId,
        markdown: action.content,
        status: 'submitting',
      },
      sendError: undefined,
      revisingMessageId: action.revisingMessageId,
      editingMessageId: undefined,
      editingTargetMessageId: undefined,
      editingDraft: '',
      opening: false,
      openingError: false,
      taskId: undefined,
      draftArtifactRef: undefined,
    };
  }
  if (action.type === 'edit-started') {
    return {
      ...state,
      editingMessageId: action.messageId,
      editingTargetMessageId: action.targetMessageId,
      editingDraft: action.markdown,
      editingCancellationPending: action.cancellationPending,
      resourceVersion: action.resourceVersion,
      phase: 'ready',
      assistantMarkdown: '',
      assistantPending: false,
      taskId: undefined,
      draftArtifactRef: undefined,
      sendError: undefined,
    };
  }
  if (action.type === 'edit-generation-synchronized') {
    const synchronizedMessageId = action.userMessageId ?? action.localMessageId;
    return {
      ...state,
      resourceVersion: action.resourceVersion,
      editingCancellationPending: false,
      editingMessageId:
        state.editingMessageId === action.localMessageId
          ? synchronizedMessageId
          : state.editingMessageId,
      editingTargetMessageId:
        state.editingTargetMessageId === action.localMessageId
          ? synchronizedMessageId
          : state.editingTargetMessageId,
      pendingUserMessage:
        state.pendingUserMessage?.id === action.localMessageId
          ? {
              ...state.pendingUserMessage,
              id: synchronizedMessageId,
              status: action.requestAccepted ? 'complete' : 'failed',
            }
          : state.pendingUserMessage,
    };
  }
  if (action.type === 'send-failed') {
    return {
      ...state,
      phase: 'ready',
      input: '',
      assistantPending: false,
      taskId: undefined,
      sendError: action.requestAccepted ? 'AI 回复生成中断，请重试。' : undefined,
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
      assistantPending:
        state.continuationPending ||
        (state.assistantMarkdown === '' &&
          (state.pendingUserMessage !== undefined || state.messages.at(-1)?.role !== 'assistant')),
      pendingUserMessage:
        state.pendingUserMessage === undefined
          ? undefined
          : {
              ...state.pendingUserMessage,
              ...(action.userMessageId === undefined ? {} : { id: action.userMessageId }),
              status: 'complete',
            },
    };
  }
  if (action.type === 'continuation-started') {
    return {
      ...state,
      phase: 'generating',
      assistantMarkdown: '',
      assistantPending: true,
      continuationPending: true,
      generationKnowledgePointRef: action.knowledgePointRef,
      taskId: undefined,
      sendError: undefined,
      draftArtifactRef: undefined,
    };
  }
  if (action.type === 'continuation-failed') {
    return {
      ...state,
      phase: 'ready',
      assistantMarkdown: '',
      assistantPending: false,
      continuationPending: false,
      generationKnowledgePointRef: undefined,
      taskId: undefined,
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
      continuationPending: false,
      generationKnowledgePointRef: undefined,
      taskId: undefined,
    };
  if (action.type === 'stopped') {
    return {
      ...state,
      phase: 'stopped',
      assistantPending: false,
      continuationPending: false,
      generationKnowledgePointRef: undefined,
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
  if (action.type === 'tick') return { ...state, actualSeconds: state.actualSeconds + 1 };
  if (action.type === 'closure') {
    return {
      ...state,
      progress: 'completed',
      writable: false,
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
    ...(action.document === undefined ? {} : { reviewDocument: action.document }),
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
  const afterComprehensive = ['discussion', 'summary', 'ready_to_close'].includes(phase);
  const lastKnowledgePointMessageIndex = state.messages.findLastIndex(
    (message) => message.role === 'assistant' && message.knowledgePointRef !== undefined,
  );
  const hasComprehensiveApplicationMessage = state.messages.some(
    (message, index) =>
      index > lastKnowledgePointMessageIndex &&
      message.role === 'assistant' &&
      message.knowledgePointRef === undefined,
  );
  const comprehensiveStarted =
    phase === 'comprehensive_application' &&
    teaching.comprehensiveCheck === 'learning' &&
    (lastKnowledgePointMessageIndex < 0 ||
      hasComprehensiveApplicationMessage ||
      (state.phase === 'generating' && state.generationKnowledgePointRef === undefined));
  const hasBoundAssistantMessages = state.messages.some(
    (message) => message.role === 'assistant' && message.knowledgePointRef !== undefined,
  );
  const path = [
    {
      title: '课前热身',
      detail: completed || afterWarmup ? '已完成学习起点确认' : '正在连接目标与已有经验',
      state: completed || afterWarmup ? ('done' as const) : ('active' as const),
    },
    ...teaching.knowledgePoints.map((point) => {
      if (!afterWarmup) {
        return {
          title: point.title,
          detail: '待讲解',
          state: 'pending' as const,
          emphasis: point.emphasis,
        };
      }
      const hasTeachingMessage = state.messages.some(
        (message) => message.role === 'assistant' && message.knowledgePointRef === point.ref,
      );
      const active =
        (point.progress === 'learning' && (!hasBoundAssistantMessages || hasTeachingMessage)) ||
        (state.phase === 'generating' && state.generationKnowledgePointRef === point.ref);
      if (point.progress === 'completed') {
        return {
          title: point.title,
          detail: point.interactionStatus === 'skipped' ? '跳过知识点互动' : '该知识点已完成',
          state: 'done' as const,
          emphasis: point.emphasis,
        };
      }
      if (point.progress === 'skipped') {
        return {
          title: point.title,
          detail: '跳过知识点',
          state: 'done' as const,
          emphasis: point.emphasis,
        };
      }
      if (active) {
        return {
          title: point.title,
          detail: '正在学习中',
          state: 'active' as const,
          emphasis: point.emphasis,
        };
      }
      return {
        title: point.title,
        detail: '待讲解',
        state: 'pending' as const,
        emphasis: point.emphasis,
      };
    }),
    {
      title: '综合应用',
      detail:
        completed || afterComprehensive
          ? teaching.comprehensiveCheck === 'skipped'
            ? '跳过综合应用'
            : '综合应用已完成'
          : comprehensiveStarted
            ? '正在进行跨知识点应用'
            : phase === 'comprehensive_application'
              ? '等待综合应用开始'
              : '等待逐项学习完成',
      state:
        completed || afterComprehensive
          ? ('done' as const)
          : comprehensiveStarted
            ? ('active' as const)
            : ('pending' as const),
    },
    {
      title: '讨论答疑',
      detail:
        completed || ['summary', 'ready_to_close'].includes(phase)
          ? '已确认没有其他疑问'
          : phase === 'discussion'
            ? '可以继续追问本课内容'
            : '等待综合应用完成',
      state:
        completed || ['summary', 'ready_to_close'].includes(phase)
          ? ('done' as const)
          : phase === 'discussion'
            ? ('active' as const)
            : ('pending' as const),
    },
    {
      title: '本课总结',
      detail:
        completed || phase === 'ready_to_close'
          ? '知识点总结已完成'
          : phase === 'summary'
            ? 'AI 正在整理本课最终总结'
            : '等待讨论答疑结束',
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
  const sessionStart = useRef<
    | {
        lessonId: string;
        promise: ReturnType<LearningClient['start']>;
      }
    | undefined
  >(undefined);
  const generationAttempt = useRef(0);
  const editCancellation = useRef<Promise<void> | undefined>(undefined);
  const generationStartTimeouts = useRef(new Set<number>());
  const teachingRefreshes = useRef(new Set<string>());
  const [navigationError, setNavigationError] = useState<string>();

  useEffect(
    () => () => {
      generationAttempt.current += 1;
      for (const timeoutId of generationStartTimeouts.current) window.clearTimeout(timeoutId);
      generationStartTimeouts.current.clear();
    },
    [],
  );

  const hydrate = (snapshot: Awaited<ReturnType<LearningClient['getSession']>>) => {
    const activeGenerationTaskId = snapshot.learning.session?.activeGenerationTaskId;
    const activeReplyCommitted = snapshot.messages?.some(
      (message) =>
        message.role === 'assistant' && message.generationTaskId === activeGenerationTaskId,
    );
    if (activeGenerationTaskId === undefined || activeReplyCommitted === true) {
      setNavigationError((current) => (current === GENERATION_STOP_ERROR ? undefined : current));
    }
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
      ...(snapshot.finalReview?.document?.kind === 'lesson-final'
        ? { reviewDocument: snapshot.finalReview.document }
        : {}),
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
      ...(activeGenerationTaskId === undefined ? {} : { activeGenerationTaskId }),
    });
  };

  const hydrateAndRefreshTeachingProgress = (
    sessionId: string,
    initialSnapshot: Awaited<ReturnType<LearningClient['getSession']>>,
  ) => {
    hydrate(initialSnapshot);
    const needsTeachingRefresh = (snapshot: Awaited<ReturnType<LearningClient['getSession']>>) =>
      snapshot.teachingProgress?.teachingWeightStatus === 'pending';
    if (needsTeachingRefresh(initialSnapshot) && !teachingRefreshes.current.has(sessionId)) {
      teachingRefreshes.current.add(sessionId);
      void (async () => {
        try {
          for (let attempt = 0; attempt < 120; attempt += 1) {
            await new Promise((resolve) => window.setTimeout(resolve, 1_000));
            const refreshed = await api.getSession(sessionId);
            hydrate(refreshed);
            if (!needsTeachingRefresh(refreshed)) break;
          }
        } finally {
          teachingRefreshes.current.delete(sessionId);
        }
      })();
    }
    return initialSnapshot;
  };

  const convergeGenerationProjection = async (input: {
    sessionId: string;
    taskId: string;
    attempt: number;
    responseKind: 'opening' | 'turn';
    userMessageId?: string;
    streamOutcome?: Awaited<ReturnType<typeof consumeGenerationStream>>;
  }): Promise<
    | {
        status: 'completed' | 'failed';
        snapshot: Awaited<ReturnType<LearningClient['getSession']>>;
      }
    | { status: 'cancelled' }
  > => {
    let terminalProjectionMisses = 0;
    while (generationAttempt.current === input.attempt) {
      let snapshot: Awaited<ReturnType<LearningClient['getSession']>>;
      try {
        snapshot = await api.getSession(input.sessionId);
      } catch {
        await new Promise((resolve) => window.setTimeout(resolve, GENERATION_PROJECTION_POLL_MS));
        continue;
      }

      const responsePersisted =
        input.responseKind === 'opening'
          ? snapshot.messages?.some(
              (message) => message.role === 'assistant' && message.markdown.trim() !== '',
            ) === true
          : hasGenerationResponse(snapshot.messages, input.taskId, input.userMessageId);
      const activeTaskId = snapshot.learning.session?.activeGenerationTaskId;
      if (activeTaskId === undefined) {
        if (responsePersisted) {
          hydrateAndRefreshTeachingProgress(input.sessionId, snapshot);
          return { status: 'completed', snapshot };
        }
        if (input.streamOutcome === 'failed' || input.streamOutcome === 'cancelled') {
          if (
            input.userMessageId !== undefined &&
            snapshot.messages?.some(
              (message) => message.role === 'user' && message.id === input.userMessageId,
            )
          ) {
            hydrateAndRefreshTeachingProgress(input.sessionId, snapshot);
          }
          return { status: 'failed', snapshot };
        }
        terminalProjectionMisses += 1;
        const maximumProjectionMisses =
          input.responseKind === 'opening'
            ? 1
            : Math.ceil(GENERATION_RECONCILIATION_DELAY_MS / GENERATION_PROJECTION_POLL_MS);
        if (terminalProjectionMisses >= maximumProjectionMisses) {
          if (
            input.userMessageId !== undefined &&
            snapshot.messages?.some(
              (message) => message.role === 'user' && message.id === input.userMessageId,
            )
          ) {
            hydrateAndRefreshTeachingProgress(input.sessionId, snapshot);
          }
          return { status: 'failed', snapshot };
        }
        await new Promise((resolve) => window.setTimeout(resolve, GENERATION_PROJECTION_POLL_MS));
        continue;
      }

      if (activeTaskId !== input.taskId) {
        // Recovery may replace a legacy binding before the same logical turn is committed.
        await new Promise((resolve) => window.setTimeout(resolve, GENERATION_PROJECTION_POLL_MS));
        continue;
      }
      terminalProjectionMisses = 0;
      await new Promise((resolve) => window.setTimeout(resolve, GENERATION_PROJECTION_POLL_MS));
    }
    return { status: 'cancelled' };
  };

  useEffect(() => {
    let cancelled = false;
    if (sessionStart.current?.lessonId !== props.lessonId) {
      sessionStart.current = {
        lessonId: props.lessonId,
        promise: api.start(props.lessonId),
      };
    }
    void sessionStart.current.promise.then(async (started) => {
      if (cancelled) return;
      dispatch({
        type: 'started',
        sessionId: started.sessionId,
        resourceVersion: started.resourceVersion,
        writable: started.writable,
      });
      const initialSnapshot = await api.getSession(started.sessionId);
      if (cancelled) return;
      const snapshot = hydrateAndRefreshTeachingProgress(started.sessionId, initialSnapshot);
      const activeTaskId = snapshot.learning.session?.activeGenerationTaskId;
      if (activeTaskId !== undefined) {
        const attempt = generationAttempt.current;
        const unansweredUserMessage = hasUnansweredUserMessage(snapshot.messages);
        const unansweredUserMessageId = unansweredUserMessage
          ? snapshot.messages?.findLast((message) => message.role === 'user')?.id
          : undefined;
        dispatch({
          type: 'generating',
          taskId: activeTaskId,
          resourceVersion: snapshot.resourceVersion,
        });
        let streamOutcome: Awaited<ReturnType<typeof consumeGenerationStream>> | undefined;
        try {
          streamOutcome = await consumeGenerationStream(
            api,
            activeTaskId,
            (event) => {
              if (cancelled) return;
              if (event.type === 'message.delta' && typeof event.data.markdown === 'string') {
                dispatch({ type: 'delta', markdown: event.data.markdown });
              }
            },
            generationStartTimeouts.current,
          );
        } catch {
          // Stream transport is advisory; the persisted task binding remains authoritative.
        }
        if (cancelled) return;
        const outcome = await convergeGenerationProjection({
          sessionId: started.sessionId,
          taskId: activeTaskId,
          attempt,
          responseKind: unansweredUserMessage ? 'turn' : 'opening',
          ...(streamOutcome === undefined ? {} : { streamOutcome }),
          ...(unansweredUserMessageId === undefined
            ? {}
            : { userMessageId: unansweredUserMessageId }),
        });
        if (cancelled) return;
        if (outcome.status === 'failed') {
          const content =
            outcome.snapshot.messages?.findLast((message) => message.role === 'user')?.markdown ??
            '';
          dispatch({ type: 'send-failed', content, requestAccepted: true });
        } else if (outcome.status === 'completed') {
          dispatch({ type: 'completed' });
        }
      } else if (
        snapshot.learning.progress === 'in_progress' &&
        hasUnansweredUserMessage(snapshot.messages)
      ) {
        const content =
          snapshot.messages?.findLast((message) => message.role === 'user')?.markdown ?? '';
        dispatch({ type: 'send-failed', content, requestAccepted: true });
      } else if (
        props.autoOpen === true &&
        snapshot.learning.progress === 'in_progress' &&
        (snapshot.messages?.length ?? 0) === 0
      ) {
        await openOpening(started.sessionId, snapshot.resourceVersion);
      }
    });
    return () => {
      cancelled = true;
    };
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
      while (!cancelled) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
        if (cancelled) return;
        try {
          const result = await api.getClosure(state.closureTransactionId!);
          if (result.review?.markdown !== undefined && result.state === 'completed') {
            dispatch({
              type: 'review',
              markdown: result.review.markdown,
              ...(result.review.document?.kind === 'lesson-final'
                ? { document: result.review.document }
                : {}),
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
        const attempt = generationAttempt.current;
        dispatch({
          type: 'generating',
          taskId: opening.taskId,
          resourceVersion: opening.resourceVersion,
        });
        let streamOutcome: Awaited<ReturnType<typeof consumeGenerationStream>> | undefined;
        try {
          streamOutcome = await consumeGenerationStream(
            api,
            opening.taskId,
            (event) => {
              if (event.type === 'message.delta' && typeof event.data.markdown === 'string') {
                dispatch({ type: 'delta', markdown: event.data.markdown });
              }
            },
            generationStartTimeouts.current,
          );
        } catch {
          // Stream transport is advisory; the persisted task binding remains authoritative.
        }
        const outcome = await convergeGenerationProjection({
          sessionId,
          taskId: opening.taskId,
          attempt,
          responseKind: 'opening',
          ...(streamOutcome === undefined ? {} : { streamOutcome }),
        });
        if (outcome.status === 'cancelled') return;
        if (outcome.status === 'failed') {
          throw new Error('lesson_opening_content_missing');
        }
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
    initialResourceVersion = state.resourceVersion,
  ): Promise<T> => {
    try {
      return await work(initialResourceVersion);
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

  const reconcileFailedStop = async (input: {
    localMessageId: string;
    userMessageId?: string | undefined;
    requestAccepted: boolean;
  }): Promise<boolean> => {
    if (state.sessionId === undefined) return false;
    try {
      const snapshot = await api.getSession(state.sessionId);
      hydrateAndRefreshTeachingProgress(state.sessionId, snapshot);
      if (snapshot.learning.session?.activeGenerationTaskId !== undefined) return false;
      dispatch({
        type: 'edit-generation-synchronized',
        localMessageId: input.localMessageId,
        ...(input.userMessageId === undefined ? {} : { userMessageId: input.userMessageId }),
        resourceVersion: snapshot.resourceVersion,
        requestAccepted: input.requestAccepted,
      });
      setNavigationError(undefined);
      return true;
    } catch {
      return false;
    }
  };

  const finishMessageTask = async (
    task: Readonly<{
      taskId: string;
      resourceVersion: number;
      userMessageId?: string;
    }>,
    content: string,
    attempt: number,
    localMessageId: string,
  ) => {
    if (generationAttempt.current !== attempt) {
      try {
        const stopped = await withLatestSessionVersion(
          (resourceVersion) =>
            api.stop({
              sessionId: state.sessionId!,
              taskId: task.taskId,
              resourceVersion,
              disposition: 'discard',
            }),
          task.resourceVersion,
        );
        dispatch({
          type: 'edit-generation-synchronized',
          localMessageId,
          ...(task.userMessageId === undefined ? {} : { userMessageId: task.userMessageId }),
          resourceVersion: stopped.resourceVersion,
          requestAccepted: true,
        });
      } catch {
        const reconciled = await reconcileFailedStop({
          localMessageId,
          ...(task.userMessageId === undefined ? {} : { userMessageId: task.userMessageId }),
          requestAccepted: true,
        });
        if (!reconciled) setNavigationError(GENERATION_STOP_ERROR);
      }
      return;
    }
    dispatch({
      type: 'generating',
      taskId: task.taskId,
      resourceVersion: task.resourceVersion,
      ...(task.userMessageId === undefined ? {} : { userMessageId: task.userMessageId }),
    });
    let streamOutcome: Awaited<ReturnType<typeof consumeGenerationStream>> | undefined;
    try {
      streamOutcome = await consumeGenerationStream(
        api,
        task.taskId,
        (event) => {
          if (generationAttempt.current !== attempt) return;
          if (event.type === 'message.delta' && typeof event.data.markdown === 'string') {
            dispatch({ type: 'delta', markdown: event.data.markdown });
          }
        },
        generationStartTimeouts.current,
      );
    } catch {
      // Stream transport is advisory; the persisted task binding remains authoritative.
    }
    if (generationAttempt.current !== attempt) return;
    const userMessageId =
      task.userMessageId ?? (localMessageId.startsWith('local-') ? undefined : localMessageId);
    const outcome = await convergeGenerationProjection({
      sessionId: state.sessionId!,
      taskId: task.taskId,
      attempt,
      responseKind: 'turn',
      ...(streamOutcome === undefined ? {} : { streamOutcome }),
      ...(userMessageId === undefined ? {} : { userMessageId }),
    });
    if (outcome.status === 'failed') {
      dispatch({ type: 'send-failed', content, requestAccepted: true });
      return;
    }
    if (outcome.status === 'completed') dispatch({ type: 'completed' });
  };

  const send = () =>
    once('send', async () => {
      if (state.sessionId === undefined || state.input.trim() === '') return;
      const content = state.input.trim();
      const localMessageId = `local-session-${Date.now()}`;
      const attempt = generationAttempt.current + 1;
      generationAttempt.current = attempt;
      dispatch({
        type: 'send-started',
        content,
        messageId: localMessageId,
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
        if (generationAttempt.current !== attempt) {
          dispatch({
            type: 'edit-generation-synchronized',
            localMessageId,
            resourceVersion: state.resourceVersion,
            requestAccepted: false,
          });
          return;
        }
        dispatch({ type: 'send-failed', content, requestAccepted: false });
        return;
      }
      await finishMessageTask(task, content, attempt, localMessageId);
    });

  const continueTeaching = () =>
    once('continue-teaching', async () => {
      if (state.sessionId === undefined) return;
      if (state.input.trim() !== '') {
        await send();
        return;
      }
      setNavigationError(undefined);
      const attempt = generationAttempt.current + 1;
      generationAttempt.current = attempt;
      dispatch({
        type: 'continuation-started',
        knowledgePointRef: state.teachingProgress?.activeKnowledgePointRef,
      });
      let task: Awaited<ReturnType<LearningClient['continueTeaching']>>;
      try {
        task = await withLatestSessionVersion((resourceVersion) =>
          api.continueTeaching(state.sessionId!, resourceVersion),
        );
      } catch {
        dispatch({ type: 'continuation-failed' });
        setNavigationError('继续讲解失败，请重试。');
        return;
      }
      dispatch({
        type: 'generating',
        taskId: task.taskId,
        resourceVersion: task.resourceVersion,
      });
      let streamOutcome: Awaited<ReturnType<typeof consumeGenerationStream>> | undefined;
      try {
        streamOutcome = await consumeGenerationStream(
          api,
          task.taskId,
          (event) => {
            if (generationAttempt.current !== attempt) return;
            if (event.type === 'message.delta' && typeof event.data.markdown === 'string') {
              dispatch({ type: 'delta', markdown: event.data.markdown });
            }
          },
          generationStartTimeouts.current,
        );
      } catch {
        // Persisted task/session projection remains authoritative.
      }
      if (generationAttempt.current !== attempt) return;
      const outcome = await convergeGenerationProjection({
        sessionId: state.sessionId,
        taskId: task.taskId,
        attempt,
        responseKind: 'turn',
        ...(streamOutcome === undefined ? {} : { streamOutcome }),
      });
      if (outcome.status === 'failed') {
        hydrateAndRefreshTeachingProgress(state.sessionId, outcome.snapshot);
        dispatch({ type: 'continuation-failed' });
        setNavigationError('继续讲解失败，请重试。');
        return;
      }
      if (outcome.status === 'completed') dispatch({ type: 'completed' });
    });

  const editMessage = (messageId: string, markdown: string) =>
    once('edit-message', async () => {
      if (state.sessionId === undefined) return;
      setNavigationError(undefined);
      const taskId = state.taskId;
      generationAttempt.current += 1;
      inFlight.current.delete('send');
      inFlight.current.delete('retry-generation');
      dispatch({
        type: 'edit-started',
        messageId,
        targetMessageId: state.revisingMessageId ?? messageId,
        markdown,
        resourceVersion: state.resourceVersion,
        cancellationPending: false,
      });
      if (taskId === undefined) return;
      const cancellation = (async () => {
        try {
          const stopped = await withLatestSessionVersion((latestVersion) =>
            api.stop({
              sessionId: state.sessionId!,
              taskId,
              resourceVersion: latestVersion,
              disposition: 'discard',
            }),
          );
          dispatch({
            type: 'edit-generation-synchronized',
            localMessageId: messageId,
            resourceVersion: stopped.resourceVersion,
            requestAccepted: true,
          });
        } catch {
          const reconciled = await reconcileFailedStop({
            localMessageId: messageId,
            requestAccepted: true,
          });
          if (!reconciled) setNavigationError(GENERATION_STOP_ERROR);
        }
      })();
      editCancellation.current = cancellation;
      try {
        await cancellation;
      } finally {
        if (editCancellation.current === cancellation) editCancellation.current = undefined;
      }
    });

  const submitEdit = () =>
    once('submit-edit', async () => {
      if (
        state.sessionId === undefined ||
        state.editingMessageId === undefined ||
        state.editingTargetMessageId === undefined ||
        state.editingDraft.trim() === ''
      ) {
        return;
      }
      await editCancellation.current;
      const content = state.editingDraft.trim();
      const targetMessageId = state.editingTargetMessageId;
      const isUnacceptedLocalMessage =
        state.pendingUserMessage?.id === targetMessageId &&
        state.pendingUserMessage.status === 'failed' &&
        state.revisingMessageId === undefined;
      const attempt = generationAttempt.current + 1;
      const localMessageId = isUnacceptedLocalMessage
        ? targetMessageId
        : `local-revision-${Date.now()}`;
      generationAttempt.current = attempt;
      dispatch({
        type: 'send-started',
        content,
        messageId: localMessageId,
        ...(isUnacceptedLocalMessage ? {} : { revisingMessageId: targetMessageId }),
      });
      let task: Awaited<ReturnType<LearningClient['sendMessage']>>;
      try {
        task = await withLatestSessionVersion((resourceVersion) =>
          isUnacceptedLocalMessage
            ? api.sendMessage({
                sessionId: state.sessionId!,
                markdown: content,
                resourceVersion,
              })
            : api.reviseMessage({
                sessionId: state.sessionId!,
                messageId: targetMessageId,
                markdown: content,
                resourceVersion,
              }),
        );
      } catch {
        if (generationAttempt.current !== attempt) {
          dispatch({
            type: 'edit-generation-synchronized',
            localMessageId,
            resourceVersion: state.resourceVersion,
            requestAccepted: false,
          });
          return;
        }
        dispatch({ type: 'send-failed', content, requestAccepted: false });
        return;
      }
      await finishMessageTask(task, content, attempt, localMessageId);
    });

  const retryFailedMessage = () =>
    once('retry-message', async () => {
      if (
        state.sessionId === undefined ||
        state.pendingUserMessage === undefined ||
        state.pendingUserMessage.status !== 'failed'
      ) {
        return;
      }
      const content = state.pendingUserMessage.markdown;
      const targetMessageId = state.revisingMessageId;
      const attempt = generationAttempt.current + 1;
      generationAttempt.current = attempt;
      dispatch({
        type: 'send-started',
        content,
        messageId: state.pendingUserMessage.id,
        ...(targetMessageId === undefined ? {} : { revisingMessageId: targetMessageId }),
      });
      let task: Awaited<ReturnType<LearningClient['sendMessage']>>;
      try {
        task = await withLatestSessionVersion((resourceVersion) =>
          targetMessageId === undefined
            ? api.sendMessage({
                sessionId: state.sessionId!,
                markdown: content,
                resourceVersion,
              })
            : api.reviseMessage({
                sessionId: state.sessionId!,
                messageId: targetMessageId,
                markdown: content,
                resourceVersion,
              }),
        );
      } catch {
        if (generationAttempt.current !== attempt) {
          dispatch({
            type: 'edit-generation-synchronized',
            localMessageId: state.pendingUserMessage.id,
            resourceVersion: state.resourceVersion,
            requestAccepted: false,
          });
          return;
        }
        dispatch({ type: 'send-failed', content, requestAccepted: false });
        return;
      }
      await finishMessageTask(task, content, attempt, state.pendingUserMessage.id);
    });

  const retryGeneration = () =>
    once('retry-generation', async () => {
      if (state.sessionId === undefined) return;
      const content =
        state.pendingUserMessage?.markdown ??
        state.messages.findLast((message) => message.role === 'user')?.markdown ??
        '';
      const localMessageId =
        state.pendingUserMessage?.id ??
        state.messages.findLast((message) => message.role === 'user')?.id ??
        `local-retry-${Date.now()}`;
      const attempt = generationAttempt.current + 1;
      generationAttempt.current = attempt;
      dispatch({ type: 'retry-started' });
      try {
        const task = await withLatestSessionVersion((resourceVersion) =>
          api.retryGeneration(state.sessionId!, resourceVersion),
        );
        await finishMessageTask(task, content, attempt, localMessageId);
      } catch {
        if (generationAttempt.current !== attempt) {
          dispatch({
            type: 'edit-generation-synchronized',
            localMessageId,
            resourceVersion: state.resourceVersion,
            requestAccepted: true,
          });
          return;
        }
        dispatch({ type: 'send-failed', content, requestAccepted: true });
      }
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
            ...(result.review.document?.kind === 'lesson-final'
              ? { document: result.review.document }
              : {}),
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
        props.onNavigate?.(props.courseId === undefined ? '/' : `/courses/${props.courseId}`);
      } catch (error) {
        dispatch({ type: 'closure-request-failed', error: lessonClosureFailureMessage(error) });
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

  const lessonPath = buildLessonPath(state, props.knowledgePoints ?? []);
  const revisionIndex =
    state.revisingMessageId === undefined
      ? -1
      : state.messages.findIndex((message) => message.id === state.revisingMessageId);
  const visibleStoredMessages =
    revisionIndex < 0 ? state.messages : state.messages.slice(0, revisionIndex);
  const pendingUserMessage = state.pendingUserMessage;
  const pendingUserAlreadyRendered =
    pendingUserMessage !== undefined &&
    state.messages.some(
      (message) => message.role === 'user' && message.id === pendingUserMessage.id,
    );
  const knowledgePointTitleByRef = new Map(
    state.teachingProgress?.knowledgePoints.map((point) => [point.ref, point.title]) ?? [],
  );
  const messages = [
    ...visibleStoredMessages.map((message) => ({
      id: message.id,
      role: message.role,
      markdown: message.markdown,
      knowledgePointRef: message.knowledgePointRef,
      knowledgePointTitle:
        message.knowledgePointRef === undefined
          ? undefined
          : knowledgePointTitleByRef.get(message.knowledgePointRef),
    })),
    ...(pendingUserMessage === undefined || pendingUserAlreadyRendered
      ? []
      : [
          {
            id: pendingUserMessage.id,
            role: 'user' as const,
            markdown: pendingUserMessage.markdown,
            status: pendingUserMessage.status,
          },
        ]),
    ...(state.assistantMarkdown === ''
      ? []
      : [
          {
            id: 'streaming-assistant',
            role: 'assistant' as const,
            markdown: state.assistantMarkdown,
            knowledgePointRef: state.generationKnowledgePointRef,
            knowledgePointTitle:
              state.generationKnowledgePointRef === undefined
                ? undefined
                : knowledgePointTitleByRef.get(state.generationKnowledgePointRef),
          },
        ]),
  ];
  const latestUserMessage = messages.findLast((message) => message.role === 'user');
  const editAvailable =
    latestUserMessage !== undefined &&
    state.editingMessageId === undefined &&
    (state.phase === 'generating' ||
      state.sendError !== undefined ||
      state.pendingUserMessage?.status === 'failed');
  const messageSendFailed = state.pendingUserMessage?.status === 'failed';
  const generationFailed = state.sendError === 'AI 回复生成中断，请重试。';
  const retryAvailable =
    latestUserMessage !== undefined &&
    state.editingMessageId === undefined &&
    (messageSendFailed || generationFailed);
  const latestUserIndex = messages.findLastIndex((message) => message.role === 'user');
  const interruptedAssistantMessage = messages
    .slice(latestUserIndex + 1)
    .findLast((message) => message.role === 'assistant');
  const retryableMessageId =
    !retryAvailable || latestUserMessage === undefined
      ? undefined
      : generationFailed && interruptedAssistantMessage !== undefined
        ? interruptedAssistantMessage.id
        : latestUserMessage.id;

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
        canContinueTeaching={
          state.teachingProgress?.lessonPhase !== 'ready_to_close' &&
          hasCompletedAssistantTurn(visibleStoredMessages) &&
          state.pendingUserMessage === undefined &&
          state.sendError === undefined &&
          state.phase === 'ready' &&
          state.editingMessageId === undefined
        }
        conversationKey={state.sessionId}
        continuationPending={state.continuationPending}
        courseId={props.courseId ?? 'unknown-course'}
        courseTitle={props.courseTitle ?? '当前课程'}
        elapsedSeconds={state.actualSeconds}
        editableMessageId={editAvailable ? latestUserMessage.id : undefined}
        editingDraft={state.editingDraft}
        editingMessageId={state.editingMessageId}
        editingSubmitDisabled={state.editingCancellationPending}
        generating={state.phase === 'generating'}
        opening={state.opening}
        openingError={state.openingError}
        input={state.input}
        lessonId={props.lessonId}
        messages={messages}
        moduleLabel={props.moduleLabel ?? '正式课程课节'}
        outlineVersionLabel={props.outlineVersionLabel ?? '大纲 v1'}
        path={lessonPath}
        paused={state.activity === 'paused'}
        retryableMessageId={retryableMessageId}
        retryLabel={messageSendFailed ? '重新发送' : '重新生成'}
        sendError={navigationError}
        stopped={state.draftArtifactRef !== undefined}
        title={props.title ?? '当前课节'}
        writable={state.writable && state.progress === 'in_progress'}
        onAbandon={() => void abandon()}
        onBackToOutline={backToOutline}
        onComplete={() => void finish()}
        onEditMessage={(messageId, markdown) => void editMessage(messageId, markdown)}
        onEditDraft={(value) => dispatch({ type: 'edit-input', value })}
        onCancelEdit={() => dispatch({ type: 'edit-cancelled' })}
        onInput={(value) => dispatch({ type: 'input', value })}
        onPause={() => void pause()}
        onRestore={() => void restore()}
        onRetryOpening={retryOpening}
        onRetryMessage={() => void (messageSendFailed ? retryFailedMessage() : retryGeneration())}
        onSkipOpening={() => dispatch({ type: 'opening-skipped' })}
        onResume={() => void resume()}
        onSend={() => void send()}
        onSubmitEdit={() => void submitEdit()}
        onStop={() => void stop()}
        onContinueTeaching={() => void continueTeaching()}
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
        {...(state.reviewDocument === undefined ? {} : { document: state.reviewDocument })}
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
    </>
  );
}
