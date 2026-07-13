import { useEffect, useRef, useState } from 'react';

import { learningClient, type LearningClient } from '../../client/learning-client.js';
import { CourseArchiveDangerZone } from './course-archive-danger-zone.js';
import { CourseClosurePanel } from './course-closure-panel.js';

export function CoursePage(props: {
  readonly courseId: string;
  readonly client?: LearningClient;
  readonly onDeleted?: (message: string) => void;
}) {
  const api = props.client ?? learningClient;
  const [closed, setClosed] = useState<{
    state: string;
    artifactRef?: string;
    markdown?: string;
  }>();
  const [showCourseReview, setShowCourseReview] = useState(false);
  const [error, setError] = useState<string>();
  const [course, setCourse] = useState<Awaited<ReturnType<LearningClient['getCourse']>>>();
  const submitting = useRef(false);

  useEffect(() => {
    void api.getCourse(props.courseId).then(setCourse);
    void api.getCourseReview(props.courseId).then((review) => {
      if (review !== undefined && review.state === 'review-finalized') {
        setClosed({
          state: review.state,
          ...(review.artifactRef === undefined ? {} : { artifactRef: review.artifactRef }),
          ...(review.markdown === undefined ? {} : { markdown: review.markdown }),
        });
      }
    });
  }, [api, props.courseId]);

  const close = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setError(undefined);
    try {
      if (course === undefined) return;
      const result = await api.closeCourse(props.courseId, course.resourceVersion, false);
      setClosed({
        state: result.state,
        ...(result.artifactRef === undefined ? {} : { artifactRef: result.artifactRef }),
        ...(result.markdown === undefined ? {} : { markdown: result.markdown }),
      });
    } catch {
      setError('课程尚不具备关闭条件');
    } finally {
      submitting.current = false;
    }
  };

  const permanentlyDelete = async () => {
    if (course === undefined) throw new Error('course_archive_not_loaded');
    await api.deleteCourse(props.courseId, course.resourceVersion);
    props.onDeleted?.('课程及关联记录已永久删除');
  };

  return (
    <main className="authoring-workspace">
      <h1>课程学习档案</h1>
      <p>{props.courseId}</p>
      {course === undefined ? null : <p>{course.title}</p>}
      {closed === undefined ? (
        <CourseClosurePanel abandonedLessonIds={[]} onConfirm={() => void close()} />
      ) : (
        <section className="authoring-panel">
          <button type="button" onClick={() => setShowCourseReview(true)}>
            查看主题总结
          </button>
          {!showCourseReview ? null : (
            <article>
              <h2>主题总结</h2>
              <div className="candidate-markdown">{closed.markdown ?? '主题总结正在读取。'}</div>
            </article>
          )}
        </section>
      )}
      {error === undefined ? null : <p role="alert">{error}</p>}
      <CourseArchiveDangerZone onDelete={permanentlyDelete} />
    </main>
  );
}
