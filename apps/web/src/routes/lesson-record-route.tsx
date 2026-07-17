import { useEffect, useState } from 'react';
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
  const api = props.api ?? lessonRecordClient;

  useEffect(() => {
    if (lessonId === undefined) return;
    setFailed(false);
    void api.getLessonRecord(lessonId).then(setRecord, () => setFailed(true));
  }, [api, lessonId]);

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
      reviewStatus={record.reviewStatus}
      initialTab={searchParams.get('tab') === 'review' ? 'review' : 'conversation'}
      title={record.title}
      courseTitle={record.courseTitle}
      completedAt={archivedDateLabel(record.completedAt)}
      actualSeconds={record.actualSeconds}
      onBackHome={() => navigate('/')}
      onBackToOutline={() => navigate(`/courses/${record.courseId}`)}
    />
  );
}
