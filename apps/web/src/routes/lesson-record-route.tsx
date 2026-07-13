import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

import {
  lessonRecordClient,
  type LessonRecord,
  type LessonRecordClient,
} from '../client/lesson-record-client.js';
import { LessonRecordView } from '../features/history/lesson-record-view.js';

export function LessonRecordRoute(props: { readonly api?: LessonRecordClient }) {
  const lessonId = useParams().lessonId;
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
      supplementary={record.supplementary}
      finalReviewMarkdown={record.finalReviewMarkdown}
      initialTab={searchParams.get('tab') === 'review' ? 'review' : 'conversation'}
    />
  );
}
