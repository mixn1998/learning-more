import { useEffect, useRef, useState } from 'react';

import { learningClient, type LearningClient } from '../../client/learning-client.js';
import { CourseClosurePanel } from './course-closure-panel.js';

export function CoursePage(props: { readonly courseId: string; readonly client?: LearningClient }) {
  const api = props.client ?? learningClient;
  const [closed, setClosed] = useState<{ state: string; artifactRef?: string }>();
  const [error, setError] = useState<string>();
  const submitting = useRef(false);

  useEffect(() => {
    void api.getCourseReview(props.courseId).then((review) => {
      if (review !== undefined && review.state === 'review-finalized') {
        setClosed({
          state: review.state,
          ...(review.artifactRef === undefined ? {} : { artifactRef: review.artifactRef }),
        });
      }
    });
  }, [api, props.courseId]);

  const close = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setError(undefined);
    try {
      const result = await api.closeCourse(props.courseId, 1, false);
      setClosed({
        state: result.state,
        ...(result.artifactRef === undefined ? {} : { artifactRef: result.artifactRef }),
      });
    } catch {
      setError('课程尚不具备关闭条件');
    } finally {
      submitting.current = false;
    }
  };

  return (
    <main className="authoring-workspace">
      <h1>课程学习档案</h1>
      <p>{props.courseId}</p>
      {closed === undefined ? (
        <CourseClosurePanel abandonedLessonIds={[]} onConfirm={() => void close()} />
      ) : (
        <section className="authoring-panel">
          <h2>主题总结已生成</h2>
          <p>{closed.state}</p>
          {closed.artifactRef === undefined ? null : <code>{closed.artifactRef}</code>}
        </section>
      )}
      {error === undefined ? null : <p role="alert">{error}</p>}
    </main>
  );
}
