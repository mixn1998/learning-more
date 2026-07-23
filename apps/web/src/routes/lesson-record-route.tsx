import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import {
  lessonRecordClient,
  type LessonRecord,
  type LessonRecordClient,
  type SupplementarySessionView,
} from '../client/lesson-record-client.js';
import { LessonRecordView } from '../features/history/lesson-record-view.js';

function archivedDateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Shanghai',
  }).format(date);
}

export function LessonRecordRoute(props: { readonly api?: LessonRecordClient }) {
  const lessonId = useParams().lessonId;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [record, setRecord] = useState<LessonRecord>();
  const [failed, setFailed] = useState(false);
  const [reviewRetryBusy, setReviewRetryBusy] = useState(false);
  const [reviewRetryError, setReviewRetryError] = useState<string>();
  const [activeSupplementary, setActiveSupplementary] = useState<SupplementarySessionView>();
  const [assistantMarkdown, setAssistantMarkdown] = useState('');
  const api = props.api ?? lessonRecordClient;

  const refreshRecord = useCallback(async () => {
    if (lessonId === undefined) return;
    const next = await api.getLessonRecord(lessonId);
    setRecord(next);
    const active = next.supplementary.find((session) => session.status === 'active');
    if (active === undefined) {
      setActiveSupplementary(undefined);
      return;
    }
    if (api.getSupplementary !== undefined) {
      setActiveSupplementary(await api.getSupplementary(active.sessionId));
    }
  }, [api, lessonId]);

  useEffect(() => {
    if (lessonId === undefined) return;
    setFailed(false);
    void refreshRecord().catch(() => setFailed(true));
  }, [lessonId, refreshRecord]);

  useEffect(() => {
    if (record?.reviewStatus !== 'generating') return;
    const timer = window.setInterval(() => void refreshRecord().catch(() => undefined), 2_000);
    return () => window.clearInterval(timer);
  }, [record?.reviewStatus, refreshRecord]);

  const convergeSupplementary = useCallback(
    async (sessionId: string, taskId: string) => {
      if (api.getSupplementary === undefined) return;
      for (let index = 0; index < 120; index += 1) {
        const snapshot = await api.getSupplementary(sessionId);
        setActiveSupplementary(snapshot);
        if (snapshot.activeGenerationTaskId !== taskId) {
          setAssistantMarkdown('');
          await refreshRecord();
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 500));
      }
    },
    [api, refreshRecord],
  );

  const consumeTask = useCallback(
    async (sessionId: string, taskId: string) => {
      setAssistantMarkdown('');
      try {
        await api.streamSupplementary?.(taskId, (event) => {
          if (event.type === 'message.delta' && typeof event.data.markdown === 'string') {
            setAssistantMarkdown((current) => current + event.data.markdown);
          }
        });
      } catch {
        // The persisted task and session snapshot remain authoritative.
      }
      await convergeSupplementary(sessionId, taskId);
    },
    [api, convergeSupplementary],
  );

  useEffect(() => {
    const taskId = activeSupplementary?.activeGenerationTaskId;
    if (taskId === undefined || activeSupplementary === undefined) return;
    void consumeTask(activeSupplementary.id, taskId);
  }, [activeSupplementary?.activeGenerationTaskId, activeSupplementary?.id, consumeTask]);

  if (lessonId === undefined) return <p>课节不存在</p>;
  if (failed) return <p role="alert">课节档案加载失败</p>;
  if (record === undefined) return <p role="status">正在加载课节档案…</p>;

  const supplementary = record.supplementary.map((session) =>
    activeSupplementary?.id === session.sessionId
      ? {
          sessionId: session.sessionId,
          label: session.label,
          createdAt: session.createdAt,
          status: activeSupplementary.status,
          resourceVersion: activeSupplementary.resourceVersion,
          messages: activeSupplementary.messages ?? [],
          meta: `${archivedDateLabel(session.createdAt)} · 补充学习`,
        }
      : {
          ...session,
          meta: `${archivedDateLabel(session.createdAt)} · 补充学习`,
        },
  );

  return (
    <LessonRecordView
      original={record.original}
      supplementary={supplementary}
      {...(activeSupplementary === undefined ? {} : { activeSupplementary })}
      assistantMarkdown={assistantMarkdown}
      {...(record.finalReviewMarkdown === undefined
        ? {}
        : { finalReviewMarkdown: record.finalReviewMarkdown })}
      {...(record.reviewDocument === undefined ? {} : { reviewDocument: record.reviewDocument })}
      progress={record.progress}
      reviewKind={record.reviewKind}
      reviewStatus={record.reviewStatus}
      {...(record.reviewErrorCode === undefined ? {} : { reviewErrorCode: record.reviewErrorCode })}
      reviewRetryBusy={reviewRetryBusy}
      {...(reviewRetryError === undefined ? {} : { reviewRetryError })}
      initialTab={searchParams.get('tab') === 'review' ? 'review' : 'conversation'}
      title={record.title}
      courseTitle={record.courseTitle}
      completedAt={archivedDateLabel(record.completedAt)}
      actualSeconds={record.actualSeconds}
      onBackHome={() => navigate('/')}
      onBackToOutline={() => navigate(`/courses/${record.courseId}`)}
      onRetryReview={
        record.reviewRetry === undefined || api.retryReview === undefined
          ? undefined
          : async () => {
              setReviewRetryBusy(true);
              setReviewRetryError(undefined);
              try {
                await api.retryReview!(
                  record.reviewRetry!.transactionId,
                  record.reviewRetry!.resourceVersion,
                );
                await refreshRecord();
              } catch {
                setReviewRetryError('重试请求失败，请稍后再试。');
              } finally {
                setReviewRetryBusy(false);
              }
            }
      }
      onStartSupplementary={
        record.progress !== 'completed' ||
        record.reviewStatus !== 'ready' ||
        api.startSupplementary === undefined
          ? undefined
          : async () => {
              const session = await api.startSupplementary!(lessonId);
              setActiveSupplementary(session);
              await refreshRecord();
              return { sessionId: session.id };
            }
      }
      onSendSupplementary={
        activeSupplementary === undefined || api.sendSupplementary === undefined
          ? undefined
          : async (_sessionId, markdown) => {
              const task = await api.sendSupplementary!(
                activeSupplementary.id,
                markdown,
                activeSupplementary.resourceVersion,
              );
              setActiveSupplementary({
                ...activeSupplementary,
                resourceVersion: task.resourceVersion,
                activeGenerationTaskId: task.taskId,
                generationErrorCode: undefined,
              });
            }
      }
      onReviseSupplementary={
        activeSupplementary === undefined || api.reviseSupplementary === undefined
          ? undefined
          : async (messageId, markdown) => {
              const task = await api.reviseSupplementary!(
                activeSupplementary.id,
                messageId,
                markdown,
                activeSupplementary.resourceVersion,
              );
              setActiveSupplementary({
                ...activeSupplementary,
                resourceVersion: task.resourceVersion,
                activeGenerationTaskId: task.taskId,
                generationErrorCode: undefined,
              });
            }
      }
      onRetrySupplementary={
        activeSupplementary === undefined || api.retrySupplementary === undefined
          ? undefined
          : async () => {
              const task = await api.retrySupplementary!(
                activeSupplementary.id,
                activeSupplementary.resourceVersion,
              );
              setActiveSupplementary({
                ...activeSupplementary,
                resourceVersion: task.resourceVersion,
                activeGenerationTaskId: task.taskId,
                generationErrorCode: undefined,
              });
            }
      }
      onStopSupplementary={
        activeSupplementary?.activeGenerationTaskId === undefined ||
        api.stopSupplementary === undefined
          ? undefined
          : async () => {
              const updated = await api.stopSupplementary!(
                activeSupplementary.id,
                activeSupplementary.activeGenerationTaskId!,
                activeSupplementary.resourceVersion,
              );
              setAssistantMarkdown('');
              setActiveSupplementary(updated);
              await refreshRecord();
            }
      }
      onArchiveSupplementary={
        activeSupplementary === undefined || api.archiveSupplementary === undefined
          ? undefined
          : async () => {
              const archived = await api.archiveSupplementary!(
                activeSupplementary.id,
                activeSupplementary.resourceVersion,
              );
              setAssistantMarkdown('');
              setActiveSupplementary(undefined);
              await refreshRecord();
              return archived.id;
            }
      }
      onRenameSupplementary={
        api.renameSupplementary === undefined
          ? undefined
          : async (sessionId, title, resourceVersion) => {
              try {
                const renamed = await api.renameSupplementary!(sessionId, title, resourceVersion);
                if (activeSupplementary?.id === sessionId) setActiveSupplementary(renamed);
                await refreshRecord();
              } catch (error) {
                await refreshRecord().catch(() => undefined);
                throw error;
              }
            }
      }
    />
  );
}
