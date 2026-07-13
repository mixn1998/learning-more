import { useEffect, useState } from 'react';

import { learningClient, type LearningClient } from '../../client/learning-client.js';
import { SessionPage } from './session-page.js';

export function LessonEntryPage(props: {
  readonly lessonId: string;
  readonly client?: LearningClient;
}) {
  const api = props.client ?? learningClient;
  const [preview, setPreview] = useState<Awaited<ReturnType<LearningClient['getLessonPreview']>>>();
  const [started, setStarted] = useState(false);

  useEffect(() => {
    void api.getLessonPreview(props.lessonId).then(setPreview);
  }, [api, props.lessonId]);

  if (started) return <SessionPage lessonId={props.lessonId} client={api} />;
  if (preview === undefined) return <p role="status">正在读取课节大纲…</p>;
  return (
    <main className="authoring-workspace">
      <p className="eyebrow">课节预览</p>
      <h1>{preview.title}</h1>
      <p>{preview.objective}</p>
      <section className="authoring-panel" aria-label="核心知识点">
        <h2>本课核心知识点</h2>
        <ul>
          {preview.coreKnowledgePoints.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
        <p>预计 {preview.estimatedMinutes} 分钟</p>
        <button type="button" onClick={() => setStarted(true)}>
          开始学习
        </button>
      </section>
    </main>
  );
}
