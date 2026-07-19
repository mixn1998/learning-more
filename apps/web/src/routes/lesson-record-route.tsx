import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import {
  lessonRecordClient,
  type LessonRecord,
  type LessonRecordClient,
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
  const [activeSupplementary, setActiveSupplementary] = useState<{
    id: string;
    resourceVersion: number;
  }>();
  const api = props.api ?? lessonRecordClient;

  const refreshRecord = useCallback(async () => {
    if (lessonId === undefined) return;
    setRecord(await api.getLessonRecord(lessonId));
  }, [api, lessonId]);

  useEffect(() => {
    if (lessonId === undefined) return;
    setFailed(false);
    void refreshRecord().catch(() => setFailed(true));
  }, [lessonId, refreshRecord]);

  useEffect(() => {
    if (record?.reviewStatus !== 'generating') return;
    const timer = window.setInterval(() => {
      void refreshRecord().catch(() => undefined);
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [record?.reviewStatus, refreshRecord]);

  if (lessonId === undefined) return <p>课节不存在</p>;
  if (failed) return <p role="alert">课节档案加载失败</p>;
  if (record === undefined) return <p role="status">正在加载课节档案…</p>;
  return (
    <LessonRecordView
      original={record.original}
      supplementary={record.supplementary.map((session) => ({
        ...session,
        meta: `${archivedDateLabel(session.createdAt)} · 独立补充学习`,
      }))}
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
              const refreshed = await api.getLessonRecord(lessonId);
              setRecord(refreshed);
              return { sessionId: session.id };
            }
      }
      onSendSupplementary={
        activeSupplementary === undefined || api.sendSupplementary === undefined
          ? undefined
          : async (sessionId, markdown) => {
              const updated = await api.sendSupplementary!(
                sessionId,
                markdown,
                activeSupplementary.resourceVersion,
              );
              setActiveSupplementary(updated);
              setRecord(await api.getLessonRecord(lessonId));
            }
      }
    />
  );
}
